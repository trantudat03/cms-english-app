# Hướng dẫn sử dụng Strapi Documentation Plugin

## 1. Truy cập Documentation
Sau khi server khởi động (`npm run develop`), truy cập đường dẫn sau để xem tài liệu API:
- **URL**: `http://localhost:1337/documentation/v1.0.0`
- **Giao diện**: Swagger UI (OpenAPI 3.0.0)

## 2. Cấu hình Plugin
Plugin đã được cấu hình trong `config/plugins.ts`. Các thiết lập chính bao gồm:
- **Info**: Tiêu đề, mô tả, liên hệ.
- **Servers**: URL server (mặc định là `http://localhost:1337/api`).
- **Security**: Bearer Auth (JWT).

## 3. Thêm API Custom (Override)
Để thêm các route custom (ví dụ: `/lessons/:id/start`) không được tự động phát hiện, bạn cần tạo file override.

### Vị trí file override:
- **Global**: `src/extensions/documentation/documentation/1.0.0/overrides/<filename>.json`.
- **Lưu ý**: Đôi khi cần xóa file `full_documentation.json` và khởi động lại server để áp dụng thay đổi.

### Các file override đã tạo:
1. **Auth API (`auth.json`)**:
   - Chứa định nghĩa cho `/auth/login`, `/auth/refresh`, `/auth/logout`.
   - File: `src/extensions/documentation/documentation/1.0.0/overrides/auth.json`.

2. **Lesson API (`lesson-start.json`)**:
   - Chứa định nghĩa cho `/lessons/{id}/start`.
   - File: `src/extensions/documentation/documentation/1.0.0/overrides/lesson-start.json`.

### Ví dụ cấu trúc file override:
```json
{
  "paths": {
    "/auth/login": {
      "post": {
        "tags": ["Auth"],
        "summary": "Login with identifier and password",
        "responses": { ... }
      }
    }
  }
}
```

## 4. Gom nhóm API (Grouping)
Để gom nhóm các API lại với nhau trên giao diện Swagger, sử dụng thuộc tính `tags` trong định nghĩa path.
- Ví dụ: `tags: ["Lesson"]` sẽ gom API này vào nhóm "Lesson".
- Các API mặc định của Strapi (find, findOne, create, update, delete) đã được tự động gom nhóm theo tên Content Type.

## 5. Troubleshooting
Nếu documentation không cập nhật:
1. Dừng server (Ctrl+C).
2. Kiểm tra và tắt các process node.js đang chạy ngầm nếu bị lỗi port in use (`taskkill /F /IM node.exe` trên Windows).
3. Xóa file `src/extensions/documentation/documentation/1.0.0/full_documentation.json`.
4. Chạy lại `npm run develop` để regenerate.
