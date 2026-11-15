# Dữ liệu từ điển & giấy phép

Giấy phép đã được kiểm tra **trước khi đóng gói**. Bản sao giấy phép nằm trong `dist/licenses/`.

| Nguồn | Dùng cho | Số lượng | Giấy phép | Loại |
|---|---|---|---|---|
| WordNet 3.1 (Princeton University), gói npm `wordnet-db@3.1.14` | Định nghĩa tiếng Anh, ví dụ, đồng nghĩa, trái nghĩa, nhãn slang/khẩu ngữ/cổ, cụm từ nhiều từ, từ loại | 117.791 synset, ~240.000 lemma | WordNet License (cho phép dùng/sao chép/phân phối, phải giữ thông báo bản quyền) | Dữ liệu đã công bố |
| CMU Pronouncing Dictionary, gói `cmu-pronouncing-dictionary@3.0.0` | Phát âm → IPA (giọng Mỹ) bằng quy tắc chuyển ARPAbet | 119.690 từ | BSD-2-Clause (dữ liệu), ISC (gói) | Dữ liệu đã công bố |
| **MangaLingo Starter EN–VI** (`data/starter/`) | Nghĩa tiếng Việt, cụm động từ, thành ngữ, slang, ghi chú cách dùng | 731 từ (761 nghĩa) + 215 cụm | CC0-1.0 | **Biên soạn thủ công, chưa kiểm duyệt chuyên môn** |
| Từ điển người dùng nhập | Bất kỳ | — | Theo nguồn người dùng | Người dùng |

## Phạm vi tiếng Việt — đọc kỹ

- Không có bộ dữ liệu Anh–Việt lớn với giấy phép rõ ràng nào có sẵn dưới dạng gói để đóng gói kèm. Vì vậy
  phiên bản này **không** có từ điển Anh–Việt đầy đủ.
- Bộ **Starter** được viết riêng cho dự án (không sao chép từ từ điển thương mại), tập trung vào từ thông dụng
  trong truyện/hội thoại, đại từ, giới từ, trợ động từ, dạng rút gọn, slang và thành ngữ phổ biến. Nó có thể có
  sai sót; mọi nghĩa từ bộ này đều được ghi nguồn “MangaLingo Starter (biên soạn thủ công)” trong giao diện.
- Từ nằm ngoài Starter **chỉ có định nghĩa tiếng Anh** từ WordNet. Giao diện hiển thị thông báo
  “Chưa có nghĩa tiếng Việt” — MangaLingo không tự dịch định nghĩa.
- Nghĩa ghép cho câu ghi rõ tỉ lệ từ/cụm có nghĩa tiếng Việt.

## Nhập thêm từ điển

Cài đặt → **Dữ liệu** → *Nhập từ điển (JSON / CSV)*. Dữ liệu lưu trong IndexedDB của tiện ích (không bị giới hạn
10 MB của `chrome.storage.local`). Nhập lại cùng **tên bộ dữ liệu** sẽ thay thế bộ cũ. Chỉ nhập dữ liệu bạn có
quyền sử dụng.

### CSV

Cần dòng tiêu đề; phân tách bằng dấu phẩy, chấm phẩy hoặc tab (tự nhận diện); hỗ trợ ngoặc kép theo RFC 4180.
Tên cột không phân biệt hoa thường và có bí danh:

| Cột | Bí danh | Ghi chú |
|---|---|---|
| `word` (bắt buộc) | headword, term, từ | ≤ 80 ký tự |
| `pos` | type, từ loại | n/noun/danh từ, v/verb, adj, adv, pron, prep, conj, interj, phrase… |
| `vi` | meaning, vietnamese, nghĩa | nhiều nghĩa ngăn bởi `;` hoặc `|` |
| `en` | definition | |
| `ipa` | pronunciation | |
| `example` | examples | nhiều ví dụ ngăn bởi `;` |
| `synonyms`, `antonyms` | | ngăn bởi `,` hoặc `;` |
| `tags` | | slang, informal, vulgar, idiom, phrasal, expression, abbr, contraction, archaic, formal |
| `note` | notes, ghi chú | |

Mỗi dòng cần `vi` hoặc `en`. Nhiều dòng cùng `word` được gộp thành nhiều nghĩa.

```csv
word,pos,vi,en,example,tags
shuriken,noun,phi tiêu ninja,a star-shaped throwing weapon,He threw a shuriken.,
nakama,noun,đồng đội; bạn bè thân thiết,,,slang
```

### JSON

Một mảng, hoặc `{ "entries": [...] }`, mỗi phần tử dùng cùng tên trường như CSV (mảng hoặc chuỗi):

```json
[{ "word": "kunai", "pos": "noun", "vi": ["dao kunai"], "examples": ["She threw a kunai."] }]
```

Giới hạn: 200.000 mục mỗi lần nhập, tệp ≤ 60 MB; mọi trường được kiểm tra kiểu, cắt độ dài và làm sạch.

## Sửa/bổ sung bộ Starter

Sửa `data/starter/words.txt` (`word|pos|nghĩa; nghĩa|tags|ghi chú`) hoặc `phrases.txt`
(`phrase|type|nghĩa|giải thích|ví dụ`), rồi chạy `npm run data && npm run build`. Script kiểm tra định dạng và
báo dòng sai.
