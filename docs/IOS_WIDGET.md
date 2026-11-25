# Widget từ vựng cho iPhone (bản thử nghiệm)

Một từ đã lưu hiện trên màn hình chính, **đổi mỗi giờ**. Có cỡ nhỏ, vừa, và hai kiểu màn hình khoá (chữ nhật, một dòng).

## Cách hoạt động
- `ios/LingoLensWidget/`: widget (WidgetKit, iOS 17+; app vẫn chạy iOS 16). Tạo sẵn 24 mục thời gian, mỗi giờ một từ, nên từ đổi đúng giờ kể cả khi iOS chưa làm mới widget. Thứ tự đổi mỗi ngày để mọi từ hiện hết trước khi lặp. Bỏ qua từ đã đánh dấu "đã biết".
- `src/mobile/widget.ts` + `WidgetCard.tsx`: khi mở app và mỗi khi sổ từ đổi, app gửi danh sách rút gọn (từ, phiên âm, nghĩa, ví dụ, tối đa 300 từ) sang vỏ native.
- `ios/MangaLingo/WidgetSync.swift`: ghi danh sách vào file JSON trong **App Group** rồi báo WidgetKit tải lại.
- `ios/Shared/WidgetShared.swift`: dùng chung cho app và widget. **Không gán cứng tên App Group**: đọc các nhóm có trong chữ ký thật của app (`embedded.mobileprovision`), vì Sideloadly có thể đổi bundle id.

## Hai đường dữ liệu (đây là bản thử để biết đường nào đi được)
1. **Tự động (App Group).** Widget đọc file do app ghi. Dùng được hay không phụ thuộc Apple ID miễn phí + Sideloadly có giữ quyền App Group không.
2. **Dán (không cần App Group).** Trong app bấm *Chép danh sách cho widget*, rồi giữ widget → *Chỉnh sửa widget* → dán vào ô *Danh sách từ*. Hệ thống lưu giá trị đó cho widget.

Thẻ "Widget từ vựng (thử nghiệm)" trên màn Home hiện kết quả đo: bundle id, nhóm trong chữ ký, có dùng được App Group không, số từ đã ghi.

## Cách thử
1. Cài `LingoLens.ipa` bằng Sideloadly (cài cả extension; nếu Sideloadly hỏi, cho phép).
2. Mở app, xem thẻ Widget trên Home và chụp lại.
3. Giữ màn hình chính → dấu **+** → tìm **LingoLens** → thêm widget Từ vựng.
4. Nếu thẻ báo "App Group không dùng được", dùng cách dán.

## Những điều chưa biết (chưa kiểm chứng)
- Sideloadly có cài và ký được extension widget với Apple ID miễn phí không.
- App Groups có hoạt động với Apple ID miễn phí không.
- Chưa chạy trên máy thật; mã Swift mới chỉ được biên dịch trên máy macOS của GitHub.
- Giới hạn độ dài của ô dán chưa biết (app chép tối đa 120 từ).
- Widget chưa có thao tác bấm vào để mở đúng từ.

## Riêng tư
Chỉ từ, phiên âm, nghĩa và câu ví dụ, nằm trong máy (container App Group). Không gửi đi đâu.

## Kết quả thử trên iPhone (2026-11-25, Apple ID miễn phí + Sideloadly)
- Sideloadly **cài được** widget (extension): widget hiện trong thư viện widget.
- Sideloadly đổi bundle id thành `app.mangalingo.ios.<TeamSuffix>`.
- **App Group không dùng được**: chữ ký không có nhóm nào ("Nhóm trong chữ ký: không có"). Vì vậy đường tự động không chạy với Apple ID miễn phí.
- Cách đi được: **dán danh sách** vào ô cấu hình của widget. Định dạng chép là **một dòng** (`từ | phiên âm | nghĩa | ví dụ`, các từ cách nhau bằng ` ¶ `) để chịu được ô nhập một dòng.
- Nếu sau này dùng tài khoản Apple Developer trả phí, đường App Group (tự đồng bộ) trong mã sẽ tự hoạt động, không cần đổi gì.

## Giao diện và thao tác (bản 2)
- Chỉ hiện: **từ**, **phiên âm**, **loại từ** (nhãn nhỏ), **nghĩa**. Không còn ví dụ, nguồn hay số thứ tự.
- **Nút mũi tên** (iOS 17+) ở góc phải dưới: bấm để sang từ khác **ngay**, không chờ một giờ. Widget tự nhớ đã bỏ qua bao nhiêu từ.
- **Xếp chồng nhiều widget** (Stack): mỗi widget đặt "Từ thứ" khác nhau (0, 1, 2…) trong Chỉnh sửa widget; **vuốt lên/xuống** trên chồng để thấy từ khác. Đây là cách duy nhất để "vuốt" trên màn hình chính, vì một widget đơn không nhận thao tác vuốt.
- Tự cập nhật khi thêm từ chỉ chạy khi widget đọc được sổ từ (App Group). Với Apple ID miễn phí qua Sideloadly thì chưa, xem mục kết quả thử.

## Tự cập nhật không cần App Group: đồng bộ mã hoá qua GitHub (bản 3)
Apple ID miễn phí không có App Group (xem kết quả thử), nên app đẩy danh sách **đã mã hoá** lên một repo GitHub của bạn, và widget đọc lại.

- **Mã hoá:** AES-256-GCM (CryptoKit) ngay trên iPhone. Repo là **công khai** để widget đọc không cần mật khẩu, nhưng chỉ chứa dữ liệu mã hoá. Khoá không nằm trong repo: nó chỉ có trong app và trong **mã đồng bộ** bạn dán vào widget.
- **Mã đồng bộ:** `LL1~ten-ban/ten-repo~<khoá>`: không chứa token. Dán **một lần** vào ô "Mã đồng bộ" của widget.
- **Token:** chỉ app giữ (Keychain, chỉ trên máy này), quyền `Contents: Read and write` trên **một** repo. Gửi tới `api.github.com`, không đi đâu khác. Widget không có token.
- **Khi bạn lưu từ:** app (debounce 1,5 giây) mã hoá, ghi file `lingolens-words.json` lên repo, rồi báo widget tải lại ngay. Widget còn tự đọc lại mỗi vài giờ, và giữ bản lưu tạm để chạy khi mất mạng.
- **Độ trễ:** API GitHub có thể trả bản cũ tới 60 giây.

### Cài đặt (một lần)
1. Trên github.com tạo repo **Public**, ví dụ `lingolens-sync`.
2. Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate: *Only select repositories* → repo đó; *Repository permissions → Contents: Read and write*; hạn tuỳ chọn.
3. Trong app: Trang chủ → Widget từ vựng → nhập `ten-ban/lingolens-sync` và token → **Kết nối**.
4. Bấm **Chép mã đồng bộ**, thêm widget, giữ widget → Chỉnh sửa widget → dán vào **Mã đồng bộ**.

### Giới hạn
- Phụ thuộc GitHub (miễn phí, có giới hạn tần suất cho truy cập ẩn danh: 60 lần/giờ/địa chỉ IP, đủ cho một widget).
- Gỡ app hoặc cài lại sẽ tạo khoá mới: phải dán mã mới vào widget.
- Mã đồng bộ cho ai thì người đó đọc được danh sách của bạn: đừng chia sẻ.
