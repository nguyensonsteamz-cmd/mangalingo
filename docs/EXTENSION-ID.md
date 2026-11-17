# ID extension cố định cho LingoLens Chrome

Client OAuth loại "Chrome extension" gắn với **một ID extension cụ thể**. ID chỉ cố định khi `manifest.json` có trường `key` (khóa **công khai**). Khóa riêng chỉ nằm trên máy bạn và không bao giờ vào Git.

1. Tạo khóa riêng, ví dụ `D:\secrets\lingolens-extension.pem` (ngoài thư mục dự án):
   `openssl genrsa -out D:\secrets\lingolens-extension.pem 2048`
   Sao lưu file này (USB, trình quản lý mật khẩu). Mất nó là mất quyền đẩy bản cập nhật lên Chrome Web Store dưới ID đó.
2. Lấy khóa công khai và ID: `node scripts/extension-id.mjs D:\secrets\lingolens-extension.pem`
   Script chỉ đọc file và chỉ in nửa công khai.
3. Đặt khóa công khai vào build: `set LINGOLENS_EXTENSION_PUBLIC_KEY=<chuỗi base64>` (CI: Repository variable cùng tên), cùng với `LINGOLENS_OAUTH_CHROME_CLIENT_ID`. `npm run build` ghi `key` và `oauth2` vào `dist/manifest.json`.
4. Nạp `dist` vào `chrome://extensions`: ID hiển thị phải bằng ID ở bước 2.
5. Chỉ sau đó mới tạo (hoặc sửa) OAuth client Chrome với đúng ID đó.
6. Kiểm tra bất kỳ lúc nào: `node scripts/extension-id.mjs --public <key trong manifest>`.

`*.pem` và `*.key` đã nằm trong `.gitignore`.
