const { getDb, verifyAuth, isAdminUser } = require('./_lib/firebaseAdmin');
const { sendJson, parseJsonBody } = require('./_lib/http');
const { sendClaimCodeEmail } = require('./_lib/email');

function generateClaimCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

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
    const studentEmail = (body.studentEmail || credential.credentialSubject?.studentEmail || '').trim().toLowerCase();
    const claimCode = (credential.claimCode || generateClaimCode()).trim().toUpperCase();
    credential.claimCode = claimCode;
    if (studentEmail) credential.credentialSubject.studentEmail = studentEmail;

    await db.collection('credentials').doc(credential.id).set({
      credential,
      enrollmentId,
      issuerName,
      issuerId,
      claimCode,
      issuerWalletAddress: credential.issuer?.walletAddress || null,
      studentUid: credential.credentialSubject?.studentUid || null,
      studentEmail: studentEmail || null,
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

    const proto = (req.headers['x-forwarded-proto'] || 'https').toString().split(',')[0];
    const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString().split(',')[0];
    const baseUrl = process.env.APP_BASE_URL || (host ? `${proto}://${host}` : '');
    const claimUrl = baseUrl
      ? `${baseUrl}/wallet.html?claimCode=${encodeURIComponent(claimCode)}`
      : `wallet.html?claimCode=${encodeURIComponent(claimCode)}`;

    const emailResult = await sendClaimCodeEmail({
      to: studentEmail || null,
      claimCode,
      studentName: credential.credentialSubject?.name || null,
      enrollmentId,
      claimUrl,
    });

    return sendJson(res, 200, {
      ok: true,
      credentialId: credential.id,
      claimCode,
      claimUrl,
      email: emailResult,
    });
  } catch (e) {
    return sendJson(res, 500, { error: e.message || 'Issue API failed' });
  }
};
