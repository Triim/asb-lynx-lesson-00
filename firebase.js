// Firebase modular Web SDK, loaded from Google's CDN (no build step). Pages import this file
// with a dynamic import() so a CDN or Firebase outage cannot stop the offline lesson.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js';
import {
  getAuth, initializeAuth, browserSessionPersistence, connectAuthEmulator, onAuthStateChanged,
  signInAnonymously, signInWithPopup, signOut, GoogleAuthProvider,
} from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js';
import {
  getFirestore, connectFirestoreEmulator, collection, doc, setDoc, serverTimestamp, query, orderBy, limit, onSnapshot,
} from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js';
import { firebaseConfig, emulators } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
if (emulators?.firestore) connectFirestoreEmulator(db, ...emulators.firestore);

let auth = null;
// role 'student': the anonymous identity lasts for this browser tab only, so students who share
// a classroom computer get separate IDs. role 'teacher': the Google sign-in is remembered.
export function getFirebase(role) {
  if (!auth) {
    auth = role === 'student' ? initializeAuth(app, { persistence: browserSessionPersistence }) : getAuth(app);
    if (emulators?.auth) connectAuthEmulator(auth, emulators.auth, { disableWarnings: true });
  }
  return { app, auth, db };
}

export {
  onAuthStateChanged, signInAnonymously, signInWithPopup, signOut, GoogleAuthProvider,
  collection, doc, setDoc, serverTimestamp, query, orderBy, limit, onSnapshot,
};
