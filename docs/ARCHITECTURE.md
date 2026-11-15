# Kiến trúc

## Tổng quan

```
┌──────────────────────── Trang web (tab) ────────────────────────┐
│ content script (IIFE, isolated world)                            │
│  ├─ dom-reader      từ dưới con trỏ / vùng chọn / ngữ cảnh       │
│  ├─ actions         lookup, lưu từ, OCR target, sidebar          │
│  └─ <mangalingo-root> closed Shadow DOM                          │
│       ├─ FloatingPopup (React)                                   │
│       └─ OcrLayer: nút quét, tiến độ/hủy, bounding box, chọn vùng│
└──────────────┬───────────────────────────────────▲──────────────┘
   runtime.sendMessage (Request/Envelope)          │ tabs.sendMessage (TabEvent)
┌──────────────▼───────────────────────────────────┴──────────────┐
│ background service worker (ES module)                            │
│  ├─ router             kiểm tra & định tuyến tin nhắn            │
│  ├─ LookupService      word / phrase / sentence / paragraph      │
│  │    ├─ DictionaryEngine ← providers (User, CMUdict, Starter, WordNet)
│  │    └─ DictionaryModeTranslator (phrase matcher, tagger, grammar)
│  ├─ OcrService         cache → lấy điểm ảnh → offscreen → hậu xử lý
│  ├─ SidebarState       storage.session + broadcast tới side panel│
│  └─ context menus, commands, side panel behaviour                │
└──────────────┬──────────────────────────────────────────────────┘
               │ runtime.sendMessage {target:'offscreen'}
┌──────────────▼──────────────┐   ┌─────────────────────────────────┐
│ offscreen document          │   │ side panel / options (React)    │
│  crop · upscale · contrast  │   │  đọc settings/vocab trực tiếp từ │
│  Tesseract.js Worker (WASM) │   │  chrome.storage; lookup qua SW  │
└─────────────────────────────┘   └─────────────────────────────────┘
```

## Module (`src/`)

| Thư mục | Trách nhiệm |
|---|---|
| `background/` | Service worker: router, OCR orchestration, sidebar state, offscreen client, menus, commands. |
| `content/` | Content script: Shadow DOM host, cử chỉ đọc, hover OCR, nhận sự kiện từ background. |
| `ocr/` | Engine Tesseract (chạy trong offscreen), tiền xử lý ảnh thuần, hậu xử lý kết quả, registry ngôn ngữ. |
| `offscreen/` | Trang offscreen chứa Tesseract worker + giao thức tin nhắn. |
| `dictionary/` | `DictionaryProvider`, providers, `LexiconStore` (shard lười), engine, import JSON/CSV, ARPAbet→IPA. |
| `translation/` | `TranslationProvider`, Dictionary Mode, khớp cụm từ, giải thích ngữ cảnh, router chế độ tra cứu. |
| `language/` | Tokenizer, từ tại vị trí, tách câu, nhận diện ngôn ngữ, hình thái học, gán nhãn từ loại, ngữ pháp. |
| `popup/` | Floating popup + thuật toán định vị. |
| `sidepanel/` | Sidebar (Chrome Side Panel). |
| `options/` | Settings Center. |
| `storage/` | KV trên `chrome.storage.local`, settings, sổ từ, cache OCR, từ điển người dùng (IndexedDB). |
| `shared/` | Kiểu dữ liệu, schema cài đặt + kiểm tra, hợp đồng tin nhắn, CSV. |
| `ui/` | Design system: token, component, icon, các view kết quả dùng chung, hooks. |

## Luồng tra cứu

1. `dom-reader` lấy từ bằng `caretPositionFromPoint`, nối các text node trong cùng block (để `<b>Wha</b>tever`
   là một từ), rồi **hit-test** hình chữ nhật của từ với vị trí con trỏ — click vào khoảng trắng không chọn
   nhầm từ lân cận.
2. Content script gửi `{type:'lookup', req:{text, context}}`.
3. `LookupService`: nhận diện ngôn ngữ (từ chối văn bản không phải tiếng Anh), xác định chế độ.
4. **Từ**: `DictionaryEngine` chuẩn hóa → sinh ứng viên lemma (morphy + bảng bất quy tắc) → truy vấn song song
   mọi provider → gộp nghĩa → xếp hạng theo ngữ cảnh (từ loại theo bộ gán nhãn + Lesk rút gọn).
5. **Câu / đoạn**: tokenize → sinh ứng viên cụm từ → prefetch shard → gán nhãn từ loại → khớp cụm dài nhất →
   nghĩa từng cụm (VI, hoặc định nghĩa EN, hoặc “không có”) → ghép nghĩa có nhãn → phân tích ngữ pháp → ghi chú.

## Dữ liệu từ điển trong gói

`scripts/build-data.mjs` sinh `dist/data/`:

- `lex/<2 ký tự>.json` (753 shard): lemma → synset id theo từ loại, IPA, danh sách cụm từ chứa lemma.
- `syn/<n>.json` (461 bucket × 256 synset): từ loại, từ đồng nghĩa, định nghĩa, ví dụ, trái nghĩa, nhãn dùng.
- `starter.json`: dữ liệu Anh–Việt tự biên soạn; `meta.json`: số liệu + nguồn.

Shard được tải lười qua `fetch(chrome.runtime.getURL(...))` và giữ trong cache có giới hạn.

## OCR

Xem [OCR.md](OCR.md). Tóm tắt: content script cung cấp điểm ảnh (nếu ảnh cùng origin) hoặc URL + vị trí;
service worker tải ảnh gốc (không cookie) hoặc chụp vùng hiển thị (`captureVisibleTab`, UI tự ẩn khi chụp);
offscreen document cắt/phóng to/tăng tương phản và chạy Tesseract; kết quả được lọc theo độ tin cậy, gom dòng
thành bong bóng thoại và chuẩn hóa tọa độ 0..1 theo ảnh.

## Quyết định kỹ thuật

| Quyết định | Lý do |
|---|---|
| Tailwind 3.4, không dùng v4 | v4 dựa vào `@property`, bị bỏ qua trong Shadow DOM. |
| PostCSS rem → px | Nhiều trang đặt `html { font-size: 62.5% }`; rem trong Shadow DOM vẫn theo trang. |
| Shadow root `closed` + `all: initial` | Cách ly CSS hai chiều; trang không đọc được nội dung tra cứu/OCR. |
| 2 lượt build Vite | Content script tĩnh của MV3 không thể là ES module. |
| Offscreen document cho OCR | Trang không được tạo Worker từ URL `chrome-extension://`; service worker không có canvas. |
| Engine trong service worker | Một bộ cache cho mọi tab; dữ liệu chỉ tải một lần. |
| IndexedDB cho từ điển nhập | `chrome.storage.local` giới hạn 10 MB. |
| Không thêm thư viện state/UI | React + store nhỏ (`useSyncExternalStore`) là đủ. |

## Mở rộng

- **Nguồn từ điển mới**: cài đặt `DictionaryProvider` (`lookup`, tùy chọn `prefetch`/`peek`) và truyền vào
  `createDictionary(loader, extra)`. Engine và UI không cần thay đổi.
- **Provider dịch mới** (ví dụ mô hình dịch offline): cài đặt `TranslationProvider` và truyền vào `LookupService`.
- **Ngôn ngữ OCR mới**: thêm `<lang>.traineddata.gz` vào `vendor/tesseract/lang`, bật `bundled` trong
  `src/ocr/languages.ts`, thêm giá trị vào `RULES['ocr.language']`.
