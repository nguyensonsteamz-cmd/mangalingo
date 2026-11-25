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

## Cài đặt đơn giản cho người mới (bản 4)
Cho người dùng chỉ còn: **Bật tự cập nhật** → nhập mã ngắn trên GitHub → thêm widget → dán mã đồng bộ (đã được chép sẵn). Mỗi bước app tự kiểm tra và đánh dấu ✅.

1. **Bật tự cập nhật:** app xin GitHub một mã (device flow), chép sẵn vào clipboard, mở github.com/login/device. Người dùng dán mã, bấm Authorize. App tự nhận ra, tạo repo công khai `lingolens-sync` trong tài khoản của họ, giữ token trong Keychain, và **chép sẵn mã đồng bộ**.
2. **Thêm widget** (giữ màn hình chính → +). App đếm được số widget LingoLens đang có (iOS 17+).
3. **Dán mã đồng bộ** vào ô "Mã đồng bộ" của widget. App đọc lại cấu hình widget và báo "Widget đã nhận mã" khi đúng.

Quyền GitHub: `public_repo` (GitHub không có quyền nhỏ hơn cho việc tạo repo). Người dùng thu hồi tại github.com/settings/applications. Cách nhập token thủ công vẫn còn trong mục "Nâng cao".

### Việc của người phát triển (một lần)
Đăng nhập bằng mã ngắn cần một **GitHub OAuth App** do người phát triển đăng ký (không phải từng người dùng):
1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App. Tên `LingoLens`, Homepage URL là trang repo, Authorization callback URL điền tuỳ ý (không dùng).
2. Mở app vừa tạo, đánh dấu **Enable Device Flow**, rồi lưu.
3. Chép **Client ID** (công khai, không phải bí mật) và đặt vào `LINGOLENS_GITHUB_CLIENT_ID` trong `ios/project.yml` (đã đặt: `Ov23lil3xPyWdLkIAPRj`). Phải **bỏ tick "Expire user access tokens"** (app điện thoại không có Client Secret để làm mới token).

Khi chưa có Client ID, app chỉ hiện cách nhập token thủ công.

### Cách không cần cài đặt gì
Toàn bộ phần đồng bộ là cách vòng cho việc cài bằng Apple ID miễn phí. Với tài khoản Apple Developer trả phí (hoặc phát hành lên App Store), widget dùng App Group và **tự cập nhật không cần làm gì**; mã trong dự án sẽ tự dùng đường đó.

## Bản 5: đủ thông tin, nền trắng, nhớ mã cho mọi widget
- **Từ đủ thông tin:** từ thêm tay hoặc từ Ghi chú (một từ đơn) tự điền **phiên âm, loại từ** và nghĩa (nếu bạn để trống) từ từ điển. Từ đã lưu trước đây thiếu phiên âm/loại từ được bổ sung một lần mỗi phiên. Widget và Sổ từ hiện đủ: từ, phiên âm, loại từ (tiếng Việt), nghĩa.
- **Sổ từ có "+ Thêm từ"** (từ hoặc cụm từ, nghĩa tuỳ chọn, nút **Lưu**).
- **Ghi chú:** nút đổi thành **Lưu**; không còn tự lưu khi gõ. Chỉ khi bấm Lưu mới thêm vào ghi chú và Sổ từ.
- **Nhập mã một lần:** mã đồng bộ (và danh sách dán) được widget nhớ cho **mọi** widget của LingoLens. Widget màn hình khoá không phải nhập lại. Dán mã mới vào bất kỳ widget nào sẽ thay mã cũ.
- **Giao diện:** widget màn hình chính nền **trắng**, chữ đậm dễ đọc. Widget màn hình khoá **không nền**, chỉ chữ (dòng, chữ nhật, tròn).

## Bản 6: bố cục widget, nút Thêm từ rộng, mũi tên nhanh
- **Widget:** phiên âm **cùng dòng** với từ tiếng Anh; nhãn loại từ **có màu theo loại** (danh từ xanh dương, động từ xanh lá, tính từ cam, trạng từ tím, đại từ hồng, giới từ xanh ngọc, liên từ vàng, thán từ đỏ, số từ lục lam, khác xám); **nghĩa ở dòng riêng**, chữ lớn, tự thu nhỏ để vừa widget thay vì bị cắt; widget màn hình khoá (chữ nhật) **căn trái**.
- **Sổ từ:** nút **Thêm từ** rộng hết màn hình, đặt ngay trên danh sách từ; form thêm từ mở ngay tại đó. Nhãn loại từ trong thẻ từ cũng có màu theo loại.
- **Mũi tên đổi từ nhanh hơn:** trước đây mỗi lần bấm, widget nạp lại và **gọi GitHub qua mạng** rồi mới đổi từ. Giờ sau khi bấm, widget dùng danh sách đã lưu tạm (không chờ mạng), và các lần nạp khác chỉ chờ mạng tối đa 6 giây khi đã có bản lưu tạm.

## Bản 7: chọn giao diện (theme) cho widget màn hình chính
- **Cách đổi:** giữ widget → **Chỉnh sửa widget** → **Giao diện**. Mỗi widget chọn riêng, đổi bất cứ lúc nào.
- **11 giao diện:** Trắng (mặc định), Tối, Xanh dương, Xanh lá, Hồng, Cam, Hoàng hôn, Đại dương, **Màu loang (cực quang)** (các vệt màu mờ trên nền tối), **Kính mờ sáng** và **Kính mờ tối**.
- **Chữ luôn tương phản cao:** nền sáng (Trắng, Kính mờ sáng) dùng chữ gần đen; mọi nền tối hoặc đậm màu dùng chữ trắng. Các nền màu đều được chọn đủ đậm để chữ trắng đọc rõ (màu loang còn phủ thêm lớp tối). Nhãn loại từ dùng sắc đậm: trên nền sáng là nhãn nền nhạt, trên nền tối là nhãn **nền trắng** chữ màu.
- **"Kính mờ" là bản mô phỏng:** dùng lớp phủ trắng/mờ, vệt màu nhoè và viền sáng, không phải hiệu ứng Liquid Glass thật của iOS 26 (hiệu ứng thật tuỳ theo nền màn hình nên không đảm bảo độ tương phản).
- Widget màn hình khoá vẫn **không nền**, không đổi theo giao diện (hệ thống tự đổi màu chữ).

## Bản 8: câu dài, nút trước/sau, bấm mở Sổ từ, thứ tự từ
- **Câu dài không bị cắt:** từ/câu xuống dòng đủ cả câu (thu nhỏ chữ nếu rất dài); app giữ tới 240 ký tự cho từ/câu và 300 cho nghĩa. Widget màn hình khoá (chữ nhật) cũng hiện tối đa 2 dòng.
- **Bố cục:** dòng 1 là từ/câu; **dòng 2 là phiên âm + thẻ loại từ** (và hai nút ‹ ›); dòng 3 là nghĩa.
- **Nút ‹ ›:** hình tròn **ngược màu nền** (nền sáng thì nút đen chữ trắng, nền tối thì nút trắng chữ đen) nên không bao giờ trùng màu. ‹ về từ trước, › sang từ kế tiếp.
- **Bấm vào widget → mở Sổ từ** trong app (`lingolens://vocab`, đăng ký trong Info.plist). Chạy cả khi app đang đóng.
- **Thứ tự từ:** *Cài đặt → Widget* chọn **Ngẫu nhiên** hoặc **Theo thứ tự** trong sổ từ (mới nhất trước); mỗi giờ chuyển một từ. Mỗi widget có thể đặt riêng ở *Chỉnh sửa widget → Thứ tự từ* (mặc định "Theo cài đặt trong app"). Cài đặt đi cùng danh sách từ lên GitHub nên widget biết ngay.
- Popup dịch trong Trình duyệt web: thêm icon **Sidebar** và icon **Lưu** cho cả từ lẫn câu/đoạn (câu được lưu như một cụm, nghĩa là bản dịch).

## Nguồn dịch
Không còn mục "Nguồn dịch" trong Cài đặt: chỉ dùng Google Dịch (web). (Công tắc nội bộ "device" chỉ còn để chạy kiểm thử mà không gửi gì tới Google.)

## Bản 9: nút ở hai góc dưới, giao diện chỉnh trong Cài đặt kèm bản xem trước
- Nút **‹** ở góc dưới bên trái, nút **›** ở góc dưới bên phải của widget.
- **Cài đặt → Widget:** chọn giao diện (11 kiểu) và xem trước ngay (cỡ nhỏ/vừa, từ ngắn/câu dài); chọn thứ tự từ. Giao diện được gửi cùng danh sách từ cho widget.
- Trong *Chỉnh sửa widget*, **Giao diện** có thêm lựa chọn **Theo cài đặt trong app** (mặc định cho widget mới). Widget đã tạo trước đó đang đặt cố định (ví dụ "Trắng") thì phải chọn lại "Theo cài đặt trong app" một lần để đi theo cài đặt trong app.

## Bản 10: màu phiên âm / thẻ loại từ khác chữ, tần suất đổi từ
- Trên nền tối: **phiên âm** có màu riêng (vàng nhạt; xanh ngọc nhạt trên nền cam/hoàng hôn) thay vì gần trắng; **thẻ loại từ** nền là sắc sáng của màu loại từ (không còn nền trắng) với chữ gần đen. Nhờ vậy phiên âm và thẻ luôn khác màu với từ và nghĩa (trắng), mà vẫn tương phản cao. Nền sáng: phiên âm xanh, thẻ nền nhạt chữ đậm, khác chữ đen của từ và nghĩa.
- **Tần suất đổi từ:** Cài đặt → Widget chọn 15 phút, 30 phút, 1 giờ (mặc định), 2, 3, 6, 12 giờ hoặc 1 ngày; mỗi widget có thể đặt riêng ở *Chỉnh sửa widget → Tần suất đổi từ* ("Theo cài đặt trong app" là mặc định). Widget tính sẵn các từ cho khoảng 2 ngày tới (tối đa 96 mốc) nên vẫn đổi đúng giờ dù iOS không làm mới widget; iOS có thể chậm vài phút ở tần suất ngắn.

## Bản 11: widget luôn theo cài đặt trong app, widget màn hình khoá cùng bố cục
- **Giao diện, tần suất, thứ tự từ không còn là tuỳ chọn riêng của từng widget** (đã bỏ khỏi *Chỉnh sửa widget*): mọi widget (màn hình chính và khoá) luôn theo *Cài đặt → Widget*. Đổi cài đặt là app gửi ngay cho widget (cùng đường với danh sách từ) và hiện kết quả ("Đã gửi cho widget" hoặc nhắc bật Tự cập nhật nếu chưa kết nối). Chỉ cần widget nhận được dữ liệu: với Apple ID miễn phí cần kết nối GitHub ("Bật tự cập nhật").
- **Widget màn hình khoá (chữ nhật):** cùng bố cục với widget màn hình chính (dòng 1 từ/câu; dòng 2 phiên âm + thẻ loại từ; dòng 3 nghĩa), chữ to hơn, không có nút ‹ ›. iOS **không cho widget màn hình khoá dùng màu tuỳ ý**: hệ thống tự nhuộm chữ theo hình nền. Phiên âm và thẻ loại từ được đánh dấu là "accent" nên hiện ở tông khác với từ và nghĩa; nền không có (ràng buộc của iOS).

## Bản 12: màu phiên âm và thẻ trên widget màn hình khoá
iOS **không cho widget màn hình khoá dùng màu tuỳ ý** (hệ thống chỉ giữ độ sáng rồi nhuộm theo hình nền). Cách gần nhất: phiên âm hiện nhạt hơn từ và nghĩa; thẻ loại từ là **viên thuốc đặc màu sáng, chữ đen** nên nổi hẳn lên. Khi iOS hiển thị đủ màu (ví dụ chế độ StandBy), phiên âm có màu vàng nhạt và thẻ có màu theo loại từ như widget màn hình chính.

## Bản 13: phản hồi nhanh hơn, ô giao diện đang chọn rõ hơn
- **Nút ‹ › phản hồi nhanh hơn:** ngay sau khi bấm, widget chỉ đọc bản danh sách đã lưu (bỏ bước dò App Group và bỏ mạng), và thứ tự theo ngày chỉ tính một lần cho mỗi ngày thay vì cho từng mốc (trước đây tính tới 96 lần). Phần còn lại là độ trễ của chính iOS khi chạy nút tương tác của widget (thường vài trăm mili giây đến khoảng một giây), app không rút ngắn được.
- **Chọn giao diện:** ô đang chọn phóng to nhẹ, có viền đậm màu nhấn, nền nhạt, chữ đậm và dấu ✓ ở góc; các ô khác mờ đi.
