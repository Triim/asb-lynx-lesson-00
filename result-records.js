// Pure helpers for the Firestore result schema. No DOM or Firebase code here, so
// verify.mjs can check them in Node. Keep these limits identical to firestore.rules.
export const RESULTS_COLLECTION = 'results';
export const SCHEMA_VERSION = 1;
export const NO_SESSION = 'none';
export const TRAINING_SIZES = [8, 12, 16];
export const IMAGE_TEST_TOTAL = 12;
export const LANGUAGE_TEST_TOTAL = 10;
export const IMAGE_FIELDS = ['kind', 'schemaVersion', 'studentId', 'sessionId', 'trainingCount', 'nearestCorrect', 'nearestTotal', 'neuralCorrect', 'neuralTotal', 'createdAt'];
export const LANGUAGE_FIELDS = ['kind', 'schemaVersion', 'studentId', 'sessionId', 'trainingSentences', 'correct', 'covered', 'total', 'createdAt'];

const SESSION_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,23}$/;
const ATTEMPT_PATTERN = /^[A-Za-z0-9]{20}$/;
const SESSION_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I/L, easy to read aloud
const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function randomString(length, alphabet, random = globalThis.crypto) {
  const bytes = random.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

// One Firestore document ID per experiment attempt. Reusing it makes a repeated save a no-op
// on the client, and the rules reject any second write to the same ID.
export const newAttemptId = (random) => randomString(20, ID_ALPHABET, random);
export const newSessionCode = (random) => randomString(6, SESSION_ALPHABET, random);
export const isAttemptId = (value) => typeof value === 'string' && ATTEMPT_PATTERN.test(value);

export function normalizeSessionId(raw) {
  const value = String(raw ?? '').trim().toUpperCase();
  return SESSION_PATTERN.test(value) ? value : null;
}

// ?session=CODE wins; otherwise reuse the code remembered for this browser tab.
export function resolveSessionId(search, storage) {
  const fromUrl = normalizeSessionId(new URLSearchParams(search).get('session'));
  try {
    if (fromUrl) { storage?.setItem('lesson00.session', fromUrl); return fromUrl; }
    return normalizeSessionId(storage?.getItem('lesson00.session')) || NO_SESSION;
  } catch {
    return fromUrl || NO_SESSION;
  }
}

const isCount = (value, max) => Number.isInteger(value) && value >= 0 && value <= max;

// The fields a student computes. studentId, sessionId and createdAt are added at write time.
export function imageResult({ trainingCount, nearest, neural }) {
  const result = {
    kind: 'image',
    schemaVersion: SCHEMA_VERSION,
    trainingCount,
    nearestCorrect: nearest?.correct,
    nearestTotal: nearest?.total,
    neuralCorrect: neural?.correct,
    neuralTotal: neural?.total,
  };
  if (!TRAINING_SIZES.includes(trainingCount) || result.nearestTotal !== IMAGE_TEST_TOTAL || result.neuralTotal !== IMAGE_TEST_TOTAL
    || !isCount(result.nearestCorrect, IMAGE_TEST_TOTAL) || !isCount(result.neuralCorrect, IMAGE_TEST_TOTAL)) {
    throw new Error('Image result does not match the saved-result schema.');
  }
  return result;
}

export function languageResult({ trainingSentences, evaluation }) {
  const result = {
    kind: 'language',
    schemaVersion: SCHEMA_VERSION,
    trainingSentences,
    correct: evaluation?.correct,
    covered: evaluation?.covered,
    total: evaluation?.total,
  };
  if (!TRAINING_SIZES.includes(trainingSentences) || result.total !== LANGUAGE_TEST_TOTAL
    || !isCount(result.covered, LANGUAGE_TEST_TOTAL) || !isCount(result.correct, result.covered)) {
    throw new Error('Language result does not match the saved-result schema.');
  }
  return result;
}

// Groups dashboard documents by anonymous student. Students keep their order of first
// appearance so rows do not jump around on a projector while results arrive.
export function groupByStudent(records) {
  const time = (record) => record.createdAt?.toMillis?.() ?? (Number(record.createdAt) || 0);
  const sorted = [...records].sort((a, b) => time(a) - time(b));
  const students = new Map();
  for (const record of sorted) {
    if (!students.has(record.studentId)) students.set(record.studentId, { studentId: record.studentId, number: students.size + 1, attempts: [] });
    students.get(record.studentId).attempts.push(record);
  }
  return [...students.values()].map((student) => {
    const latest = (kind) => student.attempts.filter((attempt) => attempt.kind === kind).at(-1) || null;
    return { ...student, image: latest('image'), language: latest('language'), lastAt: time(student.attempts.at(-1)) };
  });
}
