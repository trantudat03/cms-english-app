## Xác nhận phạm vi
- Codebase hiện là Strapi v5 (5.33.4), đã có các collection chính: Question, Question Bank (filters JSON), Lesson (gắn 1 questionBank) và endpoint start lesson hiện tại.
- Phase 2 sẽ **không đổi tên/không refactor** các collection/field/logic đang chạy; chỉ **bổ sung** content-types, endpoints, service scoring, analytics, index DB và hardening.

## Hiện trạng đã implement (đã rà soát)
- Question: content/type/options/difficulty + correctAnswer (private) + M2M levels/skills/topics.
- Question Bank: filters/defaultQuestionCount/shuffle/active (ruleset, không pick thủ công).
- Lesson: title/description/questionCount + relation manyToOne tới questionBank.
- Start lesson: `GET /lessons/:id/start` chọn N câu theo filters (không trả correctAnswer).
- DB index: questions(type), questions(difficulty), (type,difficulty).

## Các phần còn thiếu để “end-to-end”
- Không có attempt lifecycle (start tạo attempt, snapshot câu hỏi, resume, expire).
- Không có submit/scoring + lưu UserAnswer + cập nhật điểm.
- Không có API lấy kết quả / preview question bank.
- Chưa có index cho quan hệ skills/topics/levels và trạng thái question/attempt/answer.
- Chưa có analytics (pass rate, accuracy theo skill/topic/difficulty, avg time).

## Thiết kế dữ liệu (bổ sung tối thiểu, không phá hiện trạng)
- **LessonAttempt** (collection mới, tên sẽ chọn để không xung đột):
  - user (relation tới `plugin::users-permissions.user`, required nếu bật auth)
  - lesson (relation tới lesson)
  - questionBank (relation tới question-bank, snapshot tham chiếu)
  - generatedQuestionIds (json: danh sách id câu hỏi)
  - startedAt/submittedAt/status(score, timeSpent)
  - version/configSnapshot (json, optional)
- **UserAnswer** (collection mới):
  - user, lessonAttempt, question (relations)
  - response (json), isCorrect, timeSpent, earnedScore (optional)
- **Mở rộng additive** (nếu thiếu trong schema hiện tại):
  - Question: explanation, estimatedTime, tags(json), status(enum draft/published) *hoặc* boolean active (tùy migration nhẹ nhất)
  - Lesson: lessonType, timeLimit, passScore, retryPolicy, shuffleQuestions (override)
  - QuestionBank: randomizationStrategy(enum) (giữ `shuffle` để tương thích logic hiện tại)

## Luồng runtime (Start → Submit → Result)
### 1) POST /lessons/:id/start (giữ GET cũ để backward compatible)
- Xác thực user (khuyến nghị) → load lesson + questionBank (active)
- Tính N = lesson.questionCount || bank.defaultQuestionCount (cap hiện tại)
- Chọn câu bằng service hiện có (DB-limit, oversample) → lấy danh sách ids
- **Tạo LessonAttempt** với snapshot ids + startedAt + status=in_progress
- Trả về: attemptId + questions (không có correctAnswer)
- Quy tắc snapshot: attemptId luôn gắn 1 bộ câu, không random lại.

### 2) POST /lessons/:id/submit
- Validate attempt (theo attemptId trong body) thuộc user + status=in_progress
- Validate answers chỉ nằm trong generatedQuestionIds
- Fetch đúng 1 lần danh sách questions theo ids nhưng lấy correctAnswer nội bộ
- Chấm điểm theo type hiện có (multiple_choice/fill_blank/true_false/short_answer), normalize input
- Bulk create UserAnswer + update LessonAttempt (score, submittedAt, status=completed)
- Trả về: score, pass/fail, breakdown (option), explanation (option theo config)

### 3) GET /lesson-attempts/:id/result
- Ownership check
- Trả attempt + answers + (tùy config) correct/explanation

## Admin/Preview
- **GET /question-banks/:id/preview**
  - Trả estimatedCount (count theo filters ở DB) + sampleQuestions (limit nhỏ)
  - Có TTL cache server-side cho count để admin preview nhanh

## Analytics & Scalability
- DB indexes bổ sung:
  - Question: status (nếu có), và **index join tables** cho (skill_id, question_id), (topic_id, question_id), (level_id, question_id)
  - LessonAttempt: (user_id, status), (lesson_id, created_at)
  - UserAnswer: (lesson_attempt_id), (question_id), (is_correct)
- Submit dùng transaction để tránh double-submit và đảm bảo consistency.
- Tránh load lớn: mọi query đều limit/pagination; scoring fetch theo ids snapshot.
- Analytics:
  - Endpoint (hoặc service nội bộ) tổng hợp theo skill/topic/difficulty trong khoảng thời gian bằng SQL group-by (knex), có thể thêm cron/materialized sau.

## API Contracts (sẽ implement + ví dụ request/response)
- GET /lessons (core)
- POST /lessons/:id/start (mới, tạo attempt)
- POST /lessons/:id/submit (mới)
- GET /lesson-attempts/:id/result (mới)
- GET /question-banks/:id/preview (mới)

## Hardening & Permissions
- Route policies để đảm bảo user chỉ đọc/submit attempt của mình.
- Giữ `correctAnswer` private; endpoint public không bao giờ trả correctAnswer.
- Giới hạn max questionCount (đã có) + validate payload size.

## Kiểm thử/Verification
- Thêm test/smoke script gọi start→submit→result (local sqlite/postgres) và kiểm tra:
  - snapshot ổn định
  - submit sai questionId bị reject
  - double submit bị reject
  - correctAnswer không leak

Nếu bạn xác nhận plan này, tôi sẽ bắt đầu implement theo đúng thứ tự: tạo content-types mới → thêm routes/controllers/services → thêm indexes & policies → thêm preview/analytics → chạy smoke test end-to-end.