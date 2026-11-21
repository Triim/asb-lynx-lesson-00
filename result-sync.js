// Saves student experiment results to Firestore in the background. Every failure stays inside
// this module: the lesson keeps working offline and only the small save indicator changes.
import { firebaseConfig } from './firebase-config.js';
import { RESULTS_COLLECTION, isAttemptId } from './result-records.js';

const SLOW_SAVE_MS = 10000;
const messages = {
  saving: 'Saving result…',
  waiting: 'Saving… waiting for connection',
  saved: 'Result saved',
  failed: 'Result not saved',
};

export function createResultSync({ sessionId, element }) {
  const enabled = Boolean(firebaseConfig?.projectId && firebaseConfig?.apiKey);
  const attempts = new Map(); // attempt ID → { data, status, error }
  let firebase = null, student = null;

  function loadFirebase() {
    firebase ||= import('./firebase.js').then((sdk) => ({ sdk, ...sdk.getFirebase('student') }));
    return firebase.catch((error) => { firebase = null; throw error; });
  }
  function signInStudent(fb) {
    student ||= (async () => {
      await fb.auth.authStateReady();
      if (fb.auth.currentUser?.isAnonymous) return fb.auth.currentUser;
      return (await fb.sdk.signInAnonymously(fb.auth)).user;
    })();
    return student.catch((error) => { student = null; throw error; });
  }

  function render() {
    if (!element) return;
    const states = [...attempts.values()].map((attempt) => attempt.status);
    const state = ['failed', 'waiting', 'saving', 'saved'].find((name) => states.includes(name));
    element.hidden = !state;
    if (!state) return;
    element.dataset.state = state;
    const failed = [...attempts.values()].filter((attempt) => attempt.status === 'failed');
    element.title = failed.length ? 'The lesson still works. Your teacher will not see this result until it is saved. (' + failed[0].error + ')' : '';
    element.innerHTML = '<span class="save-status-dot" aria-hidden="true"></span><span>' + messages[state] + '</span>'
      + (state === 'failed' ? '<button type="button" class="save-status-retry">Retry</button>' : '');
  }

  async function write(id) {
    const attempt = attempts.get(id);
    attempt.status = 'saving'; attempt.error = '';
    render();
    const slow = setTimeout(() => { if (attempt.status === 'saving') { attempt.status = 'waiting'; render(); } }, SLOW_SAVE_MS);
    try {
      const fb = await loadFirebase();
      const user = await signInStudent(fb);
      // Fixed document ID per attempt: a resend can never create a second copy, and the rules
      // reject overwriting a result that already exists.
      await fb.sdk.setDoc(fb.sdk.doc(fb.db, RESULTS_COLLECTION, id), {
        ...attempt.data, studentId: user.uid, sessionId, createdAt: fb.sdk.serverTimestamp(),
      });
      attempt.status = 'saved';
    } catch (error) {
      // A rejected write was not stored, so retrying with the same ID is safe.
      attempt.status = 'failed';
      attempt.error = error?.code || error?.message || 'unknown error';
      console.warn('Lesson result not saved:', attempt.error);
    } finally {
      clearTimeout(slow);
      render();
    }
  }

  element?.addEventListener('click', (event) => {
    if (!event.target.closest('.save-status-retry')) return;
    for (const [id, attempt] of attempts) if (attempt.status === 'failed') write(id);
  });

  return {
    // Saving the same attempt again (rerender, repeated click) does nothing.
    save(id, data) {
      if (!enabled || !isAttemptId(id) || attempts.has(id)) return;
      attempts.set(id, { data, status: 'saving', error: '' });
      write(id);
    },
  };
}
