# LingoLens cho Android

Ứng dụng Android dùng chung “bộ não” với tiện ích Chrome (từ điển, phân tích ngữ pháp, sổ từ vựng, Cài đặt) và
thêm **nút nổi kiểu AssistiveTouch** hiện trên mọi ứng dụng.

## Trạng thái (giai đoạn 1)

| Phần | Trạng thái |
|---|---|
| Màn hình chính: công tắc Bật/Tắt, xin quyền “Hiển thị trên ứng dụng khác” | DONE |
| Nút nổi: kéo đi khắp màn hình, thả ra tự hít vào cạnh, mờ khi không dùng, nhớ vị trí | DONE |
| Menu của nút nổi: Tra cứu · Sổ từ · Cài đặt · Mở app · Tắt | DONE |
| Tab Tra cứu (từ / câu / đoạn, ngữ pháp, ngữ cảnh) – cùng giao diện Sidebar của tiện ích | DONE |
| Tab Sổ từ, tab Cài đặt (như bản web; ẩn mục Phím tắt) | DONE |
| Quét vùng (khung giữa màn hình) / quét toàn màn hình – chụp màn hình + ML Kit | Giai đoạn 2 |
| Dịch máy câu tự nhiên trên máy (ML Kit Translation en→vi) | Giai đoạn 3 |

Menu nút nổi chỉ hiện những tính năng đã hoạt động; các mục quét sẽ được thêm khi xong giai đoạn 2.

## Cài lên điện thoại

1. Chép `LingoLens-android-0.1.0.apk` (ở thư mục gốc dự án) sang điện thoại, mở tệp → cho phép “Cài ứng dụng
   không rõ nguồn gốc” khi được hỏi → Cài đặt. (Bản debug, ký bằng khóa debug của Android SDK.)
2. Mở LingoLens → bật công tắc → cấp quyền **Hiển thị trên ứng dụng khác** → quay lại: nút nổi xuất hiện.
3. Android 13+ hỏi quyền thông báo: cho phép để thấy thông báo “LingoLens đang bật” (có nút Tắt nhanh). Không cho
   phép thì nút nổi vẫn chạy.

Yêu cầu: Android 8.0 (API 26) trở lên.

## Build

```bash
npm run android          # = npm run build:mobile && (cd android && gradlew assembleDebug testDebugUnitTest)
```

Cần JDK 17 và Android SDK (platform 35, build-tools 35). Trên máy phát triển này chúng nằm ở `D:\androidtools`
(`JAVA_HOME=D:\androidtools\jdk`, `android/local.properties` → `sdk.dir`). APK: `android/app/build/outputs/apk/debug/`.

## Kiến trúc

- `src/mobile/` – giao diện web của app (React): `shim.ts` giả lập `chrome.storage` / `chrome.runtime` trên
  `localStorage` để Settings Center, Sidebar, Sổ từ của tiện ích chạy nguyên vẹn; `engine.ts` chạy router tra cứu của
  service worker ngay trong trang với dữ liệu từ điển trong APK; `native.ts` là cầu nối tới Kotlin.
- `scripts/build-mobile.mjs` – build giao diện vào `android/app/src/main/assets/web/` (+ dữ liệu từ điển).
- `android/app/src/main/java/app/mangalingo/`
  - `MainActivity` – WebView (WebViewAssetLoader, không truy cập tệp), cầu nối `MangaLingoNative`.
  - `BubbleService` – dịch vụ nền (foreground, loại `specialUse`) vẽ nút nổi + menu bằng `WindowManager`.
  - `BubbleMath` – hít cạnh / giới hạn trong màn hình / phân biệt chạm–kéo (có unit test).

## Quyền

| Quyền | Để làm gì |
|---|---|
| `SYSTEM_ALERT_WINDOW` | Vẽ nút nổi và menu đè lên ứng dụng khác |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SPECIAL_USE` | Giữ nút nổi khi bạn đọc truyện ở ứng dụng khác |
| `POST_NOTIFICATIONS` | Thông báo “đang bật” kèm nút Tắt |

Không có quyền Internet: mọi thứ chạy trên máy.

## Kiểm thử đã chạy (trình giả lập Android 15, Pixel 6, x86_64)

- Unit test Kotlin `BubbleMathTest`: 3/3.
- Trên máy ảo: mở app → “Cấp quyền” mở màn hình quyền của hệ thống → sau khi cấp, quay lại app tự bật; nút nổi hiện
  trên màn hình chính của điện thoại, mờ khi không dùng; kéo sang giữa bên trái → tự hít vào cạnh trái (vị trí được
  lưu); chạm → menu; “Sổ từ” mở app đúng tab; tra “destroyed” → destroy / phá hủy (dữ liệu từ điển trong APK);
  “Tắt” dừng dịch vụ và lưu trạng thái tắt.
- Chưa thử trên điện thoại thật.

## Giới hạn

- Lớp làm mờ phía sau menu không phủ thanh trạng thái (Android không cho cửa sổ nổi vẽ đè lên thanh trạng thái).
- Chưa có dịch máy câu tự nhiên trên Android (WebView không có Translator API của Chrome) – giai đoạn 3 dùng ML Kit.
- Sổ từ và cài đặt của app tách riêng với tiện ích trên máy tính (chưa đồng bộ).
