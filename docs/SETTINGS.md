# Cài đặt

Mọi cài đặt được lưu trong `chrome.storage.local` (khóa `settings:v1`), luôn đi qua `sanitizeSettings`
(`src/shared/settings.ts`): giá trị thiếu dùng mặc định, số bị kẹp trong khoảng hợp lệ, enum không hợp lệ bị
thay bằng mặc định, tên miền được chuẩn hóa. Thay đổi áp dụng ngay cho mọi tab, popup và sidebar đang mở
(qua `chrome.storage.onChanged`) — không cần tải lại tiện ích. Mỗi mục có nút “Đặt lại mục này”; trang
**Dữ liệu** có **Reset to Default** cho toàn bộ cài đặt.

| Nhóm | Cài đặt | Mặc định | Giá trị hợp lệ |
|---|---|---|---|
| Giao diện | Chủ đề | Tối | Tối / Sáng / System |
| | Màu nhấn | `#7c9cff` | 8 màu gợi ý hoặc mã hex `#rrggbb` |
| Chung | Website đang bật | (trống) | **Mặc định tắt mọi trang.** Thêm bằng menu biểu tượng → “Bật LingoLens trên trang này”, hoặc Cài đặt → Hành vi đọc; áp dụng tên miền con và `www.` |
| | Tạm dừng trên mọi trang | Tắt | Giữ danh sách nhưng tạm ngừng ở mọi trang |
| Floating Popup | Bật | Có | |
| | Chiều rộng | 380 px | 300–600 |
| | Cỡ chữ | auto (theo mục Chữ) | 0 hoặc 11–22 px |
| | Vị trí ưu tiên | Tự động | Tự động / Dưới / Trên |
| | Độ trong suốt | 100% | 70–100% |
| | Hiệu ứng | Bật | |
| | Tự đóng | Không | Không / Khi cuộn / Khi rời chuột / Sau N giây (2–60) |
| | Màu popup | Sáng | Sáng / Tối / Theo giao diện (popup trên trang web) |
| | Màu nền popup | Theo chủ đề | Màu tùy chọn; màu chữ tự đổi sáng/tối theo độ sáng của nền để luôn dễ đọc |
| | Tab hiển thị | Cả 4 | Nghĩa, Ngữ cảnh, Ví dụ, Ngữ pháp |
| Sidebar | Màu Sidebar | Theo giao diện | Theo giao diện / Sáng / Tối |
| | Màu nền Sidebar | Theo chủ đề | Màu tùy chọn; màu chữ, thẻ, viền tự điều chỉnh theo độ sáng của nền |
| | Bật | Có | Khi tắt, bấm biểu tượng tiện ích mở Cài đặt |
| | Trạng thái mặc định | Đầy đủ | Đầy đủ / Thu gọn |
| | Độ rộng nội dung | Toàn bộ | Toàn bộ / Vừa (540 px) / Hẹp (400 px) * |
| | Cỡ chữ | auto | 0 hoặc 11–22 px |
| | Tab mặc định | Dịch | Dịch / Từ vựng / Ngữ pháp / Ngữ cảnh / Đã lưu |
| Chữ | Font | Hệ thống | Hệ thống / Sans / Serif / Dễ đọc / Monospace (chỉ font có sẵn trên máy) |
| | Cỡ chữ | 14 px | 11–22 |
| | Giãn dòng | 1.55 | 1.1–2.2 |
| | Giãn cách từ | 0 px | 0–8 |
| | Cỡ chữ nghĩa tiếng Việt | 15 px | 11–26 |
| Từ điển | IPA, nút phát âm, từ loại, định nghĩa EN, ví dụ, đồng nghĩa, trái nghĩa, collocations | Bật hết | |
| Hành vi đọc | Click để tra | Bật | |
| | Phím kèm khi click | Không | Không / Alt / Ctrl / Shift |
| | Bôi đen để tra | Bật | |
| | Tự động mở popup | Bật | Khi tắt: hiện nút tra nhỏ cạnh vùng chọn |
| | Tự nhận diện ngôn ngữ | Bật | Khi tắt: mọi văn bản được tra như tiếng Anh |
| | Chế độ dịch | Dịch máy (Chrome) | Dịch máy (Translator API trên máy của Chrome 138+) / Chỉ từ điển; hiện trạng thái mô hình và nút “Tải mô hình dịch” |
| | Ngôn ngữ đích | Tiếng Việt | Tiếng Việt / English (ưu tiên định nghĩa tiếng Anh) |
| | Bỏ qua website | (trống) | Tên miền, áp dụng cả tên miền con; tối đa 500 |
| OCR | Bật | Có | |
| | Ngôn ngữ | English | Chỉ `eng` được đóng gói |
| | Cách kích hoạt | Nút khi rê chuột | Nút khi rê chuột / Chỉ menu chuột phải & phím tắt |
| | Chế độ quét | Bong bóng thoại (PSM 11) | Bong bóng / Tự động (PSM 3) / Một khối (PSM 6) |
| | Hiện bounding box | Bật | |
| | Màu khung bong bóng | Cam `#f97316` | 8 màu gợi ý, bảng chọn màu hoặc mã hex. Khung nét đứt = tin cậy < 65%, xanh lá = đã sửa |
| | Ngưỡng tin cậy | 45% | 0–95 |
| | Kích thước ảnh tối thiểu | 220 px | 80–1200 |
| | Tự động cache | Bật | |
| Phím tắt | Mở/đóng sidebar | `Alt+Shift+S` | Đổi tại `chrome://extensions/shortcuts` |
| | Tra vùng chọn | `Alt+Shift+L` | |
| | Quét ảnh manga | `Alt+Shift+O` | |
| | Đóng popup | `Esc` | Esc, hoặc thêm Q / X |

\* Chrome không cho tiện ích đặt độ rộng khung Side Panel; người dùng kéo mép panel để đổi. Cài đặt này giới
hạn độ rộng nội dung bên trong.
