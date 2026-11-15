/**
 * iPhone set-up guide (home screen): AssistiveTouch + Shortcuts → "Quét ảnh với LingoLens".
 * Every step is one action; the names of buttons / menus to tap are highlighted (<B>), the
 * important facts are bold (<K>). Sections can be folded; the first one is open.
 */
import { useState, type ReactNode } from 'react';
import { cx } from '@/ui/components';

/** Name of something on screen to tap (button, menu, setting) – glass chip in the selection colour. */
const B = ({ children }: { children: ReactNode }) => (
  <span className="ml-glass-select mx-0.5 inline-block whitespace-nowrap rounded-md border px-1.5 py-px align-baseline text-[12.5px] font-semibold leading-tight">{children}</span>
);
/** Important word / warning – bold, full-contrast text. */
const K = ({ children }: { children: ReactNode }) => <strong className="font-bold text-text">{children}</strong>;
/** Path of taps: A → B → C. */
const Path = ({ items }: { items: string[] }) => (
  <span className="inline-flex flex-wrap items-center gap-y-1">
    {items.map((x, i) => (
      <span key={x} className="inline-flex items-center">
        {i > 0 && <span className="mx-0.5 text-subtle">→</span>}
        <B>{x}</B>
      </span>
    ))}
  </span>
);
const Warn = ({ children }: { children: ReactNode }) => (
  <div className="mt-1.5 rounded-xl border border-warn/35 bg-warn/10 px-2.5 py-1.5 text-[12.5px] leading-snug text-text">⚠️ {children}</div>
);

interface Section {
  title: string;
  hint: string;
  steps: ReactNode[];
  extra?: ReactNode;
}

const SECTIONS: Section[] = [
  {
    title: 'Tạo phím tắt quét',
    hint: 'trong app Phím tắt',
    steps: [
      <>
        Mở app <B>Phím tắt</B> (biểu tượng hai hình vuông hồng – xanh). Không có thì tải lại từ <K>App Store</K>.
      </>,
      <>
        Ở tab <B>Phím tắt</B>, bấm dấu <B>+</B> ở góc trên bên phải.
      </>,
      <>
        Bấm <B>Thêm tác vụ</B>, gõ <K>chụp ảnh màn hình</K> vào ô tìm kiếm → chọn <B>Chụp ảnh màn hình</B>.
      </>,
      <>
        Bấm ô <B>Tìm kiếm tác vụ</B> ở đáy màn hình, gõ <K>LingoLens</K> → chọn <B>Quét ảnh với LingoLens</B>.
      </>,
      <>
        Bước mới tự nối với ảnh vừa chụp và hiện là <K>“Quét [Ảnh chụp màn hình] với LingoLens”</K> – không cần chọn gì thêm.
        <Warn>
          <K>Đừng bấm</K> vào nhãn “Ảnh chụp màn hình”: nó sẽ mở app Tệp. Không thấy tác vụ LingoLens? <K>Mở LingoLens một lần</K> rồi tìm lại.
        </Warn>
      </>,
      <>
        Bấm vào tên phím tắt ở trên cùng → <B>Đổi tên</B> → gõ <K>LingoLens: Quét</K> → bấm <B>Xong</B>.
      </>,
    ],
    extra: (
      <div className="ml-glass-field mt-2 rounded-2xl p-2.5 text-[12.5px]" data-ml-guide-sample="">
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-subtle">Phím tắt đúng trông như sau</div>
        <div className="ml-glass-card mb-1.5 rounded-xl px-2.5 py-1.5 font-semibold">📸 Chụp ảnh màn hình</div>
        <div className="ml-glass-card rounded-xl px-2.5 py-1.5 font-semibold">
          🔍 Quét <span className="ml-glass-select rounded-md border px-1.5 py-px">🖼 Ảnh chụp màn hình</span> với LingoLens
        </div>
      </div>
    ),
  },
  {
    title: 'Bật nút nổi',
    hint: 'AssistiveTouch',
    steps: [
      <>
        Mở <Path items={['Cài đặt', 'Trợ năng', 'Cảm ứng', 'AssistiveTouch']} />.
      </>,
      <>
        Bật công tắc <B>AssistiveTouch</B> – một <K>nút tròn mờ</K> hiện trên màn hình, kéo đi đâu cũng được.
      </>,
      <>
        Chỉnh <B>Độ mờ khi không dùng</B> khoảng <K>40%</K> để nút không che truyện.
      </>,
    ],
  },
  {
    title: 'Gán phím tắt cho nút nổi',
    hint: 'chạm hai lần',
    steps: [
      <>
        Vẫn trong trang AssistiveTouch, ở mục <B>Tác vụ tùy chỉnh</B> bấm <B>Chạm hai lần</B>.
      </>,
      <>
        Kéo xuống dưới cùng tới phần <K>Phím tắt</K> → chọn <B>LingoLens: Quét</B> (có dấu ✓).
      </>,
    ],
  },
  {
    title: 'Chạy thử lần đầu',
    hint: 'cho phép một lần',
    steps: [
      <>
        Mở một trang truyện, <K>chạm hai lần</K> vào nút nổi.
      </>,
      <>
        Nếu iPhone hỏi có cho phím tắt gửi ảnh tới LingoLens → chọn <B>Luôn cho phép</B>.
      </>,
      <>
        LingoLens mở ra với <K>ảnh vừa chụp</K> – vậy là xong!
      </>,
    ],
  },
  {
    title: 'Dùng hằng ngày',
    hint: 'quét bong bóng, câu, từ',
    steps: [
      <>
        Đang đọc truyện → <K>chạm hai lần vào nút nổi</K>.
      </>,
      <>
        <K>Kéo khung</K> vào bong bóng, câu hoặc từ; kéo <K>4 góc tròn</K> để đổi cỡ khung.
      </>,
      <>
        Bấm <B>Quét vùng này</B> (hoặc <B>Quét toàn màn hình</B> để quét mọi bong bóng).
      </>,
      <>
        <K>Chạm vào từng từ</K> để xem phiên âm và nghĩa; bấm 🔊 để nghe.
      </>,
    ],
  },
];

const PROBLEMS: [ReactNode, ReactNode][] = [
  [<>Chạm hai lần không có gì xảy ra</>, <>Mở app Phím tắt, bấm thử <B>LingoLens: Quét</B>. Chạy được → kiểm tra lại bước <K>Gán phím tắt</K>.</>],
  [<>LingoLens mở nhưng không có ảnh</>, <>Bước quét chưa nối với ảnh: xoá bước <B>Quét ảnh với LingoLens</B> và thêm lại ngay dưới <B>Chụp ảnh màn hình</B>.</>],
  [<>Bấm vào ô Ảnh thì mở app Tệp</>, <>Không bấm vào ô đó – chỉ cần xoá bước quét và thêm lại như trên.</>],
  [<>Báo “Nhà phát triển không được tin cậy”</>, <><Path items={['Cài đặt', 'Cài đặt chung', 'Quản lý VPN & Thiết bị']} /> → chọn Apple ID của bạn → <B>Tin cậy</B>.</>],
  [<>Sau 7 ngày app không mở được</>, <>Apple ID miễn phí chỉ cho chạy <K>7 ngày</K>: cài lại bằng Sideloadly, dữ liệu vẫn giữ nguyên.</>],
];

export function IosGuide() {
  const [open, setOpen] = useState(0);
  return (
    <div className="ml-glass-card rounded-[28px] p-4" data-ml-ios-setup="">
      <div className="text-[16px] font-bold">Thiết lập nút quét (một lần)</div>
      <div className="mt-0.5 text-[12.5px] leading-snug text-muted">
        iOS không cho ứng dụng tự hiện nút nổi, nên LingoLens dùng <K>nút AssistiveTouch</K> của iPhone: chạm hai lần → chụp màn hình → mở LingoLens để quét.
      </div>
      <div className="mt-3 space-y-2">
        {SECTIONS.map((s, i) => (
          <div key={s.title} className={cx('rounded-2xl border transition-colors', open === i ? 'border-[rgb(var(--ml-sel)/0.35)] bg-surface/40' : 'border-border/70')}>
            <button type="button" onClick={() => setOpen(open === i ? -1 : i)} className="ml-press flex w-full items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left" aria-expanded={open === i}>
              <span className="ml-btn-primary flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold">{s.title}</span>
                <span className="block text-[11.5px] text-subtle">{s.hint}</span>
              </span>
              <span className={cx('text-muted transition-transform duration-200', open === i && 'rotate-180')}>⌄</span>
            </button>
            {open === i && (
              <div className="ml-xfade-a px-3 pb-3">
                <ol className="space-y-2">
                  {s.steps.map((st, k) => (
                    <li key={k} className="flex gap-2 text-[13px] leading-relaxed text-muted">
                      <span className="mt-0.5 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-text/[0.07] px-1 text-[11px] font-bold text-text">{k + 1}</span>
                      <div className="min-w-0">{st}</div>
                    </li>
                  ))}
                </ol>
                {s.extra}
                {i === 0 && (
                  <a href="shortcuts://" className="ml-press ml-btn-primary ml-ripple mt-3 inline-block rounded-full px-4 py-1.5 text-[13px] font-semibold">
                    Mở app Phím tắt
                  </a>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <details className="group mt-3 rounded-2xl border border-border/70 px-3 py-2">
        <summary className="cursor-pointer list-none text-[13.5px] font-semibold">
          🛠 Gặp lỗi? <span className="text-[12px] font-normal text-subtle">(bấm để xem)</span>
        </summary>
        <ul className="mt-2 space-y-2">
          {PROBLEMS.map(([q, a], k) => (
            <li key={k} className="text-[12.5px] leading-relaxed">
              <div className="font-semibold text-text">{q}</div>
              <div className="text-muted">{a}</div>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
