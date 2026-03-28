const { getDb, verifyAuth } = require('../_lib/firebaseAdmin');
const { sendJson, parseJsonBody } = require('../_lib/http');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const authUser = await verifyAuth(req);
    if (!authUser) return sendJson(res, 401, { error: 'Authentication required' });

    const body = await parseJsonBody(req);
    const presentation = body.presentation;
    if (!presentation || !presentation.verificationCode) {
      return sendJson(res, 400, { error: 'presentation.verificationCode is required' });
    }

    const db = getDb();
    const code = presentation.verificationCode;
    const ref = db.collection('presentations').doc(code);
    const existing = await ref.get();
    if (existing.exists) {
      const ownerUid = existing.data()?.ownerUid;
      if (ownerUid && ownerUid !== authUser.uid) {
        return sendJson(res, 403, { error: 'Presentation code is owned by another account' });
      }
    }

    await ref.set({
      code,
      ownerUid: authUser.uid,
      ownerEmail: authUser.email || null,
      presentation,
      updatedAt: new Date().toISOString(),
      createdAt: existing.exists ? existing.data().createdAt : new Date().toISOString(),
    }, { merge: true });

    return sendJson(res, 200, { ok: true, code });
  } catch (e) {
    return sendJson(res, 500, { error: e.message || 'Save presentation failed' });
  }
};
