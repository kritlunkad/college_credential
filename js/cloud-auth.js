/**
 * cloud-auth.js — Firebase Auth wrapper for static pages
 * Uses compat SDK loaded via CDN script tags.
 */

const CloudAuth = (() => {
  let initialized = false;
  let currentUser = null;
  const listeners = [];

  function ensureInit() {
    if (initialized) return;
    if (typeof firebase === 'undefined') {
      console.warn('[CloudAuth] Firebase SDK missing');
      return;
    }
    if (!window.FIREBASE_CONFIG || !window.FIREBASE_CONFIG.apiKey) {
      console.warn('[CloudAuth] FIREBASE_CONFIG missing');
      return;
    }

    if (!firebase.apps.length) {
      firebase.initializeApp(window.FIREBASE_CONFIG);
    }

    firebase.auth().onAuthStateChanged((user) => {
      currentUser = user || null;
      listeners.forEach((cb) => cb(currentUser));
    });

    // Consume redirect sign-in results (if popup fallback used).
    firebase.auth().getRedirectResult().catch((err) => {
      console.warn('[CloudAuth] Redirect sign-in result error:', err?.message || err);
    });

    initialized = true;
  }

  function onChange(cb) {
    ensureInit();
    listeners.push(cb);
    cb(currentUser);
    return () => {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  async function signInStudentGoogle() {
    ensureInit();
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      await firebase.auth().signInWithPopup(provider);
    } catch (err) {
      const msg = String(err?.message || '').toLowerCase();
      const shouldFallbackToRedirect =
        err?.code === 'auth/popup-blocked' ||
        msg.includes('cross-origin-opener-policy') ||
        msg.includes('window.closed');
      if (!shouldFallbackToRedirect) throw err;
      await firebase.auth().signInWithRedirect(provider);
      return null;
    }
    return firebase.auth().currentUser;
  }

  async function signInAdminEmailPassword(email, password) {
    ensureInit();
    await firebase.auth().signInWithEmailAndPassword(email, password);
    return firebase.auth().currentUser;
  }

  async function signOut() {
    ensureInit();
    await firebase.auth().signOut();
  }

  function getUser() {
    ensureInit();
    return currentUser;
  }

  async function getIdToken() {
    ensureInit();
    const user = firebase.auth().currentUser;
    if (!user) return null;
    return await user.getIdToken(true);
  }

  return {
    onChange,
    signInStudentGoogle,
    signInAdminEmailPassword,
    signOut,
    getUser,
    getIdToken,
  };
})();
