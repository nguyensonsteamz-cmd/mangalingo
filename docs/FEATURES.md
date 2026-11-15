# Tính năng

## 1. DOM Reader

- **Click tra từ**: xác định từ bằng caret API + hit-test hình chữ nhật của từ (không chọn nhầm từ lân cận khi
  click vào khoảng trắng hay cuối dòng). Giữ dấu nháy (`don't`, `it’s`, `'em`, `goin'`), dấu gạch nối
  (`well-known`), từ viết tắt có dấu chấm (`U.S.`); loại bỏ dấu câu và ngoặc kép. Từ bị tách bởi thẻ HTML
  (`<b>Wha</b>tever`) vẫn đọc thành một từ.
- **Bôi đen**: một từ, cụm, câu, hoặc đoạn văn; câu chứa từ được dùng làm ngữ cảnh.
- **Không làm phiền**: không kích hoạt trong `input`, `textarea`, `contenteditable`, trình soạn thảo code;
  không kích hoạt khi click liên kết/nút; không đổi vị trí cuộn; không chặn sự kiện của trang.
- Click và bôi đen bật/tắt độc lập; có thể yêu cầu phím Alt/Ctrl/Shift khi click; danh sách website bỏ qua.

## 2. Floating Popup

- Hiển thị cạnh từ/câu, **không che** vùng đang đọc nếu còn chỗ (dưới → trên → bên cạnh → góc màn hình),
  luôn nằm trong khung nhìn, cuộn được khi dài, bám theo vị trí khi cuộn trang.
- Dark mode mặc định, bo góc, shadow nhẹ, animation 140 ms (tắt được, tôn trọng `prefers-reduced-motion`).
- Chế độ:
  - **Từ** — tab Nghĩa · Ngữ cảnh · Ví dụ · Ngữ pháp: IPA, từ loại, nghĩa VI, định nghĩa EN, nghĩa theo ngữ cảnh
    (kèm độ tin cậy và phương pháp), ví dụ, cụm động từ, thành ngữ, collocation, đồng/trái nghĩa, dạng từ.
  - **Cụm từ** — nghĩa của cụm cố định (cụm động từ, thành ngữ, slang), cách dùng, phân tích từng từ.
  - **Câu** — Dịch (ghép nghĩa + từng cụm) · Ngữ cảnh · Ngữ pháp · Từ vựng. Không hiển thị thông tin từ điển
    của một từ đơn lẻ.
  - **Đoạn văn** — từng câu theo thứ tự với ghép nghĩa, tổng hợp ghi chú và từ vựng.
  - **OCR** — văn bản nhận diện, click từ để tra, bôi đen để tra cụm, sửa văn bản.
  - **Ngôn ngữ khác** — báo ngôn ngữ phát hiện, không dịch sai; có nút “Vẫn tra như tiếng Anh”.
- Nút: Phát âm · Lưu từ · Mở Sidebar · Cài đặt · Đóng; điều hướng “Quay lại” khi tra lồng nhau.

## 3. Manga OCR

Xem [OCR.md](OCR.md). Quét ảnh, quét vùng, quét toàn màn hình; tiến độ %, hủy; khung vùng chữ; sửa kết quả;
cache theo URL ảnh hoặc dấu vân tay điểm ảnh.

## 4. Dictionary Engine

- Nguồn: WordNet 3.1 (định nghĩa EN, ví dụ, đồng/trái nghĩa, nhãn slang/khẩu ngữ, ~60k cụm từ),
  CMUdict → IPA, LingoLens Starter (nghĩa VI), từ điển người dùng nhập (JSON/CSV).
- Chuẩn hóa: chữ hoa/thường, dấu nháy cong, sở hữu cách, nói lắp (`W-what`), dạng rút gọn.
- Lemma: quy tắc morphy của WordNet + bảng động từ/danh từ/tính từ bất quy tắc + bỏ phụ âm kép.
- Nhiều nghĩa, phân biệt từ loại, xếp hạng theo ngữ cảnh, gợi ý chính tả khi không tìm thấy, cache LRU.

## 5. Translation & Language Engine (Dictionary Mode)

- Nhận diện ngôn ngữ cục bộ: hệ chữ (Nhật, Hàn, Trung, Nga, Thái, Ả Rập, Hindi, Hy Lạp, Do Thái) + từ dừng
  (Anh, Việt, Pháp, Tây Ban Nha, Đức, Ý, Bồ Đào Nha, Hà Lan, Indonesia).
- Khớp cụm từ trước khi dịch từng từ: đầu cụm chia thì (`gave up`), placeholder sở hữu (`lost my mind` →
  *lose one's mind*), phản thân (`pull yourself together`), cụm động từ tách rời (`pick it up`).
- Ngữ pháp theo quy tắc: loại câu, 13 thì/thể, bị động, câu điều kiện loại 0–3/hỗn hợp, phủ định,
  chủ ngữ/động từ/tân ngữ/bổ ngữ, mệnh đề (phụ, quan hệ, đẳng lập, điều kiện), động từ khuyết thiếu,
  “there is/are”, so sánh, khẩu ngữ. Mỗi kết luận kèm “dấu hiệu” và lời cảnh báo phân tích theo quy tắc.
- Ngữ cảnh: slang, thành ngữ, cụm động từ, dạng rút gọn, sắc thái (“?!”, “…”, nói lắp, kéo dài âm, thán từ,
  từ nhấn mạnh, chữ in hoa trong manga).
- **Không bịa bản dịch**: cụm không có nghĩa VI hiển thị định nghĩa EN hoặc `[từ gốc]`; mỗi kết quả ghi tỉ lệ
  phủ dữ liệu tiếng Việt.

### Bản dịch máy (mặc định)

- Cài đặt → Hành vi đọc → **Chế độ dịch**: *Dịch máy (Chrome)* (mặc định) hoặc *Chỉ từ điển*. Ở chế độ chỉ từ điển,
  popup có nút **Bật bản dịch máy** một chạm.
- Dùng `Translator` API của Chrome 138+ (cặp en → vi). Chrome chỉ cho tải mô hình trong một thao tác của người
  dùng: nếu bạn vừa click (tra câu, click bong bóng) việc tải bắt đầu ngay, nếu không popup hiện nút **Tải mô hình
  dịch**. Sau đó dịch trên máy, kết quả được cache theo câu.
- Danh sách **Từng từ** của bong bóng OCR: từ chưa có nghĩa tiếng Việt trong từ điển được dịch máy, có nhãn
  “dịch máy”, định nghĩa tiếng Anh vẫn hiện bên dưới.
- Áp dụng cho: popup bong bóng OCR (thẻ **Bản dịch**, thay cho nghĩa ghép), popup Cụm từ, popup Câu/Đoạn văn,
  sidebar (cụm, câu, đoạn, từng vùng OCR), và dòng dịch “→ …” dưới mỗi định nghĩa tiếng Anh.
- **Từ đơn**: nghĩa từ điển luôn đứng trước. Chỉ những từ **không có** nghĩa tiếng Việt trong dữ liệu (ví dụ “weather”,
  “perpetrator”) mới dùng dịch máy (thẻ **Nghĩa · dịch máy**). Lý do (đã kiểm tra với Translator API của Chrome): dịch
  một từ đứng riêng không có ngữ cảnh rất dễ lệch với từ thông dụng — “you” → “mày”, “run” → “bay màu”, “escape” →
  “vượt ngục”. Từ được gửi đi dịch ở dạng chữ thường.
- Chế độ **Chỉ từ điển**: không dịch máy; từ thiếu dữ liệu tiếng Việt hiện thông báo rõ ràng.
- **Tải trước**: ở lần click thật đầu tiên trên một trang web, LingoLens nhờ Chrome tải mô hình ngầm (có thông báo
  ngắn), nên bong bóng đầu tiên không phải chờ. Hoặc bấm **Tải mô hình dịch** trong menu biểu tượng / Cài đặt.
- Chrome không hỗ trợ / chưa có cặp en → vi → báo rõ và chỉ dùng Dictionary Mode.
- Chữ OCR in hoa vẫn dịch tốt; từ bị ngắt bằng gạch nối được nối lại trước khi dịch. Chữ OCR nhận sai sẽ dịch sai.

## 5a. Bật theo từng trang web

- **Mặc định tắt trên mọi trang.** Content script vẫn được Chrome nạp, nhưng trên trang chưa bật nó không gắn
  phần tử nào vào trang và không phản hồi thao tác nào.
- Bật: biểu tượng LingoLens → **Bật LingoLens trên trang này** (lưu tên miền vào `general.sites`, áp dụng cả tên
  miền con và `www.`). Có hiệu lực ngay, không cần tải lại trang. Biểu tượng hiện **ON** trên tab của trang đã bật;
  menu chuột phải của LingoLens chỉ hiện ở các trang đó.
- Quản lý danh sách + **Tạm dừng trên mọi trang**: Cài đặt → Hành vi đọc.

## 5b. Menu biểu tượng thanh công cụ

- Công tắc **Bật LingoLens trên trang này**, số trang đang bật, **Mở Sidebar** (chỉ cho tab hiện tại), **Cài đặt**,
  và trạng thái mô hình dịch kèm nút **Tải mô hình dịch**.

## 5c. Cài đặt có xem trước

- Mỗi trang chỉ xem trước phần liên quan: trang **OCR** chỉ có khung manga + khung bong bóng; trang **Sidebar** có
  Sidebar thu nhỏ (màu, màu nền, cỡ chữ, tab mặc định, đầy đủ/thu gọn); Giao diện, Floating Popup, Chữ, Từ điển chỉ
  có popup.
- Các trang Giao diện, Floating Popup, Chữ, Từ điển, OCR có khối **Xem trước** (bên phải trên màn hình rộng, phía trên
  trên màn hình hẹp): khung manga với bong bóng + khung OCR theo màu đã chọn, và popup mẫu dùng đúng chủ đề, màu nền,
  màu nhấn, độ rộng, font, cỡ chữ, giãn dòng, độ trong suốt, các tab, IPA/từ loại, hiệu ứng mở. Thay đổi hiện ngay.

## 6. Sidebar

- Giao diện: dải màu nhấn + trạng thái (Dịch máy / Chỉ từ điển), ô nhập lớn, 5 tab dạng nút có biểu tượng (tab đang mở tô màu), thẻ có vạch màu; sổ từ: vạch màu theo trạng thái (Mới xanh dương, Đang học cam, Đã thuộc xanh lá), nghĩa in đậm, câu gốc trong khung trích dẫn, nút trạng thái tô màu, thẻ nổi lên khi rê chuột.

Tab Dịch · Từ vựng · Ngữ pháp · Ngữ cảnh · Đã lưu; ô nhập văn bản; giữ nội dung khi chuyển tab
(`chrome.storage.session`); nhận nội dung mới từ popup/OCR; xóa nội dung; chế độ thu gọn; mở từ popup,
thanh công cụ, menu chuột phải hoặc phím tắt (`Alt+Shift+S` bật/tắt).

## 7. Settings Center

Xem [SETTINGS.md](SETTINGS.md).

## 8. Sổ từ vựng

Lưu: từ, lemma, IPA, nghĩa, từ loại, câu gốc (≤ 400 ký tự), bản ghép nghĩa, website nguồn (bỏ query/hash),
tiêu đề trang, ngày lưu, trạng thái (Mới/Đang học/Đã thuộc), ghi chú. Chức năng: lưu, xóa, đổi trạng thái,
ghi chú, tìm kiếm, lọc, sắp xếp, xuất JSON/CSV (chống công thức Excel), nhập JSON/CSV (bỏ trùng). Khi bộ nhớ
đầy: tự xóa bớt cache OCR rồi thử lại, nếu vẫn đầy thì báo lỗi rõ ràng; cảnh báo khi dùng > 85% quota.
