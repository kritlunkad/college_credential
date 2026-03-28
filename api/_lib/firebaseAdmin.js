const admin = require('firebase-admin');

function normalizeBucketName(raw) {
  return String(raw || '')
    .trim()
    .replace(/^gs:\/\//i, '')
    .replace(/^https?:\/\/storage\.googleapis\.com\//i, '')
    .replace(/\/+$/, '');
}

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
    const storageBucket = normalizeBucketName(process.env.FIREBASE_STORAGE_BUCKET || '') || undefined;
    admin.initializeApp({
      credential: admin.credential.cert(cfg),
      ...(storageBucket ? { storageBucket } : {}),
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

function getStorageBucketNames() {
  const cfg = getFirebaseConfig();
  const names = [];
  const envName = normalizeBucketName(process.env.FIREBASE_STORAGE_BUCKET || '');
  if (envName) names.push(envName);
  if (cfg.projectId) {
    names.push(`${cfg.projectId}.appspot.com`);
    names.push(`${cfg.projectId}.firebasestorage.app`);
  }
  return Array.from(new Set(names.filter(Boolean)));
}

function getStorageBucket(explicitBucketName = '') {
  const app = ensureFirebase();
  const fromArg = normalizeBucketName(explicitBucketName);
  const names = fromArg ? [fromArg] : getStorageBucketNames();
  const bucketName = names[0];
  if (!bucketName) {
    throw new Error('Storage bucket not configured. Set FIREBASE_STORAGE_BUCKET (e.g. your-project-id.appspot.com).');
  }
  return app.storage().bucket(bucketName);
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
  getStorageBucketNames,
  getStorageBucket,
  verifyAuth,
  isAdminUser,
};
