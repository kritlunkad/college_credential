const { getDb, verifyAuth } = require('../_lib/firebaseAdmin');
const { sendJson, parseJsonBody } = require('../_lib/http');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const authUser = await verifyAuth(req);
    if (!authUser) return sendJson(res, 401, { error: 'Authentication required' });

    const body = await parseJsonBody(req);
    const enrollmentId = (body.enrollmentId || '').trim();
    if (!enrollmentId) return sendJson(res, 400, { error: 'enrollmentId is required' });

    const db = getDb();
    const docId = `${authUser.uid}_${enrollmentId}`;
    await db.collection('studentEnrollmentBindings').doc(docId).set({
      uid: authUser.uid,
      email: authUser.email || null,
      enrollmentId,
      createdAt: new Date().toISOString(),
    }, { merge: true });

    return sendJson(res, 200, { ok: true, enrollmentId });
  } catch (e) {
    return sendJson(res, 500, { error: e.message || 'Bind enrollment failed' });
  }
};
