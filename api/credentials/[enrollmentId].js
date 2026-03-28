const { getDb, verifyAuth, isAdminUser } = require('../_lib/firebaseAdmin');
const { sendJson } = require('../_lib/http');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });

  try {
    const authUser = await verifyAuth(req);
    if (!authUser) return sendJson(res, 401, { error: 'Authentication required' });

    const { enrollmentId } = req.query;
    if (!enrollmentId) return sendJson(res, 400, { error: 'enrollmentId is required' });

    const db = getDb();
    const adminUser = isAdminUser(authUser);
    const bindingId = `${authUser.uid}_${enrollmentId}`;
    const bindingSnap = await db.collection('studentEnrollmentBindings').doc(bindingId).get();
    const hasBinding = bindingSnap.exists;

    const q = await db.collection('credentials').where('enrollmentId', '==', enrollmentId).get();
    const rows = q.docs.map((d) => d.data()).filter(Boolean);
    let credentials = rows.map((r) => r.credential).filter(Boolean);

    if (!adminUser) {
      const email = (authUser.email || '').trim().toLowerCase();
      credentials = rows
        .filter((r) => {
          if (!r.credential) return false;
          const assignedEmail = (r.studentEmail || r.credential.credentialSubject?.studentEmail || '').trim().toLowerCase();
          const assignedUid = r.studentUid || r.credential.credentialSubject?.studentUid || null;
          if (assignedUid && assignedUid === authUser.uid) return true;
          if (assignedEmail && email && assignedEmail === email) return true;
          if (hasBinding) return true;
          return false;
        })
        .map((r) => r.credential);
      if (credentials.length === 0) {
        return sendJson(res, 403, {
          error: 'No assigned credentials for this enrollment ID and user.',
        });
      }
    }

    return sendJson(res, 200, { ok: true, credentials });
  } catch (e) {
    return sendJson(res, 500, { error: e.message || 'Credentials API failed' });
  }
};
