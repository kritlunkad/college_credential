const { getDb, verifyAuth, isAdminUser } = require('./_lib/firebaseAdmin');
const { sendJson, parseJsonBody } = require('./_lib/http');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  try {
    const authUser = await verifyAuth(req);
    if (!isAdminUser(authUser)) {
      return sendJson(res, 403, { error: 'Admin authentication required' });
    }

    const body = await parseJsonBody(req);
    const credential = body.credential;
    if (!credential || !credential.id || !credential.credentialSubject?.enrollmentId) {
      return sendJson(res, 400, { error: 'Invalid credential payload' });
    }

    const db = getDb();
    const enrollmentId = credential.credentialSubject.enrollmentId;
    const issuerName = credential.issuer?.name || 'Unknown Issuer';
    const issuerId = credential.issuer?.id || '';

    await db.collection('credentials').doc(credential.id).set({
      credential,
      enrollmentId,
      issuerName,
      issuerId,
      issuerWalletAddress: credential.issuer?.walletAddress || null,
      studentUid: credential.credentialSubject?.studentUid || null,
      studentEmail: credential.credentialSubject?.studentEmail || null,
      createdAt: new Date().toISOString(),
      createdByUid: authUser.uid,
      createdByEmail: authUser.email || null,
    });

    if (credential.issuerPublicKey && issuerName) {
      await db.collection('trustedIssuers').doc(issuerName).set({
        issuerName,
        issuerId,
        jwk: credential.issuerPublicKey,
        walletAddress: credential.issuer?.walletAddress || null,
        updatedAt: new Date().toISOString(),
        updatedByUid: authUser.uid,
      }, { merge: true });
    }

    return sendJson(res, 200, { ok: true, credentialId: credential.id });
  } catch (e) {
    return sendJson(res, 500, { error: e.message || 'Issue API failed' });
  }
};
