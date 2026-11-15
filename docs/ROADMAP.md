# Lộ trình

## Ưu tiên cao

1. **Mở rộng dữ liệu Anh–Việt có giấy phép rõ ràng**
   - Viết bộ chuyển đổi cho dữ liệu Wiktionary (trích xuất wiktextract/kaikki, CC BY-SA) → định dạng nhập
     của MangaLingo; dùng bảng dịch tiếng Việt của English Wiktionary.
   - Mở rộng bộ Starter theo danh sách tần suất từ trong truyện; quy trình rà soát nghĩa.
2. **OCR trong `iframe`** (`all_frames` + định tuyến tin nhắn theo frame) cho các trình đọc nhúng ảnh trong khung.
3. **Kiểm thử thủ công có ghi chép** cho phím tắt toàn cục và menu chuột phải (CDP không mô phỏng được), và
   bổ sung E2E cho các chế độ tự đóng popup, chủ đề sáng, xuất/nhập tệp qua giao diện.

## Trung hạn

- OCR: đóng gói tùy chọn `jpn_vert`, `kor`, `chi_sim` (tải về từ trang Cài đặt bằng thao tác rõ ràng của người
  dùng, lưu IndexedDB); nhận diện hiệu ứng âm thanh; phát hiện bong bóng thoại trước khi OCR để giảm nhiễu.
- Chất lượng OCR trên scan thật: khử nền tram (screentone), nhị phân hóa thích nghi, thử nhiều PSM và chọn
  kết quả có độ tin cậy cao nhất.
- Ôn tập từ vựng: lặp lại ngắt quãng (SRS) từ sổ từ, thẻ ghi nhớ trong sidebar.
- Bộ gán nhãn từ loại tốt hơn (mô hình HMM/averaged perceptron nhỏ huấn luyện trên dữ liệu có giấy phép mở).

## Dài hạn (tùy chọn, luôn opt-in)

- ~~Bản dịch tự nhiên trên máy~~ — đã có (tùy chọn) qua Translator API của Chrome. Tiếp theo: mô hình dịch đóng gói
  sẵn (WASM/WebGPU) cho trình duyệt không có Translator API.
- Provider tùy chọn do người dùng cấu hình (API riêng của họ), tắt mặc định, ghi rõ trong Quyền riêng tư.
- Đồng bộ sổ từ giữa các máy qua tệp xuất/nhập hoặc `chrome.storage.sync` (giới hạn dung lượng).
