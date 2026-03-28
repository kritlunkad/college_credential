const crypto = require('crypto');
const { getDb, verifyAuth, isAdminUser } = require('./_lib/firebaseAdmin');
const { sendJson, parseJsonBody } = require('./_lib/http');
const { sendClaimCodeEmail } = require('./_lib/email');

const MAX_SOURCE_DOC_BYTES = 2 * 1024 * 1024; // 2MB for serverless safety

function generateClaimCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function sanitizeFileName(name) {
  return String(name || 'document.bin')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120);
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function hashSourceDocumentIfProvided(sourceDocument) {
  if (!sourceDocument) {
    return { uploaded: false, skipped: true, reason: 'No source document provided' };
  }

  const fileName = sanitizeFileName(sourceDocument.fileName);
  const mimeType = String(sourceDocument.mimeType || 'application/octet-stream');
  const providedHash = String(sourceDocument.sha256 || '').trim().toLowerCase();
  const raw = String(sourceDocument.contentBase64 || '');
  const contentBase64 = raw.includes(',') ? raw.split(',').pop() : raw;

  if (!contentBase64 && !providedHash) {
    return { uploaded: false, skipped: false, reason: 'Document hash or content is required' };
  }

  let computedHash = providedHash || null;
  let computedSize = Number(sourceDocument.sizeBytes || 0);
  if (contentBase64) {
    const bytes = Buffer.from(contentBase64, 'base64');
    if (!bytes.length) {
      return { uploaded: false, skipped: false, reason: 'Document content could not be decoded' };
    }
    if (bytes.length > MAX_SOURCE_DOC_BYTES) {
      return { uploaded: false, skipped: false, reason: 'Document exceeds 2MB upload limit' };
    }
    const hashFromContent = sha256Hex(bytes);
    if (providedHash && providedHash !== hashFromContent) {
      return { uploaded: false, skipped: false, reason: 'Document hash mismatch' };
    }
    computedHash = hashFromContent;
    computedSize = bytes.length;
  }

  if (!computedHash) {
    return { uploaded: false, skipped: false, reason: 'Unable to compute document hash' };
  }
  return {
    uploaded: true,
    skipped: false,
    mode: 'hash_only',
    fileName,
    mimeType,
    sizeBytes: computedSize,
    sha256: computedHash,
    uploadedAt: new Date().toISOString(),
  };
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

    const documentResult = await hashSourceDocumentIfProvided(body.sourceDocument || null);

    if (documentResult.uploaded) {
      credential.documentEvidence = {
        type: body.sourceDocument?.type || null,
        fileName: documentResult.fileName,
        mimeType: documentResult.mimeType,
        sizeBytes: documentResult.sizeBytes,
        sha256: documentResult.sha256,
        storagePath: null,
        uploadedAt: documentResult.uploadedAt,
        status: 'hash_only',
        reason: null,
      };
    } else if (body.sourceDocument) {
      credential.documentEvidence = {
        type: body.sourceDocument.type || null,
        fileName: sanitizeFileName(body.sourceDocument.fileName || ''),
        mimeType: body.sourceDocument.mimeType || 'application/octet-stream',
        sizeBytes: Number(body.sourceDocument.sizeBytes || 0),
        sha256: (body.sourceDocument.sha256 || '').toLowerCase() || null,
        storagePath: null,
        uploadedAt: null,
        status: documentResult.skipped ? 'skipped' : 'failed',
        reason: documentResult.reason || 'Upload failed',
      };
    }

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
      document: credential.documentEvidence || null,
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
      document: documentResult,
    });
  } catch (e) {
    return sendJson(res, 500, { error: e.message || 'Issue API failed' });
  }
};
