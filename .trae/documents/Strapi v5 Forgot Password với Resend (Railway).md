## Tóm tắt hiện trạng
- Dự án đang chạy Strapi v5.33.4, `config/plugins.ts` hiện để trống nên Email feature rơi về provider mặc định **sendmail** → Railway không có mail server/OS service nên `/api/auth/forgot-password` bị 500.
- Mục tiêu là chuyển sang **provider email dạng API** (Resend), không dùng SMTP/sendmail. (Strapi Email feature docs: https://docs.strapi.io/cms/features/email)

## 1) Email provider (Resend) – không SMTP
- Cài provider Resend.
  - Lưu ý: trên Strapi Marketplace/Integration hiện phổ biến là **`strapi-provider-email-resend`** (community provider), không thấy gói chính thức `@strapi/provider-email-resend` trong các nguồn công khai. (Strapi Resend integration guide: https://strapi.io/integrations/resend)
  - Khi implement sẽ ưu tiên thử đúng tên gói bạn yêu cầu; nếu npm không có thì fallback sang `strapi-provider-email-resend` để đảm bảo chạy được ngay trên Railway.

## 2) Cấu hình provider trong `config/plugins.ts`
- Sửa `config/plugins.ts` để bật Email feature và dùng provider Resend, đọc key từ env `RESEND_API_KEY`.
- Cấu hình thêm `settings.defaultFrom/defaultReplyTo` lấy từ env (ví dụ `RESEND_DEFAULT_FROM`, `RESEND_DEFAULT_REPLY_TO`) để không hardcode.
- Sau khi cấu hình, xác minh provider đã load bằng Admin UI: **Settings → Email feature → Configuration → Send test email** (Email feature docs).

## 3) Biến môi trường cần set trên Railway
- Bắt buộc (email):
  - `RESEND_API_KEY`
  - `RESEND_DEFAULT_FROM` (email From đã verify trên Resend)
  - `RESEND_DEFAULT_REPLY_TO` (tuỳ chọn nhưng nên có)
- Bắt buộc (flow reset password phía frontend):
  - `FRONTEND_URL` (ví dụ `https://app.example.com`)
- Khuyến nghị (chuẩn URL backend khi chạy sau proxy Railway):
  - `PUBLIC_URL` (ví dụ `https://api.example.com`) để set `server.url`
  - `NODE_ENV=production`
- Khuyến nghị (expiry token reset):
  - `UP_RESET_PASSWORD_TOKEN_TTL_MINUTES` (ví dụ 60)

### Railway variables khác local `.env` như thế nào
- Local: `.env` nằm trong repo máy dev, Strapi đọc qua `env()`.
- Railway: cấu hình ở **Project → Variables**, Railway inject vào runtime/build, không commit vào git. Không hardcode secrets trong code.

## 4) Đồng bộ URL backend (quan trọng cho link/email template)
- Sửa `config/server.ts` để có:
  - `url: env('PUBLIC_URL', 'http://localhost:1337')`
  - `proxy: true` (khuyến nghị khi deploy sau reverse proxy)
- Mục đích: các biến template như `SERVER_URL`, `ADMIN_URL` và các link hệ thống không bị `localhost`.

## 5) Cấu hình Users & Permissions trong Strapi Admin
Theo docs Users & Permissions v5 (https://docs.strapi.io/cms/features/users-permissions):
- **Reset password page URL**:
  - Vào: Settings → Users & Permissions plugin → Advanced settings
  - Set “Reset password page” = `${FRONTEND_URL}/reset-password`
- **Email templates**:
  - Vào: Settings → Users & Permissions plugin → Email templates → “Reset password”
  - Set Shipper email/Response email phù hợp (khớp domain Resend đã verify)
  - Dán HTML template (bên dưới)

## 6) Email template (HTML) đúng biến Strapi, link clickable
- Strapi v5 dùng template variables (lodash template). Các key phổ biến/được whitelist gồm `URL`, `CODE`, `USER`… (tham khảo thảo luận cộng đồng về whitelist keys: https://forum.strapi.io/t/adding-custom-vars-to-email-templates-user-email-confirmation-frontend-url-use-case/49311)
- Mẫu HTML sẽ dùng:
  - Link chính: `${URL}?code=${CODE}`
  - Fallback plain URL: in ra nguyên URL để client chặn button vẫn copy được.

## 7) Forgot Password & Reset Password flow (default endpoints)
- **Forgot**: `POST /api/auth/forgot-password` với body `{ "email": "..." }`
  - Kỳ vọng: luôn trả **200** (dù email tồn tại hay không) để tránh lộ thông tin tài khoản (chống account enumeration).
  - Nếu provider email ok, request sẽ không 500 nữa trên Railway.
- **Reset**: `POST /api/auth/reset-password` với body `{ code, password, passwordConfirmation }`

## 8) Token expiry + one-time use (production-ready)
- Thực tế: cộng đồng ghi nhận reset password token **có thể không có expiry mặc định** ở nhiều phiên bản, nên để “production-ready” sẽ implement expiry.
- Hướng triển khai trong codebase:
  - Mở rộng content-type `plugin::users-permissions.user` để thêm field datetime `resetPasswordTokenExpiresAt`.
  - Override logic `forgotPassword` để set expiry = now + `UP_RESET_PASSWORD_TOKEN_TTL_MINUTES`.
  - Override logic `resetPassword` để:
    - kiểm tra token tồn tại + chưa hết hạn
    - reset xong thì clear token + clear expiry (đảm bảo one-time use)
  - Cách override trong v5 ổn định nhất: gắn controller mới vào plugin trong `src/index.ts` (register hook), vì việc override qua `src/extensions/.../strapi-server.js|ts` từng có thay đổi/issue ở v5.
  - Thêm migration Knex trong `database/migrations/` để add column trên Postgres.

## 9) Debugging & Verification checklist
- Provider loaded:
  - Admin → Settings → Email feature → Configuration hiển thị config và “Send test email” thành công.
- API key detected:
  - Log startup không báo thiếu `RESEND_API_KEY`.
  - Nếu lỗi 401/403 từ Resend: kiểm tra key đúng project, không có khoảng trắng.
- Forgot password trả 200:
  - Gọi `POST /api/auth/forgot-password` với email bất kỳ → status 200.
- Email delivered:
  - Check Resend dashboard (sent events).
  - Kiểm tra From domain đã verify (SPF/DKIM), nếu chưa thường bị reject hoặc vào spam.
- Misconfig hay gặp:
  - `defaultFrom` dùng domain chưa verify
  - nhầm biến env trên Railway (khác tên, set ở service khác)
  - backend URL/proxy thiếu → link trỏ localhost

## 10) Production hardening (quan trọng)
- Rate limiting cho auth endpoints:
  - Bật/siết `plugin.users-permissions.ratelimit` (Strapi đã có middleware/policy cho nhóm `/api/auth/*`), tăng an toàn trước brute force/spam.
  - Lưu ý: store mặc định thường là memory → nếu scale nhiều instance cần Redis hoặc rate limit ở edge (Cloudflare/WAF).
- Captcha/abuse protection:
  - Khuyến nghị thêm reCAPTCHA/Turnstile ở frontend và/hoặc policy kiểm tra token captcha trước khi cho gọi forgot-password.
- Logging & monitoring:
  - Log các sự kiện gửi mail (success/fail) với correlation id, không log email body/token.
  - Bật Resend webhooks để audit delivery/bounce/complaint.

## Những thay đổi sẽ thực hiện trong repo (sau khi bạn xác nhận)
- `package.json`: thêm dependency provider Resend
- `config/plugins.ts`: cấu hình email provider Resend + cấu hình ratelimit users-permissions
- `config/server.ts`: set `url/proxy`
- `src/index.ts`: register override controllers cho forgot/reset để enforce expiry
- `src/extensions/users-permissions/...`: extend user schema (thêm expiry field)
- `database/migrations/*.js`: migration add column expiry

Nếu bạn xác nhận, mình sẽ triển khai toàn bộ code + cấu hình theo đúng checklist, đảm bảo deploy lên Railway chạy ngay và không dùng SMTP/sendmail.