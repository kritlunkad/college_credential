const { getDb } = require('../_lib/firebaseAdmin');
const { sendJson } = require('../_lib/http');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const { code } = req.query;
    if (!code) return sendJson(res, 400, { error: 'code is required' });

    const db = getDb();
    const snap = await db.collection('presentations').doc(code).get();
    if (!snap.exists) return sendJson(res, 404, { error: 'Presentation not found' });

    const data = snap.data();
    let presentation = data.presentation || null;
    if (!presentation && data.presentationJson) {
      try {
        presentation = JSON.parse(data.presentationJson);
      } catch (e) {
        return sendJson(res, 500, { error: 'Stored presentation JSON is corrupted' });
      }
    }
    if (!presentation) return sendJson(res, 404, { error: 'Presentation payload not found' });

    return sendJson(res, 200, {
      ok: true,
      code,
      presentation,
      updatedAt: data.updatedAt || null,
    });
  } catch (e) {
    return sendJson(res, 500, { error: e.message || 'Fetch presentation failed' });
  }
};
