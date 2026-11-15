# Kiểm thử

Mọi kết quả dưới đây là từ các lần chạy thật ngày 2026-11-14 trên Windows 11, Node 24.18.1,
**Google Chrome 157.0.8103.51**. Không có mục nào được đánh dấu PASS mà chưa chạy.

```bash
npm run typecheck   # tsc --noEmit
npm test            # Vitest: unit + integration
npm run build
npm run e2e         # Chrome thật, nạp dist/ qua CDP Extensions.loadUnpacked
```

## Tổng hợp

| Bộ kiểm thử | Kết quả |
|---|---|
| TypeScript (`strict`) | **0 lỗi** |
| Unit + integration (Vitest, 9 tệp) | **140 / 140 PASS** (~1.6 s) |
| Build | **PASS** – `dist/` 36 MB |
| End-to-end trong Chrome 157 (headless mới) | **39 / 39 PASS** – `test-results/e2e.json` |

## Unit & integration (`tests/`)

| Yêu cầu | Tệp | Nội dung |
|---|---|---|
| 1. Word extraction | `language.test.ts` | từ dưới caret, dấu câu/ngoặc kép, rút gọn, dấu nháy cong, gạch nối, `'em`/`goin'`, `U.S.`, khoảng trắng, câu ngữ cảnh |
| 2. Text selection | `dom-and-ui.test.tsx` | đọc vùng chọn + ngữ cảnh; bỏ qua input/textarea/contenteditable/CodeMirror; link/nút; ngữ cảnh đang gõ |
| 3. Language detection | `language.test.ts` | Anh (kể cả từ đơn, slang), Việt, Pháp, Tây Ban Nha, Đức, Nhật, Hàn, Trung, Nga, không chữ |
| 4. Dictionary lookup | `dictionary.test.ts` | dữ liệu thật: VI + EN + IPA + nguồn; lemma bất quy tắc; từ nhiều nghĩa (`bank` sông/ngân hàng theo ngữ cảnh); slang, viết tắt (`lol`), rút gọn; không tìm thấy + gợi ý; không bịa nghĩa VI; cache |
| 5. Phrase matching | `translation.test.ts`, `dictionary.test.ts` | dài nhất trước, đầu cụm chia thì, `one's`, cụm tách rời, không vượt dấu câu; cụm WordNet |
| 6. Sentence segmentation | `language.test.ts` | `?!`, ngoặc kép, viết tắt, tên viết tắt, số thập phân, `I... I`, đoạn trống, 400 câu < 200 ms |
| 7. Translation fallback | `translation.test.ts` | thiếu nghĩa VI → định nghĩa EN / `[từ]`, tỉ lệ phủ < 100%; từ không tồn tại không có nghĩa bịa; tiếng Pháp bị từ chối |
| 8. OCR processing | `ocr.test.ts` | tìm bong bóng bằng tô loang (ảnh tổng hợp), dò bong bóng từ hình vẽ, gộp/nới mặt nạ, lọc nét vẽ bị đọc thành chữ (chữ thường trên trang IN HOA), dựng lại hàng từ khung từng từ + gộp bong bóng chồng nhau (dữ liệu thật từ trang manga), lọc nhiễu/ngưỡng, chuẩn hóa tọa độ, gom bong bóng, nối gạch nối, ánh xạ ảnh chụp một phần, tỉ lệ phóng (kể cả ảnh rất lớn), tương phản; **Tesseract thật** đọc đúng ảnh bong bóng thoại; ảnh trắng → 0 vùng (không lỗi) |
| 9. Popup positioning | `popup-position.test.ts` | cạnh bong bóng OCR (phải/trái/dự phòng), dưới/trên/cạnh/góc, không che từ, trong khung nhìn, ưu tiên vị trí, giới hạn chiều cao |
| 10. Settings persistence | `storage.test.ts` | mặc định cho dữ liệu hỏng, kẹp số, enum, tên miền, gộp sâu, lưu/đọc giữa 2 ngữ cảnh, thông báo thay đổi, reset |
| 11. Sidebar communication | `background.test.ts` | lưu `storage.session` + broadcast, lịch sử, theo dõi panel mở; router mở side panel **đồng bộ** trước khi gửi payload (giữ user gesture) |
| 12. Vocabulary storage | `storage.test.ts` | lưu/trùng lemma/trạng thái/ghi chú/xóa, tìm kiếm/lọc/sắp xếp, xuất/nhập JSON/CSV (vòng tròn), chống công thức CSV, quota đầy → giải phóng cache → lỗi rõ ràng, làm sạch URL |
| Khác | `background.test.ts` | OCR service: tải ảnh, cache (không OCR lại), fallback chụp màn hình + ánh xạ vùng, lỗi worker, hủy giữa chừng, ngôn ngữ chưa đóng gói |
| Khác | `machine-translation.test.ts` | Translator API giả lập: mặc định là dịch máy (giá trị “tắt” cũ không chặn), không hỗ trợ / cặp ngôn ngữ không có, gọi đúng cặp en→vi, chuẩn hóa chữ OCR, cache, tiến độ tải, phục hồi sau lỗi |
| Khác | `storage.test.ts` | cache OCR LRU, CSV RFC 4180, nhập từ điển JSON/CSV, từ điển người dùng IndexedDB (`fake-indexeddb`) |
| Khác | `translation.test.ts` | 13 trường hợp thì/thể, bị động, điều kiện 1/2/3, loại câu, S-V-O, mệnh đề phụ/quan hệ, đoạn 30 câu < 3 s |
| Khác | `dom-and-ui.test.tsx` | render mọi view kết quả với dữ liệu thật; ẩn mục theo cài đặt; ngôn ngữ đích English; theme tokens; danh sách từ của bong bóng OCR; màu khung bong bóng, màu/nền popup |

## End-to-end (`scripts/e2e.mjs`)

Trình chạy khởi động Chrome với `--remote-debugging-pipe --enable-unsafe-extension-debugging`, nạp `dist/` bằng
`Extensions.loadUnpacked`, phục vụ trang fixture từ 2 cổng localhost (để có ảnh khác origin), và điều khiển
bằng sự kiện chuột/bàn phím thật của CDP.

| # | Kịch bản | Kết quả |
|---|---|---|
| 1 | Cài đặt, service worker MV3 khởi động | PASS |
| 2 | Shadow DOM đóng; script của trang **không** đọc được UI | PASS |
| 3 | Click từ → popup Word mode (`destroyed` → destroy, “phá hủy”), popup không che từ, vị trí cuộn không đổi | PASS |
| 4 | CSS “thù địch” của trang (`html{font-size:62.5%}`, `* {letter-spacing}`, `text-transform`) không ảnh hưởng popup | PASS |
| 5 | `Esc` đóng popup | PASS |
| 6 | Từ tách qua thẻ (`<b>Wha</b>tever`) | PASS |
| 7 | Click khoảng trắng / liên kết / ô nhập → không mở popup | PASS |
| 8 | Bôi đen câu → Sentence mode, ghép nghĩa “ngôi làng bị/được phá hủy bởi ác quỷ”, tab ngữ pháp: bị động + quá khứ đơn | PASS |
| 9 | Bôi đen cụm → Phrase mode (“piece of cake” → dễ như ăn bánh) | PASS |
| 10 | Click 3 lần → Paragraph mode (2 câu) | PASS |
| 11 | Đoạn tiếng Việt → nhận diện, không dịch | PASS |
| 12 | Lưu từ → `chrome.storage.local` có từ, nghĩa, câu gốc, URL nguồn | PASS |
| 13 | Nút “Mở Sidebar” (click thật) → mở Chrome Side Panel với nội dung đang tra | PASS |
| 14 | Tắt click-to-lookup → áp dụng ngay, bật lại → hoạt động | PASS |
| 15 | Tra cứu khi service worker ở chế độ offline | PASS |
| 16 | **Bảo mật**: click giả lập (untrusted) vào nút quét không khởi động OCR | PASS |
| 17 | OCR ảnh khác origin (tải ảnh gốc): 2 vùng, 6/6 từ khóa | PASS |
| 18 | Click khung OCR → popup OCR → click “STRONGEST” → tra từ, có nút quay lại | PASS |
| 19 | Sửa văn bản OCR | PASS |
| 20 | Quét lại → lấy từ cache | PASS |
| 21 | Ảnh chặn hotlink (403) → fallback `captureVisibleTab`, vẫn nhận đủ chữ | PASS |
| 22 | Hủy OCR khi đang chạy | PASS |
| 23 | Chọn vùng → OCR đúng bong bóng được chọn | PASS |
| 24 | Trang sidebar nhận nội dung đẩy từ background; lưu `storage.session` | PASS |
| 25 | Sidebar: tab Ngữ pháp, Ngữ cảnh, Đã lưu; đánh dấu “Đã thuộc” | PASS |
| 26 | Sidebar: nhập câu và phân tích | PASS |
| 27 | Settings: đổi chủ đề → lưu → sidebar đổi ngay → tải lại vẫn giữ → Reset to Default | PASS |
| 28 | Nhập từ điển CSV → tra cứu dùng dữ liệu mới → xóa | PASS |
| 29 | Không có request nào ra ngoài máy từ tiện ích/trang (mô hình dịch do tiến trình Chrome tải, không qua tiện ích) | PASS |
| 14b | Menu biểu tượng: công tắc tắt → huy hiệu “OFF”, click từ không mở popup; bật lại → hoạt động | PASS |
| 30 | Popup bong bóng OCR: nằm cạnh bong bóng, không che chữ, nền sáng, danh sách từ có IPA + nghĩa, khung màu cam | PASS |
| 31 | Bản dịch máy (mặc định): quét vùng bong bóng → tải mô hình (từ thao tác click hoặc nút “Tải mô hình dịch”) → bản dịch tiếng Việt tự nhiên; nghĩa từ điển vẫn hiện. **Cần mạng** để Chrome tải mô hình lần đầu | PASS |
| 32 | Dịch máy cho từ đơn: click “weather” (không có trong dữ liệu Anh–Việt) → “thời tiết” + định nghĩa được dịch | PASS |
| 33 | Mặc định tắt: trang chưa bật không có phần tử nào của MangaLingo; bật cho 127.0.0.1 → hoạt động | PASS |
| 34 | Biểu tượng: huy hiệu “ON” chỉ trên trang đã bật; tắt trang → gỡ UI khỏi trang, click không mở popup; bật lại → hoạt động ngay | PASS |
| 35 | Quét cả trang → danh sách bong bóng trong Sidebar; Side Panel chỉ bật cho tab đó (mặc định tắt cho tab khác) | PASS |
| 36 | Cài đặt: khối Xem trước đổi ngay khi đổi màu khung OCR / độ rộng popup | PASS |
| 37 | Không cần F5: tab mở **trước khi cài** tiện ích → bật trang → script được nạp vào tab, tra từ được ngay, tab không tải lại | PASS |
| 38 | Cài đặt Sidebar: màu nền riêng áp dụng ngay cho Side Panel (chữ tối trên nền sáng) và cho khối Xem trước | PASS |
| 39 | Kéo viền bong bóng bằng chuột thật: thu nhỏ → chỉ còn “STRONGEST NINJA!”; kéo rộng lại → “I'M GONNA BECOME THE STRONGEST NINJA!”, popup cập nhật | PASS |
| — | Quét: không còn khung tiến độ (chỉ viền + chip nhỏ < 140 px), hủy → thông báo; click ra ngoài → khung bong bóng biến mất | PASS |

## Trường hợp đặc biệt theo yêu cầu

| Trường hợp | Kiểm thử bởi |
|---|---|
| Website không có văn bản HTML (chỉ ảnh) | E2E 17–23 (trang manga chỉ có ảnh) |
| CSS phức tạp | E2E 4 |
| Trang manga ảnh lớn | `computeScale` giới hạn 12 MP (unit); ảnh > 30 MP không đọc qua canvas; tải ảnh ≤ 25 MB |
| OCR thất bại | unit: lỗi worker → thông báo lỗi; ảnh trắng → 0 vùng; E2E: hủy |
| Từ nhiều nghĩa | unit `bank`, `run`, `fly` |
| Từ viết tắt | unit `lol`, `U.S.`, `e.g.`, `Mr.` |
| Slang / Idiom | unit `gonna`, `dude`, `what the hell`, `piece of cake`, `lose one's mind`; E2E 9 |
| Đoạn văn dài | unit 400 câu (tách câu), 30 câu (phân tích) |
| Không có Internet | E2E 15, 29 |
| Không tìm thấy dữ liệu | unit `destory`, `qzxvbn`; `photosynthesis` (chỉ EN) |
| Người dùng tắt tính năng | E2E 14; unit ẩn mục theo cài đặt |

## Chưa được kiểm thử tự động (cần kiểm tra thủ công)

- Phím tắt toàn cục (`Alt+Shift+S/L/O`) — CDP không gửi được phím tắt cấp trình duyệt. Code xử lý lệnh nằm ở
  `src/background/index.ts`; các đường xử lý phía trang mà lệnh gọi tới (`cmd:*`, `ctx:*`) đã được E2E gián tiếp
  qua tin nhắn tab.
- Bấm mục menu chuột phải (cùng lý do); E2E gửi trực tiếp tin nhắn `ctx:scan-region` mà menu gửi.
- Phát âm (Web Speech API) — không kiểm chứng âm thanh trong môi trường headless.
- Nút tải tệp xuất / chọn tệp nhập trong giao diện (logic xuất/nhập đã có unit test).
- Chế độ tự đóng popup (khi cuộn / rời chuột / hẹn giờ) và chủ đề sáng của popup trong trang.
- Hiệu năng/độ chính xác OCR trên trang manga thật (scan JPEG, font viết tay) — fixture kiểm thử là chữ in sạch.

## Ảnh giao diện

`npm run screenshots` lưu ảnh popup (từ, ngữ cảnh, câu, ngữ pháp), OCR (nút quét, khung, popup OCR), sidebar và
Settings Center vào `test-results/screens/`.
