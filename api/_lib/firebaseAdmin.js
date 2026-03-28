const admin = require('firebase-admin');

function getPrivateKey() {
  const raw = process.env.FIREBASE_PRIVATE_KEY || '';
  return raw.replace(/\\n/g, '\n');
}

function getFirebaseConfig() {
  return {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: getPrivateKey(),
  };
}

function ensureFirebase() {
  if (!admin.apps.length) {
    const cfg = getFirebaseConfig();
    if (!cfg.projectId || !cfg.clientEmail || !cfg.privateKey) {
      throw new Error('Firebase admin env vars are missing');
    }
    admin.initializeApp({
      credential: admin.credential.cert(cfg),
    });
  }
  return admin;
}

function getDb() {
  return ensureFirebase().firestore();
}

function getAuth() {
  return ensureFirebase().auth();
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7).trim();
}

async function verifyAuth(req) {
  const token = getBearerToken(req);
  if (!token) return null;
  const auth = getAuth();
  return await auth.verifyIdToken(token);
}

function getAdminEmailSet() {
  const raw = process.env.COLLEGE_ADMIN_EMAILS || '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

function isAdminUser(decodedToken) {
  if (!decodedToken) return false;
  const email = (decodedToken.email || '').toLowerCase();
  const admins = getAdminEmailSet();
  return admins.has(email);
}

module.exports = {
  getDb,
  getAuth,
  verifyAuth,
  isAdminUser,
};
