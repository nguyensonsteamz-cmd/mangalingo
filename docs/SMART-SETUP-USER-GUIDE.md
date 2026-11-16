# Lingolens Smart Setup – hướng dẫn người dùng

Smart Setup giúp bạn dùng **Google Translate API bằng tài khoản Google Cloud của chính bạn**, không phải tự tìm hiểu dự án, API hay khoá. Mặc định LingoLens dịch **miễn phí ngay trên thiết bị**; Smart Setup chỉ cần khi bạn muốn bản dịch của Google.

> Chi phí dịch do **tài khoản Google Cloud của bạn** trả cho Google. LingoLens không trả thay, không có khoá chung. Số liệu trong app là ước tính cục bộ, không phải số liệu thanh toán chính thức.

## Mở Smart Setup
Cài đặt → **Smart Setup** (Chrome, iPhone, Android giống nhau).

## Các bước
1. **Giới thiệu** – đọc những gì Lingolens sẽ và sẽ không làm. Bấm *Bắt đầu*.
2. **Kết nối Google** – đăng nhập (Chrome: cửa sổ đăng nhập của trình duyệt; iPhone: tờ đăng nhập an toàn của hệ thống; Android: trình duyệt hệ thống). Lingolens xin quyền quản lý tài nguyên Google Cloud và xem email; không truy cập Gmail/Drive.
3. **Chọn hoặc tạo dự án** – chọn dự án có sẵn hoặc *Tạo dự án*. Lingolens kiểm tra bạn đủ quyền; nếu thiếu, thông báo nêu quyền nào thiếu.
4. **Thanh toán (Billing)** – Lingolens **chỉ kiểm tra**. Nếu dự án chưa có thanh toán: bấm *Mở trang liên kết Billing*, tự liên kết tài khoản thanh toán của bạn, rồi bấm *Tôi đã liên kết, kiểm tra lại*. Có hạn mức miễn phí mỗi tháng (500.000 ký tự cho Cloud Translation Basic), vượt mới tính phí.
5. **Cấu hình API** – bật Cloud Translation API và API Keys API (mất tới ~1 phút).
6. **Tạo khoá** – khoá tên `Lingolens-Translation`, giới hạn chỉ dùng cho Cloud Translation API.
7. **Kiểm tra kết nối** – dịch thử "Hello". Chỉ khi thành công mới bấm *Lưu & kích hoạt*.
8. **Hoàn tất** – khoá được lưu trong kho bảo mật của thiết bị (Chrome: mã hoá AES-GCM; iPhone: Keychain; Android: Keystore) và chế độ **Google API** bật.

## Quản lý kết nối
Sau khi xong, màn hình hiển thị tài khoản, dự án, khoá dạng `••••abcd` (không bao giờ hiện đủ), lần kiểm tra gần nhất và chế độ dịch.
* **Kiểm tra kết nối** – dịch thử 5 ký tự bằng khoá đang lưu.
* **Thay khoá / dự án** – tạo khoá mới, kiểm tra rồi mới thay; khoá cũ chỉ bị xoá khi khoá mới đã hoạt động.
* **Kết nối lại Google** – khi bạn đã thu hồi quyền hoặc phiên hết hạn.
* **Ngắt kết nối** – xoá khoá khỏi thiết bị và quay về dịch máy; tuỳ chọn xoá luôn khoá trên Google (cần đăng nhập lại).

## Khi có lỗi
Mỗi lỗi có **nguyên nhân**, **cách xử lý**, nút **Thử lại** (chỉ bước đó, các bước đã xong được giữ), nút mở đúng trang Google Cloud và nút **Bước trước**.

| Lỗi | Thường do | Làm gì |
|---|---|---|
| Đăng nhập Google không thành công | huỷ đăng nhập / đã thu hồi quyền | Đăng nhập lại |
| Chưa đủ quyền | không phải Owner dự án | chọn dự án của bạn hoặc tạo mới |
| Chưa liên kết thanh toán | dự án mới | liên kết Billing rồi kiểm tra lại |
| API chưa bật | mới bật, Google chưa cập nhật | đợi 1–2 phút, thử lại |
| Khoá không hợp lệ / bị giới hạn sai | khoá mới chưa có hiệu lực / sai giới hạn | thử lại, hoặc tạo khoá mới |
| Vượt hạn mức | giới hạn của Google | chờ hoặc nâng hạn mức |
| Tài khoản thanh toán bị tạm ngưng | vấn đề thanh toán ở Google | xử lý trên Google Cloud |
| Lỗi mạng | offline | kiểm tra mạng, thử lại |

## Không muốn dùng Smart Setup?
Bạn vẫn dán khoá API thủ công ở Cài đặt → **Hạn mức dịch** (khoá cũng được lưu trong kho bảo mật), hoặc chỉ dùng dịch máy miễn phí.

## Hạn mức và chi phí
Cài đặt → **Hạn mức dịch** hiển thị ký tự đã dịch qua Lingolens, hạn mức miễn phí còn lại, cảnh báo 80/95/100%, và yêu cầu bạn đồng ý rõ ràng trước khi dịch có phí. Đây là số đếm **trên thiết bị này**; nếu bạn dùng cùng khoá ở nơi khác, Lingolens không biết.
