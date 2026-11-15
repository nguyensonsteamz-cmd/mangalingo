# Quyền riêng tư & bảo mật

## Nguyên tắc

- **Local-first**: tra từ, phân tích câu, nhận diện ngôn ngữ và OCR đều chạy trên máy.
- **Không gửi nội dung truyện, ảnh hay từ đã tra** tới bất kỳ máy chủ nào. Không có tracking, analytics,
  telemetry, quảng cáo, tài khoản hay API key.
- **Quyền `scripting`**: chỉ dùng để khởi động MangaLingo trong các tab **đã mở sẵn** (trước khi cài/cập nhật
  tiện ích) của những trang bạn bật — để không phải tải lại trang. Không chèn mã nào khác ngoài `content.js` của gói.
- **Mặc định tắt trên mọi trang**: content script (cần quyền `<all_urls>` để bạn bật được ở bất kỳ trang nào) không
  gắn gì vào trang và không đọc/không phản hồi thao tác trên những trang bạn chưa bật. Danh sách trang đã bật lưu
  cục bộ (`chrome.storage.local`).
- **Bản dịch máy (mặc định BẬT, theo yêu cầu của người dùng)**: *Cài đặt → Hành vi đọc → Chế độ dịch = Dịch máy*.
  MangaLingo dùng Translator API có sẵn trong Chrome 138+. Lần đầu, ngay khi bạn click (tra câu, click bong bóng
  OCR, hoặc nút **Tải mô hình dịch**), **Chrome** (không phải MangaLingo) tải mô hình Anh → Việt từ máy chủ Google
  một lần; việc dịch sau đó chạy **trên máy**, văn bản không được gửi đi. Tiện ích không gọi API dịch trực tuyến nào
  và không cần API key. Chọn *Chỉ từ điển* để không dùng dịch máy (API không được gọi để dịch).
- **Không có mã thực thi từ xa**: mọi JavaScript/WASM nằm trong gói. CSP của trang tiện ích:
  `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'` (`wasm-unsafe-eval` cần cho WebAssembly của Tesseract).
- Kiểm chứng: bài E2E ghi lại mọi request mạng của service worker và các trang trong suốt phiên kiểm thử và
  khẳng định không có URL nào ngoài `chrome-extension://`, `data:`/`blob:` và máy chủ fixture cục bộ.
  (Bản build có chứa chuỗi URL CDN mặc định bên trong mã nguồn Tesseract.js, nhưng không bao giờ được dùng vì
  MangaLingo luôn truyền đường dẫn cục bộ.)

## Quyền (permissions)

| Quyền | Dùng để | Ghi chú |
|---|---|---|
| `storage` | Lưu cài đặt, sổ từ, cache OCR (`local`); nội dung sidebar hiện tại (`session`) | |
| `sidePanel` | Sidebar đọc truyện | |
| `offscreen` | Chạy Tesseract worker (cần DOM/Worker, service worker không có) | |
| `contextMenus` | Menu chuột phải: tra vùng chọn, quét ảnh, chọn vùng, mở sidebar | |
| host `<all_urls>` | (1) đọc điểm ảnh của ảnh manga khác origin để OCR cục bộ; (2) `captureVisibleTab` khi ảnh bị chặn tải | Content script vốn đã chạy trên mọi trang để tra từ, nên Chrome hiển thị cùng một cảnh báo; quyền này không thêm cảnh báo mới |

Không dùng: `tabs`, `history`, `cookies`, `webRequest`, `scripting`, `identity`, `downloads`, `clipboardRead`.

## Dữ liệu được lưu (chỉ trên máy)

| Dữ liệu | Nơi lưu | Nội dung |
|---|---|---|
| Cài đặt | `chrome.storage.local` | Các tùy chọn ở [SETTINGS.md](SETTINGS.md) |
| Sổ từ | `chrome.storage.local` | Từ, nghĩa, câu chứa từ (≤ 400 ký tự), URL nguồn **đã bỏ query/hash** (tránh lưu token), tiêu đề trang, ngày, trạng thái, ghi chú |
| Cache OCR | `chrome.storage.local` | Văn bản + tọa độ khung; khóa là hash; không lưu ảnh |
| Nội dung sidebar | `chrome.storage.session` | Lần tra gần nhất (tối đa 15 mục), xóa khi đóng trình duyệt |
| Từ điển nhập | IndexedDB của tiện ích | Dữ liệu người dùng tự nhập |

Không lưu toàn bộ nội dung trang. Gỡ tiện ích sẽ xóa toàn bộ dữ liệu trên.

## Xử lý an toàn nội dung từ website

- UI nằm trong **closed Shadow DOM** với `all: initial`: CSS của trang không ảnh hưởng UI, và script của trang
  không đọc được nội dung tra cứu hay văn bản OCR (đã kiểm thử E2E).
- **OCR chỉ chạy theo thao tác thật của người dùng** (`event.isTrusted`): script của trang không thể tự bấm
  nút quét để dùng tiện ích đọc chữ trong ảnh khác origin (đã kiểm thử E2E).
- Tải ảnh với `credentials: 'omit'`: tiện ích không gửi cookie của người dùng.
- Mọi văn bản lấy từ trang, OCR hay tệp nhập được render qua React (tự escape); không dùng `innerHTML`.
- Tin nhắn tới service worker được kiểm tra loại; văn bản tra cứu giới hạn 6.000 ký tự; tệp nhập ≤ 60 MB;
  mọi trường nhập được kiểm tra kiểu và cắt độ dài.
- Liên kết nguồn trong sổ từ chỉ chấp nhận `http`, `https`, `file`; mở với `rel="noopener noreferrer"`.
- Xuất CSV vô hiệu hóa công thức bảng tính (`=`, `+`, `-`, `@` ở đầu ô).
- Sự kiện chuột/bàn phím trong UI của tiện ích không lan ra trang (tránh trang đọc truyện tự lật trang).
