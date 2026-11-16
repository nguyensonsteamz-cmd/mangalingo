# Cấu hình Google OAuth cho Smart Setup (dành cho nhà phát triển)

Smart Setup cần **OAuth Client ID** của ứng dụng Lingolens. Client ID là **mã công khai, không phải bí mật**; **không có client secret** ở bất kỳ nền tảng nào (đều là public client + PKCE). Nếu build không có Client ID, Smart Setup hiển thị "chưa được cấu hình" và việc nhập khoá thủ công vẫn dùng được.

> Mình (trợ lý) không thể tạo Client ID thay bạn: phải làm trên Google Cloud Console bằng tài khoản của bạn.

## 1. Tạo dự án Google Cloud của ứng dụng
Một dự án riêng của **nhà phát triển Lingolens** (không phải dự án của người dùng cuối). Trong đó bật các API quản trị mà Smart Setup gọi bằng token của người dùng:
* Cloud Resource Manager API
* Service Usage API
* API Keys API
* Cloud Billing API

Các API quản trị này miễn phí. Chúng chỉ được tính vào hạn mức của dự án OAuth; **chi phí dịch không bao giờ rơi vào dự án này** (khoá được tạo trong dự án của người dùng).

## 2. Màn hình đồng ý (OAuth consent screen)
* Loại *External*. Phạm vi cần khai báo: `https://www.googleapis.com/auth/cloud-platform` và `email`.
* `cloud-platform` là phạm vi **nhạy cảm**: khi ở chế độ *Testing* chỉ tối đa 100 người dùng thử (thêm email vào danh sách); để phát hành rộng cần Google xác minh ứng dụng.
* Chỉ xin đúng các phạm vi trên (không Gmail, Drive).

## 3. Tạo OAuth client cho từng nền tảng
| Nền tảng | Loại client | Biến build | Ghi chú |
|---|---|---|---|
| Chrome | **Chrome extension** | `LINGOLENS_OAUTH_CHROME_CLIENT_ID` (+ tuỳ chọn `LINGOLENS_EXTENSION_PUBLIC_KEY`) | Cần **ID extension cố định**: tạo cặp khoá, đưa `key` công khai vào manifest để ID không đổi, rồi nhập ID vào client. `npm run build` ghi khối `oauth2` vào manifest khi có biến. |
| iPhone | **iOS** (bundle id `app.mangalingo.ios`) | biến build `LINGOLENS_GOOGLE_IOS_CLIENT_ID` (workflow: *Repository variable* cùng tên) | Đăng nhập bằng `ASWebAuthenticationSession`; redirect `com.googleusercontent.apps.<id>:/oauth2redirect`. Thiết lập trong Info.plist khoá `LingoLensGoogleClientID`. |
| Android | **Android** (package `app.mangalingo` + SHA-1 chứng chỉ ký) | `-PLINGOLENS_OAUTH_ANDROID_CLIENT_ID=...` hoặc biến môi trường cùng tên | Trình duyệt hệ thống + PKCE; redirect theo scheme đảo ngược client id (tự điền vào Manifest). Bật *custom URI scheme* cho client nếu Google yêu cầu. |

Ví dụ build:
```
set LINGOLENS_OAUTH_CHROME_CLIENT_ID=1234-abc.apps.googleusercontent.com && npm run build
cd android && gradlew assembleDebug -PLINGOLENS_OAUTH_ANDROID_CLIENT_ID=5678-def.apps.googleusercontent.com
```

## 4. Không đưa vào mã nguồn
* Không commit client secret (không có). Client ID truyền qua biến build/`vars` của CI, không viết cứng trong repo.
* Không commit khoá API của bất kỳ ai.

## 5. Kiểm tra sau khi cấu hình
Mở Cài đặt → Smart Setup → Kết nối Google: nút phải bật (không còn thông báo "chưa được cấu hình"). Đăng nhập bằng tài khoản thử đã thêm trong màn hình đồng ý.

## Chính sách App Store
Đăng nhập dùng `ASWebAuthenticationSession` (hộp đăng nhập của hệ thống), không dùng web view nhúng. Token chỉ ở bộ nhớ trong lúc thiết lập, bị thu hồi khi xong; không lưu refresh token.
