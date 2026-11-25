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
