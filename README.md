# LingoLens

Trợ lý đọc tiếng Anh cho Chrome, hoạt động **cục bộ (local-first)**: click hoặc bôi đen để tra từ, phân tích câu,
nhận diện chữ trong ảnh manga bằng OCR chạy ngay trong trình duyệt, và lưu sổ từ vựng — không cần tài khoản,
không gửi dữ liệu ra ngoài, không dùng API trả phí.

> **Dictionary Mode (mặc định).** Với câu và đoạn văn, LingoLens ghép nghĩa theo từng cụm từ dựa trên dữ liệu
> từ điển, đánh dấu rõ phần nào chưa có dữ liệu, và phân tích ngữ pháp theo quy tắc.
>
> **Google Dịch (web, tuỳ chọn).** Cài đặt → Hạn mức dịch → *Google Dịch (web)*: dịch bằng Google không cần khoá API, không cần Google Cloud, không phát sinh phí. Không phải API chính thức của Google — có thể bị giới hạn/chặn; xem [docs/google_translate_unofficial_migration_report.md](docs/google_translate_unofficial_migration_report.md) và [docs/PRIVACY.md](docs/PRIVACY.md). Khoá Google Cloud riêng vẫn là tuỳ chọn nâng cao.
>
> **Bản dịch máy (mặc định).** Câu/đoạn/bong bóng OCR có thêm bản dịch tự nhiên Anh → Việt bằng Translator API
> dịch trên máy của Chrome 138+ (mô hình do Chrome tải một lần từ Google ở lần click đầu tiên). Áp dụng cho mọi
> trường hợp: từ đơn (kể cả từ không có trong dữ liệu Anh–Việt), định nghĩa, cụm từ, câu, đoạn, OCR; nghĩa từ điển
> vẫn hiện riêng bên dưới. Đổi sang “Chỉ từ điển” trong Cài đặt → Hành vi đọc. Xem
> [docs/PRIVACY.md](docs/PRIVACY.md). Xem [docs/DICTIONARY.md](docs/DICTIONARY.md) về phạm vi dữ liệu tiếng Việt.

## Cài đặt (Chrome Developer Mode)

Yêu cầu: Node.js ≥ 20 (đã kiểm thử với 24.18), Chrome ≥ 116 (đã kiểm thử với 157).

```bash
npm install
npm run build        # tạo dữ liệu từ điển + build vào dist/
```

> **Mặc định LingoLens tắt trên mọi trang.** Sau khi cài, mở trang muốn đọc → bấm biểu tượng LingoLens →
> bật **“Bật LingoLens trên trang này”** (biểu tượng hiện “ON” trên các trang đã bật). Có hiệu lực ngay, **không cần
> tải lại trang** — kể cả tab đã mở từ trước khi cài/cập nhật tiện ích.

1. Mở `chrome://extensions`.
2. Bật **Developer mode** (góc trên bên phải).
3. Bấm **Load unpacked** → chọn thư mục `dist/`.
4. Ghim biểu tượng LingoLens trên thanh công cụ (biểu tượng mảnh ghép → ghim).

Khi cài, Chrome hỏi quyền “đọc và thay đổi dữ liệu trên mọi trang web”. Quyền này cần cho việc tra từ trên
mọi trang và đọc điểm ảnh của ảnh manga để OCR cục bộ — xem [docs/PRIVACY.md](docs/PRIVACY.md).

## Sử dụng

| Chức năng | Cách dùng |
|---|---|
| Tra một từ | Click vào từ tiếng Anh (có thể yêu cầu giữ Alt/Ctrl/Shift trong Cài đặt). |
| Tra cụm từ / câu / đoạn | Bôi đen văn bản. Popup tự đổi giao diện: **Từ**, **Cụm từ**, **Câu**, **Đoạn văn**. |
| Đóng popup | `Esc`, click ra ngoài, hoặc nút ✕. |
| Phát âm | Nút loa (giọng đọc có sẵn của hệ điều hành). |
| Lưu từ | Nút dấu trang trong popup → lưu kèm câu gốc, nguồn, ngày lưu. |
| Bật / tắt theo trang | Mặc định tắt. Biểu tượng LingoLens → **Bật LingoLens trên trang này** (áp dụng cho tên miền đó, gồm tên miền con; biểu tượng hiện “ON”). Danh sách và nút **Tạm dừng trên mọi trang**: Cài đặt → Hành vi đọc. Menu biểu tượng cũng có **Mở Sidebar**, **Cài đặt**, **Tải mô hình dịch**. |
| Sidebar | Biểu tượng LingoLens → **Mở Sidebar**, nút “Mở Sidebar” trong popup, hoặc `Alt+Shift+S`. Sidebar chỉ hiện ở **tab** đã mở nó (tự đóng nếu tab đó chuyển sang trang web khác). |
| OCR ảnh manga | Rê chuột lên ảnh → **Quét OCR**: Sidebar mở ra với danh sách bong bóng (đánh số giống trên ảnh, kèm bản dịch). Click khung trên ảnh để xem nghĩa từng từ; click ra ngoài để ẩn khung. |
| Sửa khung OCR | Rê chuột lên khung bong bóng → kéo tay nắm ở góc/cạnh để bao trọn chữ bị sót → thả chuột: vùng đó được quét lại. |
| OCR một vùng | Nút cắt (✂) cạnh “Quét OCR”, hoặc chuột phải → “LingoLens: chọn vùng để quét OCR”, rồi kéo chọn. |
| Quét bằng phím tắt | `Alt+Shift+O` quét ảnh dưới con trỏ (hoặc ảnh lớn nhất đang hiển thị). |
| Tra vùng chọn bằng phím tắt | `Alt+Shift+L`, hoặc chuột phải → “LingoLens: tra …”. |
| Cài đặt | Biểu tượng bánh răng trong popup/sidebar, hoặc chuột phải biểu tượng tiện ích → Options. |
| Sổ từ vựng | Sidebar → tab **Đã lưu** (tìm kiếm, lọc, Mới/Đang học/Đã thuộc, ghi chú, xuất/nhập JSON/CSV). |
| Bản dịch máy | Mặc định bật. Lần đầu Chrome tự tải mô hình khi bạn click (hoặc bấm **Tải mô hình dịch**). Bản dịch hiện trên phần nghĩa ghép trong popup câu/đoạn/OCR và sidebar. |
| Nhập từ điển | Cài đặt → **Dữ liệu** → chọn tệp JSON/CSV. |

Phím tắt có thể đổi tại `chrome://extensions/shortcuts`.

## Tình trạng phiên bản 0.1.0

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Cài được trên Chrome (MV3, Load unpacked) | **DONE** | Kiểm chứng tự động trong Chrome 157 |
| DOM Reader – click & bôi đen | **DONE** | Từ tách qua nhiều thẻ, dấu câu, từ nối, ô nhập liệu, liên kết |
| Floating Popup | **DONE** | 4 chế độ + chế độ OCR, Shadow DOM đóng, tự căn vị trí |
| Sidebar (Side Panel) | **DONE** | 5 tab; độ rộng khung do Chrome quản lý (xem giới hạn) |
| Settings Center | **DONE** | Lưu `chrome.storage.local`, áp dụng ngay, kiểm tra dữ liệu, Reset |
| Dictionary Engine | **DONE** | WordNet + CMUdict + Starter + từ điển người dùng nhập |
| Dữ liệu nghĩa tiếng Việt | **PARTIAL** | Chỉ 946 mục Starter tự biên soạn; còn lại chỉ có định nghĩa tiếng Anh |
| Dịch câu/đoạn (Dictionary Mode) | **DONE** | Ghép nghĩa theo cụm + phân tích ngữ pháp theo quy tắc |
| Bản dịch tự nhiên | **DONE** | Translator API trên máy của Chrome 138+, mặc định bật; có thể sai – nghĩa từ điển luôn hiện bên dưới để đối chiếu |
| OCR tiếng Anh chữ ngang | **DONE** | Tesseract.js cục bộ, tiến độ, hủy, cache, sửa kết quả, chọn vùng |
| OCR chữ dọc / hiệu ứng âm thanh / đa ngôn ngữ | **PARTIAL** | Có kiến trúc đăng ký ngôn ngữ; chưa đóng gói dữ liệu |
| Sổ từ vựng | **DONE** | Lưu, xóa, trạng thái, tìm kiếm, lọc, xuất/nhập JSON/CSV, xử lý quota |
| Phím tắt & menu chuột phải | **DONE (kiểm thử thủ công)** | Code đã có; chưa được E2E tự động (CDP không bấm được phím tắt toàn cục) |
| Kiểm thử | **DONE** | 140 unit/integration + 39 E2E trong Chrome thật — xem [docs/TESTING.md](docs/TESTING.md) |

## Lệnh phát triển

```bash
npm run data        # sinh dữ liệu từ điển (WordNet, CMUdict, Starter) vào build-data/
npm run build       # build extension vào dist/
npm run typecheck   # TypeScript
npm test            # 140 unit + integration test (Vitest, gồm OCR Tesseract thật)
npm run e2e         # E2E: nạp dist/ vào Chrome thật qua CDP (cần Chrome đã cài)
npm run screenshots # chụp ảnh giao diện vào test-results/screens/
npm run check       # tất cả các bước trên
```

## Tài liệu

- [ios/README.md](ios/README.md) – **ứng dụng iPhone** (build trên GitHub Actions, cài bằng Sideloadly)
- [android/README.md](android/README.md) – **ứng dụng Android** (nút nổi kiểu AssistiveTouch, tra cứu, sổ từ, cài đặt)

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) – kiến trúc, luồng dữ liệu, quyết định kỹ thuật
- [docs/FEATURES.md](docs/FEATURES.md) – mô tả chi tiết tính năng
- [docs/SETTINGS.md](docs/SETTINGS.md) – toàn bộ cài đặt và giá trị mặc định
- [docs/OCR.md](docs/OCR.md) – hướng dẫn và giới hạn OCR
- [docs/DICTIONARY.md](docs/DICTIONARY.md) – nguồn dữ liệu, giấy phép, định dạng nhập
- [docs/TESTING.md](docs/TESTING.md) – kiểm thử và kết quả
- [docs/PRIVACY.md](docs/PRIVACY.md) – quyền riêng tư và bảo mật
- [docs/ROADMAP.md](docs/ROADMAP.md) – kế hoạch tiếp theo
- [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) – kế hoạch triển khai theo phase

## Giấy phép

Mã nguồn LingoLens: chưa gắn giấy phép (dự án cá nhân — hãy thêm tệp LICENSE nếu muốn chia sẻ). Dữ liệu đóng gói giữ giấy phép riêng (WordNet License, CMUdict BSD-2-Clause,
Tesseract/tesseract.js Apache-2.0, LingoLens Starter CC0) — bản sao giấy phép nằm trong `dist/licenses/`.
