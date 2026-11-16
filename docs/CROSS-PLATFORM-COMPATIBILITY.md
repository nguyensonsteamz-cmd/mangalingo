# Smart Setup – tương thích giữa ba nền tảng

Một lõi dùng chung (`src/modules/smart-setup`), một giao diện React (`src/options/SmartSetupSection.tsx`); khác nhau chỉ ở **đăng nhập Google** và **kho bí mật**.

| | Chrome extension | iPhone | Android |
|---|---|---|---|
| Tên, quy trình 7 bước, mã lỗi, cách hiển thị usage | giống nhau | giống nhau | giống nhau |
| Giao diện | Cài đặt → Smart Setup | Cài đặt → Smart Setup | Cài đặt → Smart Setup |
| Đăng nhập Google | `chrome.identity.getAuthToken` (client **Chrome extension**) | `ASWebAuthenticationSession` + PKCE (client **iOS**) | trình duyệt hệ thống + PKCE (client **Android**) |
| Client secret | không có | không có | không có |
| Lưu khoá | AES-GCM, khoá non-extractable (IndexedDB), bản mã ở `chrome.storage.local` | Keychain | Android Keystore |
| Mở trang Console | tab mới | `SFSafariViewController` | trình duyệt hệ thống |
| Trạng thái thiết lập (không bí mật) | `chrome.storage.local` `smartsetup:v1` | localStorage của WebView | localStorage của WebView |
| Kiểm tra khi mở | trạng thái cục bộ (không gọi mạng); kiểm tra trực tiếp khi bấm nút | như Chrome | như Chrome |
| Chuyển Dịch máy ↔ Google API | Hạn mức dịch / Smart Setup | như Chrome | như Chrome |
| Dịch máy khi không kết nối Google | Translator API của Chrome | Apple Translation | ML Kit |
| Build cần Client ID | `LINGOLENS_OAUTH_CHROME_CLIENT_ID` | `LINGOLENS_GOOGLE_IOS_CLIENT_ID` | `LINGOLENS_OAUTH_ANDROID_CLIENT_ID` |

## Khác biệt đáng biết
* **Chrome**: `getAuthToken` chạy trên Chrome (không phải mọi trình duyệt Chromium) và cần ID extension cố định.
* **Phiên đăng nhập chỉ trong bộ nhớ**: nếu đóng trang / app giữa chừng, tiến trình (dự án, bước) được giữ nhưng bạn phải đăng nhập lại (màn hình "Cần đăng nhập lại").
* **Mỗi thiết bị tự thiết lập credential riêng**; không sao chép khoá giữa thiết bị.
* **Đồng bộ qua tài khoản Lingolens: chưa có**: dự án không có hệ thống tài khoản/backend Lingolens, nên không có gì được đồng bộ (đúng nguyên tắc: không gửi khoá về backend). Lựa chọn chế độ dịch được lưu riêng trên mỗi thiết bị.
* **Usage là cục bộ theo thiết bị**: ba thiết bị dùng chung một khoá sẽ có ba bộ đếm riêng; tổng thật ở Google lớn hơn từng con số.
* Android WebView / iOS WKWebView **không** dùng để đăng nhập Google.
