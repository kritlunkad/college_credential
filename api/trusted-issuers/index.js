const { getDb, verifyAuth, isAdminUser } = require('../_lib/firebaseAdmin');
const { sendJson, parseJsonBody } = require('../_lib/http');

module.exports = async function handler(req, res) {
  try {
    const db = getDb();

    if (req.method === 'GET') {
      const q = await db.collection('trustedIssuers').get();
      const issuers = {};
      q.docs.forEach((d) => {
        const row = d.data();
        issuers[row.issuerName || d.id] = {
          publicKey: row.jwk || null,
          issuerId: row.issuerId || null,
          walletAddress: row.walletAddress || null,
          registeredAt: row.updatedAt || row.createdAt || null,
        };
      });
      return sendJson(res, 200, { ok: true, issuers });
    }

    if (req.method === 'POST') {
      const authUser = await verifyAuth(req);
      if (!isAdminUser(authUser)) {
        return sendJson(res, 403, { error: 'Admin authentication required' });
      }
      const body = await parseJsonBody(req);
      const issuerName = (body.issuerName || '').trim();
      const jwk = body.jwk || null;
      if (!issuerName || !jwk) {
        return sendJson(res, 400, { error: 'issuerName and jwk are required' });
      }

      await db.collection('trustedIssuers').doc(issuerName).set({
        issuerName,
        issuerId: body.issuerId || null,
        walletAddress: body.walletAddress || null,
        jwk,
        updatedAt: new Date().toISOString(),
        updatedByUid: authUser.uid,
      }, { merge: true });

      return sendJson(res, 200, { ok: true, issuerName });
    }

    return sendJson(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return sendJson(res, 500, { error: e.message || 'Trusted issuers API failed' });
  }
};
