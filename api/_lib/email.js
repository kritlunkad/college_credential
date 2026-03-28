async function sendClaimCodeEmail({
  to,
  claimCode,
  studentName,
  enrollmentId,
  claimUrl,
}) {
  const host = process.env.SMTP_HOST || '';
  const portRaw = process.env.SMTP_PORT || '';
  const port = Number(portRaw || 587);
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';
  const from = process.env.CLAIM_EMAIL_FROM || process.env.SMTP_FROM || '';
  const secure = (process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;

  if (!to) {
    return { sent: false, skipped: true, reason: 'Recipient missing' };
  }
  if (!host || !port || !user || !pass || !from) {
    return { sent: false, skipped: true, reason: 'SMTP env vars missing' };
  }

  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch (_e) {
    return { sent: false, skipped: true, reason: 'nodemailer not installed' };
  }

  const safeName = studentName || 'Student';
  const subject = `Your CredChain Claim Code: ${claimCode}`;
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;">
      <h2>Credential Claim Details</h2>
      <p>Hello ${safeName},</p>
      <p>Your credential has been issued.</p>
      <p><strong>Enrollment ID:</strong> ${enrollmentId || '—'}</p>
      <p><strong>Claim Code:</strong> <span style="font-size:18px;letter-spacing:2px;">${claimCode}</span></p>
      <p>Claim link: <a href="${claimUrl}">${claimUrl}</a></p>
      <p>If the link does not open, go to Wallet page and enter the claim code manually.</p>
    </div>
  `;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      html,
      text: [
        'Credential Claim Details',
        `Hello ${safeName},`,
        'Your credential has been issued.',
        `Enrollment ID: ${enrollmentId || '—'}`,
        `Claim Code: ${claimCode}`,
        `Claim link: ${claimUrl}`,
      ].join('\n'),
    });
    return { sent: true, skipped: false, id: info.messageId || null };
  } catch (e) {
    return {
      sent: false,
      skipped: false,
      reason: e.message || 'SMTP send failed',
    };
  }
}

module.exports = {
  sendClaimCodeEmail,
};
