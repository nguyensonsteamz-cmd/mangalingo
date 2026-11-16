# Bảo mật khoá API

## Ba thứ riêng biệt
| | OAuth token | Khoá API | Billing |
|---|---|---|---|
| Dùng để | thiết lập (tạo dự án, bật API, tạo khoá) | ký yêu cầu dịch (Cloud Translation Basic v2) | trả phí dịch |
| Lưu ở đâu | **chỉ bộ nhớ**, thu hồi khi xong | kho bảo mật của nền tảng | tài khoản Google của người dùng |
| Lingolens làm gì | dùng tạm | giữ trên thiết bị | chỉ **đọc** trạng thái, không liên kết/tạo |

## Lưu khoá theo nền tảng
| Nền tảng | Cách lưu | Ghi chú |
|---|---|---|
| Chrome | AES-256-GCM; khoá AES **non-extractable** trong IndexedDB; chỉ **bản mã** nằm ở `chrome.storage.local` (`secret:translate-api-key`) | Không đọc được từ tệp hồ sơ, script không export được khoá. Phần mềm độc hại chạy cùng quyền người dùng trên máy vẫn có thể nhờ trình duyệt giải mã: đây là giới hạn của extension, không phải Keychain/Keystore. |
| iPhone | **Keychain** (`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`) | Không vào bản sao lưu, không chuyển sang thiết bị khác. Không dùng `UserDefaults`. |
| Android | **Android Keystore** AES-256-GCM; bản mã trong SharedPreferences riêng của app | `allowBackup=false`. Không plaintext. |

* Chỉ **một** bí mật tồn tại (`translate-api-key`); lớp native từ chối tên khác.
* Khoá cũ lưu plaintext bởi bản trước được **tự chuyển** vào kho bảo mật rồi xoá bản rõ.
* Sau khi lưu, giao diện chỉ hiện `••••` + 4 ký tự cuối. Báo cáo xuất, trạng thái Smart Setup, snapshot, log và thông báo lỗi **không chứa khoá** (có kiểm thử).
* Khoá chỉ được gửi tới `translation.googleapis.com` (và khi kiểm tra). Không có backend Lingolens để gửi tới.

## Giới hạn quyền của khoá
Khoá do Smart Setup tạo có `restrictions.apiTargets = [translate.googleapis.com]`: chỉ gọi được Cloud Translation API. Nên thêm **application restriction** trong Console (Credentials → Edit API key) nếu phù hợp với cách dùng, đặt **Budget & alerts** và **API quotas** trên Google Cloud: đó là kiểm soát chi phí thật sự.

## Thu hồi
* *Ngắt kết nối*: xoá khoá khỏi thiết bị; tuỳ chọn xoá luôn khoá trên Google.
* *Thay khoá*: khoá mới được kiểm tra trước, khoá cũ chỉ bị xoá khi khoá mới đã hoạt động.
* Thu hồi quyền OAuth của Lingolens: https://myaccount.google.com/permissions (khoá API đã tạo vẫn tồn tại cho tới khi bạn xoá nó).

## Cloud Translation Advanced (v3)
v3 dùng **IAM (OAuth người dùng hoặc service account)**, không dùng khoá API. Smart Setup chỉ hỗ trợ **v2 (Basic)** và **không bao giờ tự chuyển sang v3**. Không dùng khoá tài khoản dịch vụ trong ứng dụng.

## Điều không được hứa
Giới hạn cục bộ (hạn mức, đồng ý, trần chi phí) và việc đếm ký tự là **ước tính trên thiết bị này**, không phải số liệu thanh toán của Google và **không đảm bảo không bao giờ bị tính phí** (ví dụ khoá dùng ở nơi khác, thanh toán chậm).
