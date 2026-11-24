// Teacher dashboard: Google sign-in and live Firestore results. Reading is allowed only for the
// teacher account named in firestore.rules; this page never decides access on its own.
import { tallySurvey, surveyChartHtml } from './survey.js';
import { RESULTS_COLLECTION, NO_SESSION, IMAGE_TEST_TOTAL, LANGUAGE_TEST_TOTAL, groupByStudent, newSessionCode, normalizeSessionId } from './result-records.js';

const MAX_RESULTS = 2000;
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* per-browser convenience only */ } },
};

const view = {
  records: [], surveys: [], loaded: false, error: '', updatedAt: null, fromCache: false, email: '',
  session: normalizeSessionId(new URLSearchParams(location.search).get('session')) || store.get('lesson00.results.session') || '',
  generated: normalizeSessionId(store.get('lesson00.results.generated')) || '',
  expanded: new Set(),
};
let fb = null, unsubscribe = null, sessionOptionsKey = '';

function show(id, visible) { $(id).hidden = !visible; }
function setAuthError(message) { $('#auth-error').textContent = message; show('#auth-error', Boolean(message)); }

function formatTime(millis) {
  if (!millis) return '—';
  const date = new Date(millis), today = new Date().toDateString() === date.toDateString();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return today ? time : date.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' · ' + time;
}
const millisOf = (record) => record.createdAt?.toMillis?.() || 0;
const sessionLabel = (id) => (id === NO_SESSION ? 'No session code' : id);

function score(correct, total, kind) {
  const percent = total ? Math.round(100 * correct / total) : 0;
  return '<td class="score ' + kind + '"><strong>' + correct + '<span class="of">/' + total + '</span></strong><small>' + percent + '%</small></td>';
}
const empty = (kind) => ['band-start ', '', ''].map((start) => '<td class="empty ' + start + kind + '">–</td>').join('');
function imageCells(result) {
  if (!result) return empty('band-image');
  return '<td class="count band-start band-image">' + result.trainingCount + '</td>' + score(result.nearestCorrect, result.nearestTotal, 'band-image') + score(result.neuralCorrect, result.neuralTotal, 'band-image');
}
function languageCells(result) {
  if (!result) return empty('band-language');
  return '<td class="count band-start band-language">' + result.trainingSentences + '</td>' + score(result.correct, result.total, 'band-language') + score(result.covered, result.total, 'band-language coverage');
}

function renderSessions() {
  const latest = new Map();
  for (const record of [...view.records, ...view.surveys]) latest.set(record.sessionId, Math.max(latest.get(record.sessionId) || 0, millisOf(record)));
  if (view.generated && !latest.has(view.generated)) latest.set(view.generated, Date.now());
  if (view.session && !latest.has(view.session)) latest.set(view.session, 0);
  const sessions = [...latest].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const counts = new Map(sessions.map((id) => [id, new Set([...view.records, ...view.surveys].filter((r) => r.sessionId === id).map((r) => r.studentId)).size]));
  const key = JSON.stringify([view.session, sessions, [...counts]]);
  if (key === sessionOptionsKey) return; // do not rebuild an open dropdown on every update
  sessionOptionsKey = key;
  $('#session-filter').innerHTML = '<option value="">All sessions</option>' + sessions.map((id) => '<option value="' + esc(id) + '"' + (id === view.session ? ' selected' : '') + '>' + esc(sessionLabel(id)) + ' · ' + counts.get(id) + ' student' + (counts.get(id) === 1 ? '' : 's') + '</option>').join('');
  $('#session-filter').value = view.session;
}

function renderShare() {
  const code = view.session && view.session !== NO_SESSION ? view.session : '';
  show('#share-link', Boolean(code));
  if (!code) return;
  const url = new URL('student.html', location.href);
  url.search = new URLSearchParams({ session: code }).toString();
  $('#share-code').textContent = code;
  $('#share-url').value = url.href;
}

function render() {
  renderSessions();
  renderShare();
  const denied = view.error === 'permission-denied';
  $('#read-error').innerHTML = denied
    ? '<strong>This Google account cannot read the results.</strong> Signed in as ' + esc(view.email) + '. Sign out and use the teacher account, or check the teacher email in the Firestore rules.'
    : view.error ? '<strong>Live results stopped.</strong> ' + esc(view.error) + '. Reload the page to reconnect.' : '';
  show('#read-error', Boolean(view.error));

  const records = view.records.filter((record) => !view.session || record.sessionId === view.session);
  const students = groupByStudent(records);
  const images = records.filter((r) => r.kind === 'image').length, languages = records.filter((r) => r.kind === 'language').length;
  // Survey: anonymous answers, one set per student, shown as simple bar charts.
  const tally = tallySurvey(view.surveys.filter((record) => !view.session || record.sessionId === view.session));
  $('#survey-charts').innerHTML = !view.loaded ? '' : tally.total
    ? '<p class="survey-count">' + tally.total + ' student' + (tally.total === 1 ? '' : 's') + ' answered</p><div class="survey-charts">' + tally.questions.map((question) => surveyChartHtml(question, tally.total)).join('') + '</div>'
    : '<p class="dash-empty">No survey answers yet. Charts appear as students answer the four questions at the start of the lab.</p>';
  $('#summary').innerHTML = [['Students', students.length], ['Survey answers', tally.total], ['Image results', images], ['Language results', languages]]
    .map(([label, value]) => '<div><span>' + label + '</span><strong>' + (view.loaded ? value : '…') + '</strong></div>').join('');
  $('#live-status').textContent = view.error ? 'Not live' : !view.loaded ? 'Connecting…' : view.fromCache ? 'Offline · showing saved copy' : 'Live · updated ' + view.updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  $('#live-status').dataset.state = view.error || view.fromCache ? 'off' : view.loaded ? 'live' : 'wait';

  if (!view.loaded || !students.length) {
    const message = !view.loaded ? (view.error ? 'No results to show.' : 'Loading results…')
      : view.session ? 'No results yet for ' + esc(sessionLabel(view.session)) + '. Rows appear here as soon as students test their models.' : 'No results yet. Rows appear here as soon as students test their models.';
    $('#results-body').innerHTML = '<tr><td colspan="8" class="dash-empty">' + message + '</td></tr>';
    return;
  }
  $('#results-body').innerHTML = students.map((student) => {
    const open = view.expanded.has(student.studentId), count = student.attempts.length;
    const head = '<tr class="student-row' + (open ? ' open' : '') + '"><th scope="row" class="dash-student-col"><span class="student-name">Student ' + student.number + '</span><span class="student-id" title="Anonymous ID">#' + esc(student.studentId.slice(0, 6)) + '</span><button type="button" class="attempts-toggle" data-student="' + esc(student.studentId) + '" aria-expanded="' + open + '">' + count + ' attempt' + (count === 1 ? '' : 's') + '</button></th>'
      + imageCells(student.image) + languageCells(student.language) + '<td class="time">' + formatTime(student.lastAt) + '</td></tr>';
    if (!open) return head;
    const seen = { image: 0, language: 0 };
    return head + student.attempts.map((attempt) => '<tr class="attempt-row"><th scope="row" class="dash-student-col">' + (attempt.kind === 'image' ? 'Image test' : 'Language test') + ' ' + (++seen[attempt.kind]) + (view.session ? '' : ' <span class="student-id">' + esc(sessionLabel(attempt.sessionId)) + '</span>') + '</th>'
      + (attempt.kind === 'image' ? imageCells(attempt) + empty('band-language') : empty('band-image') + languageCells(attempt)) + '<td class="time">' + formatTime(millisOf(attempt)) + '</td></tr>').join('');
  }).join('');
}

function listen() {
  view.loaded = false; view.error = ''; view.records = []; view.surveys = [];
  render();
  const { sdk, db } = fb;
  const results = sdk.query(sdk.collection(db, RESULTS_COLLECTION), sdk.orderBy('createdAt', 'desc'), sdk.limit(MAX_RESULTS));
  unsubscribe = sdk.onSnapshot(results, { includeMetadataChanges: true }, (snapshot) => {
    const docs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    view.surveys = docs.filter((r) => r.kind === 'survey' && typeof r.studentId === 'string');
    view.records = docs
      .filter((r) => (r.kind === 'image' || r.kind === 'language') && typeof r.studentId === 'string')
      .filter((r) => r.kind !== 'image' || r.nearestTotal === IMAGE_TEST_TOTAL)
      .filter((r) => r.kind !== 'language' || r.total === LANGUAGE_TEST_TOTAL);
    view.loaded = true; view.error = ''; view.updatedAt = new Date(); view.fromCache = snapshot.metadata.fromCache;
    render();
  }, (error) => {
    view.error = error.code === 'permission-denied' ? 'permission-denied' : (error.code || error.message);
    unsubscribe = null;
    render();
  });
}
function stopListening() { unsubscribe?.(); unsubscribe = null; }

function selectSession(code) {
  view.session = code;
  store.set('lesson00.results.session', code);
  const url = new URL(location.href);
  if (code) url.searchParams.set('session', code); else url.searchParams.delete('session');
  history.replaceState(null, '', url);
  render();
}

async function signIn() {
  setAuthError('');
  $('#sign-in').disabled = true;
  try {
    const provider = new fb.sdk.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await fb.sdk.signInWithPopup(fb.auth, provider);
  } catch (error) {
    const messages = {
      'auth/popup-closed-by-user': '',
      'auth/cancelled-popup-request': '',
      'auth/popup-blocked': 'The browser blocked the sign-in window. Allow pop-ups for this site and try again.',
      'auth/unauthorized-domain': 'This web address is not authorized for sign-in. Add it in Firebase Console → Authentication → Settings → Authorized domains.',
      'auth/operation-not-allowed': 'Google sign-in is not enabled. Turn it on in Firebase Console → Authentication → Sign-in method.',
      'auth/network-request-failed': 'No connection to Firebase. Check the internet connection and try again.',
    };
    setAuthError(error.code in messages ? messages[error.code] : 'Sign-in failed (' + (error.code || error.message) + ').');
  } finally {
    $('#sign-in').disabled = false;
  }
}

async function copyLink() {
  const input = $('#share-url'), button = $('#copy-link');
  try { await navigator.clipboard.writeText(input.value); }
  catch { input.select(); document.execCommand('copy'); }
  button.textContent = 'Copied';
  setTimeout(() => { button.textContent = 'Copy link'; }, 1800);
}

function setLargeText(on) {
  document.body.classList.toggle('dash-large', on);
  $('#text-size').setAttribute('aria-pressed', String(on));
  store.set('lesson00.results.large', on ? '1' : '');
}

$('#sign-in').addEventListener('click', signIn);
$('#sign-out').addEventListener('click', () => fb && fb.sdk.signOut(fb.auth));
$('#session-filter').addEventListener('change', (event) => selectSession(event.target.value));
$('#new-session').addEventListener('click', () => {
  view.generated = newSessionCode();
  store.set('lesson00.results.generated', view.generated);
  selectSession(view.generated);
  $('#share-url').focus();
  $('#share-url').select();
});
$('#copy-link').addEventListener('click', copyLink);
$('#text-size').addEventListener('click', () => setLargeText(!document.body.classList.contains('dash-large')));
$('#results-body').addEventListener('click', (event) => {
  const toggle = event.target.closest('.attempts-toggle');
  if (!toggle) return;
  const id = toggle.dataset.student;
  if (view.expanded.has(id)) view.expanded.delete(id); else view.expanded.add(id);
  render();
  document.querySelector('.attempts-toggle[data-student="' + CSS.escape(id) + '"]')?.focus();
});
setLargeText(store.get('lesson00.results.large') === '1');

try {
  const sdk = await import('./firebase.js');
  fb = { sdk, ...sdk.getFirebase('teacher') };
  sdk.onAuthStateChanged(fb.auth, (user) => {
    stopListening();
    show('#boot-status', false);
    const signedIn = Boolean(user && !user.isAnonymous);
    show('#signed-out', !signedIn); show('#signed-in', signedIn); show('#account', signedIn);
    view.email = user?.email || '';
    $('#account-email').textContent = view.email;
    if (signedIn) listen();
  });
} catch (error) {
  console.error(error);
  $('#boot-status').textContent = 'Firebase could not load. Check the internet connection, then reload this page.';
  $('#boot-status').classList.add('dash-error');
}
