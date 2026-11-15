# OCR cho manga

LingoLens dùng **Tesseract.js 6.0.1** với mô hình **`eng` LSTM (4.0.0_best_int)**, chạy hoàn toàn trong trình
duyệt. Worker, lõi WASM (bản SIMD và không SIMD) và dữ liệu ngôn ngữ đều nằm trong gói tiện ích
(`dist/vendor/tesseract/`); không tải gì từ Internet, ảnh không rời khỏi máy.

## Cách dùng

1. **Quét một ảnh** (cả trang): rê chuột lên ảnh manga (≥ 220 px) → bấm **Quét OCR** ở góc phải trên của ảnh.
   Sidebar của tab mở ngay (“Đang quét…”), rồi hiện danh sách bong bóng đánh số (số giống trên ảnh), mỗi bong bóng
   kèm bản dịch máy, nút phát âm và **Phân tích**. Quét cả trang mất khoảng 10–20 giây vì đọc từng bong bóng.
2. **Quét một vùng**: bấm nút ✂ cạnh “Quét OCR”, hoặc chuột phải → *LingoLens: chọn vùng để quét OCR*, rồi kéo
   chuột quanh bong bóng thoại. Có nút **Quét toàn màn hình** để quét cả vùng đang hiển thị.
   Quét xong, popup nghĩa của bong bóng **tự mở** bên cạnh vùng chọn; không có thanh kết quả che chữ.
3. **Phím tắt** `Alt+Shift+O`: quét ảnh dưới con trỏ, hoặc ảnh lớn nhất đang hiển thị.
4. Trong khi quét: không có khung tiến độ — chỉ viền nét đứt chạy quanh vùng đang quét và một chip nhỏ (vòng xoay,
   %, nút ✕). `Esc` hoặc ✕ để hủy; lỗi/hủy hiện bằng thông báo ngắn. OCR được **khởi động sẵn** khi rê chuột lên ảnh
   manga hoặc khi bắt đầu chọn vùng, và giữ sẵn 10 phút, nên lúc bấm quét không phải chờ nạp dữ liệu.
5. Kết quả: mỗi bong bóng/vùng chữ được đóng khung (mặc định màu cam, đổi trong Cài đặt → OCR; nét đứt: tin cậy
   < 65%, xanh lá: đã sửa).
   Click khung → popup **Văn bản OCR** hiện **bên cạnh bong bóng** (phải, hoặc trái nếu hết chỗ; không che chữ),
   màu sáng mặc định. Mỗi mục là một thẻ có màu riêng, nổi lên và sáng viền khi rê chuột:
   - **Nguyên văn** (xám): văn bản nhận diện, click từ để tra; từ có độ tin cậy < 70% được gạch chân chấm;
   - **Bản dịch** (xanh dương): bản dịch máy của Chrome. Nếu dịch máy tắt hoặc không chạy được, thẻ này là
     **Nghĩa (từ điển)** (ghép nghĩa theo cụm);
   - **Từng từ** (xanh lá): mỗi từ nội dung kèm dạng gốc, IPA, **nghĩa in đậm** (tiếng Việt; từ điển chưa có thì dịch
     máy, nhãn “dịch máy”; định nghĩa tiếng Anh in nghiêng) và nút phát âm; tối đa 24 từ. Click thẻ để xem đầy đủ;
   - chân popup: **Phân tích câu**, **Sửa**, **Sao chép**.
6. **Kéo viền bong bóng**: rê chuột lên khung → hiện 8 tay nắm (góc, cạnh). Kéo để khung bao trọn chữ bị sót (hoặc
   bỏ bớt phần thừa), thả chuột → chỉ vùng đó được quét lại (chế độ một khối chữ) và thay nội dung của bong bóng (giữ
   số thứ tự); popup nghĩa và danh sách trong Sidebar cập nhật. Trong lúc quét lại khung có viền chạy.
7. Không có thanh kết quả nổi trên trang (số vùng chữ hiện trong thông báo ngắn). **Quét ảnh/vùng mới sẽ xóa các khung cũ**; nhấn `Esc` (khi không có popup) để xóa hết khung OCR.

## Quét cả trang: đọc theo từng bong bóng (2 lượt)

1. **Lượt 1** (PSM 11, chữ thưa) tìm các dòng chữ trên cả trang.
2. **Tìm bong bóng**: từ mỗi dòng chữ, tô loang (flood fill) vùng nền sáng quanh nó; vùng khép kín bởi viền đen =
   lòng bong bóng. Các dòng rơi vào cùng một lòng bong bóng thuộc cùng bong bóng (quyết định bằng viền vẽ, không bằng
   khoảng cách). Bong bóng dính liền / chữ không viền trên nền trắng được tách tiếp theo cột chữ. Ngoài ra dò thêm các
   vùng sáng khép kín có hình bong bóng và có nét chữ bên trong (bong bóng mà lượt 1 bỏ sót hoàn toàn).
3. **Lượt 2**: cắt từng bong bóng, **xóa trắng phần tranh bên ngoài lòng bong bóng**, phóng to và đọc như một khối
   chữ (PSM 6); nếu kém thì đọc lại kiểu chữ thưa và giữ kết quả có nhiều từ chắc chắn hơn; nếu vẫn kém hơn lượt 1
   thì giữ lượt 1.
4. **Lọc**: bỏ cụm không giống chữ (ít chữ cái, độ tin cậy thấp — chặt hơn với chữ ngoài bong bóng: từ < 60% bị bỏ);
   **kiểm tra bằng từ điển trên máy** (≥ 50% số từ từ 3 chữ cái phải có trong từ điển, tính cả dạng chia như
   made → make); khối chỉ có một từ ngắn chỉ giữ khi là câu cảm thán đứng một mình trong bong bóng (I…, NO!, WHAT?!);
   trên trang chữ IN HOA, bỏ token chữ thường ngắn và mẩu chữ lẫn hoa–thường ở đầu/cuối câu (nét tranh); gộp bong
   bóng trùng.
5. **Bong bóng dính liền / chữ trên một hàng**: dòng đã thuộc khối phía trên được bỏ khỏi khối phía dưới (không chồng khung, không lặp chữ); các cụm chữ không viền cùng một hàng và sát nhau (tiêu đề) được gộp.
6. **Không lệch khung**: khi quét cả trang, Sidebar mở trước; LingoLens đợi trang dàn lại (Sidebar làm trang hẹp
   đi) rồi mới đo vị trí ảnh và chụp. Chụp màn hình bị Chrome giới hạn 2 lần/giây — nếu quét liên tiếp, LingoLens
   tự đợi và chụp lại.

## Quy trình xử lý

1. **Lấy điểm ảnh** (theo thứ tự):
   - ảnh cùng origin / `blob:` / `data:` / canvas không bị “taint” → content script đọc điểm ảnh gốc;
   - tải ảnh gốc từ service worker (**không gửi cookie**) → độ phân giải đầy đủ, quét được cả phần ngoài màn hình;
   - nếu bị chặn (hotlink protection, cần cookie…) → `chrome.tabs.captureVisibleTab` rồi cắt đúng vùng ảnh đang
     hiển thị (UI của LingoLens tự ẩn trong lúc chụp). Khi đó chỉ quét được **phần đang hiển thị** (ghi “một phần”).
2. **Tiền xử lý** (offscreen): cắt vùng, phóng to để chữ đạt ~20–30 px (tối đa ×3, tối đa 12 MP), chuyển xám,
   kéo giãn tương phản theo phân vị 1%–99%.
3. **Nhận diện**: PSM 11 (chữ thưa – hợp với trang manga), PSM 3 (tự động) hoặc PSM 6 (một khối – mặc định cho
   vùng nhỏ).
4. **Hậu xử lý**: bỏ từ dưới ngưỡng tin cậy, bỏ ký tự nhiễu (nền tram, đường viền), sửa `|` → `I`, bỏ ký tự đơn có độ tin
   cậy < 75%, **dựng lại các dòng từ khung của từng từ** (Tesseract đôi khi trả một “dòng” trải qua nhiều hàng chữ
   và tách hàng giữa ra riêng), gom các hàng gần nhau thành một bong bóng theo chiều cao chữ trung vị của trang, rồi
   **gộp các bong bóng có khung chồng nhau**, nối từ bị ngắt bằng gạch nối cuối dòng, chuẩn hóa tọa độ 0..1 theo ảnh.
5. **Cache**: khóa = SHA-256(URL ảnh + kích thước gốc + chế độ + ngôn ngữ + ngưỡng), hoặc dấu vân tay điểm ảnh
   (ảnh thu nhỏ 32×32, 16 mức xám) với ảnh chụp màn hình. Lưu tối đa 150 kết quả / 3 MB (LRU), chỉ văn bản và
   tọa độ — không lưu ảnh.

Worker được giữ ấm giữa các lần quét và tự giải phóng (~100 MB) sau 5 phút không dùng. Hủy quét sẽ dừng worker
(Tesseract.js không hỗ trợ hủy giữa chừng), lần quét sau khởi tạo lại.

## Giới hạn (không tuyên bố OCR chính xác tuyệt đối)

- Trang chặn tải ảnh gốc (ví dụ CDN có hotlink protection) → LingoLens chụp **phần đang hiển thị**; bong bóng nằm
  ngoài màn hình hoặc bị cắt ở mép sẽ không đọc đủ. Thu nhỏ trang (Ctrl −) để cả trang manga vừa màn hình rồi quét.
- Chữ hiệu ứng âm thanh, tiêu đề kiểu chữ trang trí, chữ viết tay vẫn hay sai; bong bóng không có viền trên nền tranh
  có thể bị tách hoặc bỏ sót.

- Chỉ đóng gói **tiếng Anh chữ ngang**. Chữ dọc, tiếng Nhật/Hàn/Trung chưa được đóng gói (đã có registry
  `src/ocr/languages.ts` để thêm).
- Font viết tay, chữ nghiêng/cong, chữ trên nền rối, chữ trắng viền đen và **hiệu ứng âm thanh** thường nhận sai
  hoặc bỏ sót. Hãy dùng chọn vùng sát bong bóng và chức năng **Sửa**.
- Ảnh trong `iframe` khác origin không được hỗ trợ trong v0.1 (content script chỉ chạy ở khung chính).
- Ảnh vẽ bằng WebGL/canvas bị khóa chỉ quét được phần đang hiển thị.
- Thời gian quét phụ thuộc máy: lần đầu cần khởi tạo worker (~1–2 s); trong kiểm thử, trang 760×560 px mất ~1.8 s.

## Kết quả kiểm thử

- Integration test (Node, cùng engine + mô hình): nhận đủ “I'M GONNA BECOME THE STRONGEST NINJA!” và
  “WHAT THE HELL IS GOING ON HERE?!” từ ảnh bong bóng thoại dựng bằng Chrome, đúng 2 vùng, đúng vị trí.
- E2E trong Chrome thật: quét qua tải ảnh, qua chụp màn hình, chọn vùng, cache, hủy, sửa kết quả, tra từ từ OCR.
- Lưu ý: ảnh kiểm thử là chữ in sạch; ảnh manga thật (scan, nén JPEG, font viết tay) sẽ cho kết quả kém hơn.
