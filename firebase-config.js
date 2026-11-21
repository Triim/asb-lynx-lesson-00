// Firebase web app configuration (Project settings → General → Your apps → Web app).
// These values identify the project to the browser; they are not secrets. Access to data is
// controlled by firestore.rules. Never put a service-account key or admin credential here.
export const firebaseConfig = {
  apiKey: 'AIzaSyDVCSuDiiNzjmw64A91XhIw445Li0zVOCA',
  authDomain: 'triallesson-9f872.firebaseapp.com',
  projectId: 'triallesson-9f872',
  storageBucket: 'triallesson-9f872.firebasestorage.app',
  messagingSenderId: '1048897592217',
  appId: '1:1048897592217:web:bd2c628b55e278f32c1108',
};

// Local testing only: e.g. { auth: 'http://127.0.0.1:9099', firestore: ['127.0.0.1', 8080] }.
// Keep null for the published site.
export const emulators = null;
