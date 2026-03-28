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

    if (!adminUser) {
      const bindingId = `${authUser.uid}_${enrollmentId}`;
      const bindingSnap = await db.collection('studentEnrollmentBindings').doc(bindingId).get();
      if (!bindingSnap.exists) {
        return sendJson(res, 403, {
          error: 'Enrollment is not linked to this account. Bind enrollment first.',
        });
      }
    }

    const q = await db.collection('credentials').where('enrollmentId', '==', enrollmentId).get();
    const credentials = q.docs.map((d) => d.data().credential).filter(Boolean);
    return sendJson(res, 200, { ok: true, credentials });
  } catch (e) {
    return sendJson(res, 500, { error: e.message || 'Credentials API failed' });
  }
};
