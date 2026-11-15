# LingoLens cho iPhone

Cùng giao diện với ứng dụng Android (Tra cứu, Sổ từ, Cài đặt), chạy hoàn toàn trên máy, không cần mạng.
iOS không cho ứng dụng vẽ nút nổi đè lên ứng dụng khác, nên bản iPhone không có nút nổi.

## Cách có app: build trên GitHub, cài bằng Sideloadly (không cần máy Mac)

Apple chỉ cho biên dịch app iOS trên macOS. Workflow `.github/workflows/ios.yml` dùng máy Mac của GitHub Actions để
build ra `LingoLens.ipa` **chưa ký**. Sideloadly (Windows) ký app bằng Apple ID miễn phí của bạn khi cài.

### 1. Lấy tệp LingoLens.ipa
GitHub → repository → **Actions** → “iOS app (.ipa)” → lần chạy mới nhất → mục **Artifacts** → tải
`LingoLens-ipa` (tệp zip chứa `LingoLens.ipa`). Hoặc trên máy này:

```powershell
$env:GH_CONFIG_DIR = 'D:\devtools\gh-config'
D:\devtools\gh\bin\gh.exe run download --name LingoLens-ipa --dir D:\extension\ios-build
```

### 2. Chuẩn bị trên Windows
1. Cài **iTunes** bản tải từ trang của Apple (không dùng bản Microsoft Store) để Windows nhận iPhone.
2. Cài **Sideloadly** (sideloadly.io). Khi cài có thể chọn thư mục trên ổ D.
3. Cắm iPhone bằng cáp, mở khóa iPhone, chọn **Tin cậy máy tính này**.

### 3. Cài app
1. Mở Sideloadly, chọn iPhone của bạn ở ô thiết bị.
2. Kéo `LingoLens.ipa` vào cửa sổ Sideloadly.
3. Nhập **Apple ID** (nên dùng Apple ID phụ nếu ngại), bấm **Start**. Nhập mã xác minh 2 bước nếu được hỏi.
4. Trên iPhone: **Cài đặt → Cài đặt chung → Quản lý VPN & thiết bị** → chọn Apple ID của bạn → **Tin cậy**.
5. iOS 16 trở lên: **Cài đặt → Quyền riêng tư & Bảo mật → Chế độ nhà phát triển → Bật**, khởi động lại máy,
   xác nhận **Bật**. (Mục này chỉ xuất hiện sau lần cài thử đầu tiên.)

### 4. Gia hạn mỗi 7 ngày
App ký bằng Apple ID miễn phí chạy được 7 ngày. Trước khi hết hạn, cắm iPhone và cài lại tệp `.ipa` bằng Sideloadly
(dữ liệu – sổ từ, cài đặt – được giữ nguyên), hoặc bật **Automatic refresh** trong Sideloadly (máy tính bật,
cùng mạng Wi-Fi với iPhone). Tài khoản miễn phí cài được tối đa 3 app tự ký cùng lúc.

## Kiến trúc
- `MangaLingo/MangaLingoApp.swift`, `WebContainer.swift` (thư mục mã nguồn giữ tên cũ) – SwiftUI + WKWebView; giao diện web và dữ liệu từ điển
  nằm trong app, phục vụ qua scheme `app://` (không truy cập mạng). Liên kết ngoài mở bằng Safari.
- `project.yml` – XcodeGen tạo dự án Xcode trên máy build.
- Giao diện web: `src/mobile/` (dùng chung với Android), build bằng `npm run build:ios-web`.

## Trạng thái
| Phần | Trạng thái |
|---|---|
| Tra cứu từ / câu / đoạn, ngữ pháp, ngữ cảnh, sổ từ, cài đặt | Có trong bản build |
| Quét chữ trong ảnh chụp màn hình (Apple Vision, chạm 2 lần mặt lưng iPhone) | Kế hoạch tiếp theo |
| Dịch máy câu tự nhiên | Chưa có |

Bản iPhone **chưa được chạy thử trên iPhone thật hay trình giả lập iOS** (máy phát triển là Windows); việc biên dịch
được kiểm tra bởi workflow GitHub Actions.
