const { Resend } = require('resend');

const getRequiredEnv = (key) => {
  const value = process.env[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return value.trim();
};

const getOptionalEnv = (key) => {
  const value = process.env[key];
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  return value.trim();
};

let resendClient;
const getResend = () => {
  if (!resendClient) {
    resendClient = new Resend(getRequiredEnv('RESEND_API_KEY'));
  }
  return resendClient;
};

const escapeHtml = (input) => {
  return String(input)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
};

const baseLayout = ({ title, preheader, bodyHtml }) => {
  const safeTitle = escapeHtml(title);
  const safePreheader = escapeHtml(preheader || '');
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
  </head>
  <body style="margin:0;padding:0;background:#f6f7fb;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safePreheader}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f7fb;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 18px rgba(16,24,40,.08);">
            <tr>
              <td style="padding:28px 28px 0 28px;">
                <h1 style="margin:0;font-size:20px;line-height:28px;color:#101828;">${safeTitle}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 28px 28px;color:#475467;font-size:14px;line-height:22px;">
                ${bodyHtml}
              </td>
            </tr>
          </table>
          <div style="font-size:12px;line-height:18px;color:#98a2b3;margin-top:14px;">
            Email được gửi tự động, vui lòng không trả lời.
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};

const button = ({ href, label }) => {
  const safeHref = String(href);
  const safeLabel = escapeHtml(label);
  return `<div style="margin:18px 0 20px 0;">
  <a href="${safeHref}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600;font-size:14px;">
    ${safeLabel}
  </a>
</div>`;
};

const codeLink = (href) => {
  const safeHref = String(href);
  return `<div style="margin-top:10px;font-size:12px;line-height:18px;color:#667085;">
  Nếu nút không hoạt động, mở link này: <a href="${safeHref}" style="color:#2563eb;text-decoration:underline;">${escapeHtml(
    safeHref
  )}</a>
</div>`;
};

const verificationTemplate = ({ user, verificationLink, expiresHours }) => {
  const name = user?.username || user?.email || 'bạn';
  const safeName = escapeHtml(name);
  const safeHours = escapeHtml(expiresHours);

  const bodyHtml = `
<p style="margin:0 0 10px 0;">Chào ${safeName},</p>
<p style="margin:0 0 16px 0;">Vui lòng xác minh tài khoản của bạn bằng cách nhấn nút bên dưới.</p>
${button({ href: verificationLink, label: 'Xác minh email' })}
<p style="margin:0;">Link này sẽ hết hạn sau ${safeHours} giờ.</p>
${codeLink(verificationLink)}
`;

  return baseLayout({
    title: 'Xác minh email của bạn',
    preheader: 'Xác minh tài khoản để bắt đầu sử dụng.',
    bodyHtml,
  });
};

const passwordResetTemplate = ({ user, resetLink, expiresMinutes }) => {
  const name = user?.username || user?.email || 'bạn';
  const safeName = escapeHtml(name);
  const safeMinutes = escapeHtml(expiresMinutes);

  const bodyHtml = `
<p style="margin:0 0 10px 0;">Chào ${safeName},</p>
<p style="margin:0 0 16px 0;">Bạn đã yêu cầu đặt lại mật khẩu. Nhấn nút bên dưới để tiếp tục.</p>
${button({ href: resetLink, label: 'Đặt lại mật khẩu' })}
<p style="margin:0;">Link này sẽ hết hạn sau ${safeMinutes} phút.</p>
${codeLink(resetLink)}
`;

  return baseLayout({
    title: 'Đặt lại mật khẩu',
    preheader: 'Link đặt lại mật khẩu của bạn.',
    bodyHtml,
  });
};

const verifiedSuccessTemplate = ({ user }) => {
  const name = user?.username || user?.email || 'bạn';
  const safeName = escapeHtml(name);
  const frontendUrl = getOptionalEnv('FRONTEND_URL');

  const bodyHtml = `
<p style="margin:0 0 10px 0;">Chào ${safeName},</p>
<p style="margin:0 0 16px 0;">Email của bạn đã được xác minh thành công. Bạn có thể đăng nhập và sử dụng hệ thống.</p>
${frontendUrl ? button({ href: `${frontendUrl}/auth/login`, label: 'Đăng nhập' }) : ''}
`;

  return baseLayout({
    title: 'Xác minh email thành công',
    preheader: 'Tài khoản của bạn đã được xác minh.',
    bodyHtml,
  });
};

const sendHtmlEmail = async ({ to, subject, html }) => {
  const from = getRequiredEnv('EMAIL_FROM');
  const resend = getResend();
  const result = await resend.emails.send({ from, to, subject, html });

  if (result?.error) {
    const err = new Error(result.error?.message || 'Failed to send email');
    err.details = result.error;
    throw err;
  }

  return result;
};

module.exports = {
  async sendVerificationEmail(user, verificationLink, { expiresHours = 24 } = {}) {
    if (!user?.email) throw new Error('User email is required');
    const html = verificationTemplate({ user, verificationLink, expiresHours });
    return await sendHtmlEmail({
      to: user.email,
      subject: 'Xác minh email của bạn',
      html,
    });
  },

  async sendPasswordResetEmail(user, resetLink, { expiresMinutes = 30 } = {}) {
    if (!user?.email) throw new Error('User email is required');
    const html = passwordResetTemplate({ user, resetLink, expiresMinutes });
    return await sendHtmlEmail({
      to: user.email,
      subject: 'Đặt lại mật khẩu',
      html,
    });
  },

  async sendVerifiedSuccessEmail(user) {
    if (!user?.email) throw new Error('User email is required');
    const html = verifiedSuccessTemplate({ user });
    return await sendHtmlEmail({
      to: user.email,
      subject: 'Email đã được xác minh',
      html,
    });
  },
};

