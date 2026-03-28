const { getDb, verifyAuth, isAdminUser } = require('../../_lib/firebaseAdmin');
const { sendJson } = require('../../_lib/http');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const authUser = await verifyAuth(req);
    if (!authUser) return sendJson(res, 401, { error: 'Authentication required' });

    const { claimCode } = req.query;
    const code = String(claimCode || '').trim().toUpperCase();
    if (!code) return sendJson(res, 400, { error: 'claimCode is required' });

    const db = getDb();
    const q = await db.collection('credentials').where('claimCode', '==', code).limit(1).get();
    if (q.empty) return sendJson(res, 404, { error: 'Claim code not found' });

    const row = q.docs[0].data();
    const credential = row.credential;
    if (!credential) return sendJson(res, 404, { error: 'Credential not found for claim code' });

    if (!isAdminUser(authUser)) {
      const email = (authUser.email || '').trim().toLowerCase();
      const assignedEmail = (row.studentEmail || credential.credentialSubject?.studentEmail || '').trim().toLowerCase();
      const assignedUid = row.studentUid || credential.credentialSubject?.studentUid || null;
      const allowed = (assignedUid && assignedUid === authUser.uid)
        || (assignedEmail && email && assignedEmail === email);
      if (!allowed) {
        return sendJson(res, 403, { error: 'This claim code is not assigned to the logged-in student.' });
      }
    }

    return sendJson(res, 200, { ok: true, credential });
  } catch (e) {
    return sendJson(res, 500, { error: e.message || 'Claim by code failed' });
  }
};
