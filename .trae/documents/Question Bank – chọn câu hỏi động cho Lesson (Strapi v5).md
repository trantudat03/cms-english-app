## Mục Tiêu
- Xây hệ “Question Bank” tách biệt dữ liệu câu hỏi và logic chọn câu hỏi.
- Lesson chỉ tham chiếu Question Bank + số lượng (override), không lưu danh sách câu hỏi.
- Endpoint runtime: `GET /api/lessons/:id/start` trả về câu hỏi đã chọn, không lộ đáp án.

## Mô Hình Dữ Liệu (Content-types)
- **Question** (`api::question.question`)
  - `content` (richtext/text), `type` (enumeration), `options` (json), `correctAnswer` (json, private), `difficulty` (integer/decimal)
  - M2M: `levels`, `skills`, `topics`
- **Level / Skill / Topic** (3 collection types)
  - `code` (string/uid, unique, required), `name` (string), `active` (boolean)
  - Quan hệ ngược M2M về `questions`
- **Question Bank** (`api::question-bank.question-bank`)
  - `name` (string, required), `description` (text), `filters` (json), `defaultQuestionCount` (integer), `shuffle` (boolean), `active` (boolean)
  - O2M: `lessons`
- **Lesson** (`api::lesson.lesson`)
  - `title` (string, required), `description` (text)
  - M2O: `questionBank` (required)
  - `questionCount` (integer, optional override)

## Logic Chọn Câu Hỏi (Tách Service)
- Tạo service `question-selection` (hoặc nằm trong `lesson`/`question-bank` service) để:
  - Parse `questionBank.filters` (JSON) thành Strapi filters.
  - Áp filter dạng **OR trong từng nhóm** bằng `$in` (ví dụ level codes):
    - `levels.code IN [...]`, `skills.code IN [...]`, `topics.code IN [...]`
  - Khi có nhiều nhóm filter cùng lúc, mặc định là **AND giữa các nhóm** (phải match level *và* skill *và* topic nếu cả 3 được cấu hình).
  - Tính `count = lesson.questionCount ?? questionBank.defaultQuestionCount` và clamp (ví dụ max 200) để tránh payload quá lớn.

## Endpoint Runtime: `GET /api/lessons/:id/start`
- Tạo custom route theo Strapi v5 RouterConfig (`type: 'content-api'`) và đặt tên file có prefix `01-...` để load trước core routes (Strapi load theo alphabet) theo docs Routes của Strapi v5.
- Controller action `lesson.start`:
  - Load lesson + populate `questionBank`.
  - Validate bank `active`.
  - Gọi service chọn câu hỏi.
  - Trả response “mobile-friendly”:
    - `lesson: { id, title, description }`
    - `questionBank: { id, name }`
    - `questions: [{ id, type, content, options, difficulty }]`
  - Tuyệt đối không trả `correctAnswer` (dù schema có `private`, vẫn chủ động select fields + strip để an toàn).

## Chiến Lược Shuffle/Random (Tối Ưu Cho Dataset Lớn)
- Tránh `ORDER BY RANDOM()` trên Postgres vì cực đắt khi dữ liệu lớn.
- Nếu `shuffle=false`: query theo sort ổn định (ví dụ `id:asc` hoặc `updatedAt:desc`) + limit.
- Nếu `shuffle=true`: dùng chiến lược **seek-based sampling**:
  - Lấy `maxId` (theo filters) bằng query `orderBy id desc limit 1`.
  - Chọn `randomStart` trong `[1..maxId]`.
  - Query 1: `id >= randomStart` + filters, limit `count * oversample`.
  - Nếu chưa đủ, Query 2: `id < randomStart` + filters để bù.
  - Shuffle in-memory tập kết quả nhỏ rồi slice `count`.
- Thiết kế service theo dạng “strategy” để sau này dễ thêm: quota theo skill, mix difficulty, caching.

## Hiệu Năng & Vận Hành
- Giới hạn fields khi query (`fields`) và không `populate` quan hệ ở runtime endpoint.
- Indexing:
  - Đảm bảo `code` của Level/Skill/Topic là unique (DB-level).
  - Với dataset lớn, bổ sung indexes phù hợp (difficulty/type) và indexes cho bảng join M2M nếu cần.
  - Ưu tiên dùng **database migrations** (thư mục `database/migrations`) để tạo index chuẩn thay vì dựa vào tính năng index trong schema (có thể thay đổi theo version).
- Bảo mật:
  - Endpoint dùng cơ chế permissions của Strapi; có thể cấu hình public/authenticated tùy app.

## Kế Hoạch Triển Khai Trong Repo (Sau Khi Bạn Xác Nhận)
1. Tạo 6 APIs mới (`question`, `level`, `skill`, `topic`, `question-bank`, `lesson`) với `schema.json` + controller/service/router chuẩn Strapi v5.
2. Thêm custom route `GET /api/lessons/:id/start` (file `01-lesson-start.ts`) và implement controller action `start`.
3. Thêm service chọn câu hỏi (parse filters + selection strategy + sanitize response).
4. Thêm migration tạo indexes cơ bản cho production scale.
5. Chạy build/typecheck và smoke test endpoint (local) + ví dụ response.

## Trích Dẫn Doc (Định Hướng Implementation)
- Custom routes Strapi v5: RouterConfig `type: 'content-api'`, `routes: [...]`, load order theo alphabet (nên prefix `01-`).

Nếu plan này OK, mình sẽ bắt đầu code trực tiếp trong repo theo đúng cấu trúc Strapi v5 hiện tại (TypeScript).