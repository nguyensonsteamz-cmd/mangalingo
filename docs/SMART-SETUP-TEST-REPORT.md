# Smart Setup – báo cáo kiểm thử

Báo cáo này ghi **đúng những gì đã chạy**. Không có kiểm thử nào dùng Google thật, tài khoản Google thật hay thiết bị thật.

## Cách kiểm thử
* `tests/smart-setup.test.ts` (46 bài): chạy lõi Smart Setup + dịch vụ usage thật với **Google giả lập** (`FakeGoogle`) mô phỏng Resource Manager, Service Usage, Cloud Billing, API Keys, Translation (kể cả thao tác dài hạn có polling, lỗi theo reason của Google). Google giả **ném lỗi nếu gọi endpoint không có trong tài liệu**.
* `scripts/e2e.mjs`: Chrome thật + extension build thật: mục Smart Setup, lưu khoá mã hoá, di chuyển khoá cũ, ngắt kết nối.
* Giao diện: chạy toàn bộ 7 bước trên bản app (UI thật) với Google giả, đăng nhập giả, Keychain giả (ảnh `demo-anh/60…71`).
* Android: biên dịch thành công (`gradlew`), chưa chạy.
* iPhone: mã Swift **chưa biên dịch** (cần CI macOS; chưa đẩy lên theo yêu cầu "không push"), chưa chạy.

## Kết quả theo kịch bản yêu cầu
| Kịch bản | Cách kiểm | Kết quả |
|---|---|---|
| Tài khoản Google mới (chưa có dự án) | giả lập: không dự án → tạo dự án → Billing là bước của người dùng → tiếp tục | PASS (giả lập) |
| Dự án mới | như trên | PASS (giả lập) |
| Dự án đã tồn tại | đi thẳng đến kích hoạt | PASS (giả lập) |
| Dự án chưa bật Translation API | tự bật Translation + API Keys API | PASS (giả lập) |
| Dự án chưa liên kết Billing | dừng ở `BILLING_NOT_ENABLED`, mở trang Billing, kiểm tra lại; **không có lệnh ghi nào tới Billing** | PASS (giả lập) |
| Người dùng không đủ quyền | `INSUFFICIENT_PERMISSIONS` kèm danh sách quyền thiếu; chọn dự án khác không phải đăng nhập lại | PASS (giả lập) |
| Khoá API không hợp lệ | `INVALID_API_KEY`, không kích hoạt, không lưu | PASS (giả lập) |
| Khoá bị giới hạn sai | `API_KEY_RESTRICTED` | PASS (giả lập) |
| Mất mạng | `NETWORK_ERROR`, tiến trình giữ nguyên, chỉ thử lại bước lỗi, không đăng nhập lại | PASS (giả lập) |
| Thu hồi quyền OAuth | `GOOGLE_AUTH_FAILED`; đăng nhập lại tiếp tục đúng bước | PASS (giả lập) |
| Đăng xuất / đăng nhập lại | ngắt kết nối rồi thiết lập lại sạch | PASS (giả lập) |
| Khởi động lại | trạng thái, khoá, chế độ dịch khôi phục; thiết lập dở dang tiếp tục được | PASS (giả lập; e2e Chrome cho phần lưu trữ) |
| Thay khoá | khoá mới được kiểm tra trước, khoá cũ xoá sau; thay thất bại giữ nguyên khoá cũ | PASS (giả lập) |
| Mã lỗi `BILLING_ACCOUNT_SUSPENDED`, `QUOTA_EXCEEDED`, `TRANSLATION_API_DISABLED`… | bảng ánh xạ 12 trường hợp + kiểm tra lúc validate | PASS |
| Khoá mới chưa kịp có hiệu lực | thử lại có giới hạn rồi thành công | PASS (giả lập) |
| Khoá không lưu plaintext | quét toàn bộ storage/state/báo cáo/snapshot; WebCrypto: bản mã, key non-extractable, IV mới mỗi lần, sửa bản mã → null | PASS; Chrome e2e PASS |
| Di chuyển khoá plaintext cũ | tự chuyển vào kho bảo mật, xoá bản rõ | PASS (unit + e2e) |
| Dịch máy độc lập | provider mặc định `device`, không gọi Google; sau ngắt kết nối quay về `device` | PASS |
| OAuth chưa cấu hình | `OAUTH_NOT_CONFIGURED`, nút Kết nối bị khoá, nhập khoá thủ công vẫn dùng được | PASS (unit + e2e Chrome) |

## Số liệu
* Unit/integration: **269 / 269** (46 Smart Setup + 45 usage + 18+10 Reader…).
* e2e Chrome: **44 / 44**.
* Script Reader: 18 / 18.
* Android: build OK.

## Chưa kiểm thử được / còn hạn chế (không đánh dấu PASS)
1. **Google thật**: chưa chạy với dự án/tài khoản/billing thật. Hình dạng request/response dựa trên tài liệu REST; có thể có khác biệt nhỏ (ví dụ định dạng tên thao tác, quyền IAM chính xác, độ trễ lan truyền). Cần một lượt thử với tài khoản thật trước khi coi là hoàn tất.
2. **Đăng nhập OAuth thật** trên cả ba nền tảng: cần OAuth Client ID do nhà phát triển tạo (xem `GOOGLE-OAUTH-SETUP.md`). `getAuthToken` (Chrome), `ASWebAuthenticationSession` (iOS) và luồng trình duyệt + redirect (Android) chưa được chạy.
3. **iPhone**: Swift (Keychain, GoogleOAuth, Safari) chưa biên dịch/chạy.
4. **Android**: Keystore, GoogleAuth, redirect intent chưa chạy trên máy.
5. **Kiểm tra khi mở app**: chỉ trạng thái cục bộ (không gọi mạng) để không tốn ký tự; kiểm tra trực tiếp khi người dùng bấm. Ký tự của lần kiểm tra (5) không được tính vào bộ đếm hạn mức.
6. **Đồng bộ giữa thiết bị qua tài khoản Lingolens**: không làm được vì dự án không có backend/tài khoản.
7. **Cloud Translation Advanced (v3)**: không hỗ trợ (cần IAM); thiết kế mô tả trong `API-KEY-SECURITY.md`.
8. Quyền `cloud-platform` là nhạy cảm: phát hành rộng cần xác minh ứng dụng của Google; chế độ thử giới hạn 100 người dùng.
9. Chrome: `getAuthToken` cần Chrome và ID extension cố định; Chromium khác chưa hỗ trợ.
