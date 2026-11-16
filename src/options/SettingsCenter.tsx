/** Settings Center: every option is validated, saved to chrome.storage.local and applied live. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LOGOS, LogoMark } from '@/ui/logos';
import { send, type DictStats } from '@/shared/messages';
import { DEFAULT_SETTINGS, normalizeHost, type DeepPartial, type Settings } from '@/shared/settings';
import { OCR_LANGUAGES } from '@/ocr/languages';
import { useSettings } from '@/ui/hooks';
import { MtStatus } from '@/ui/MtStatus';
import { SettingsPreview } from './SettingsPreview';
import { Badge, Button, Field, GlassIndicator, Notice, Segmented, Select, Slider, Toggle, cx, fastTap } from '@/ui/components';
import { IconLogo, IconTrash, IconUpload } from '@/ui/icons';
import { VocabManager } from '@/ui/VocabManager';
import { chromeLocal } from '@/storage/kv';
import { OcrCache } from '@/storage/ocr-cache';

type Update = (p: DeepPartial<Settings>) => void;

const SECTIONS = [
  { id: 'appearance', label: 'Giao diện' },
  { id: 'popup', label: 'Floating Popup' },
  { id: 'sidebar', label: 'Sidebar' },
  { id: 'typography', label: 'Chữ' },
  { id: 'dictionary', label: 'Từ điển' },
  { id: 'reading', label: 'Hành vi đọc' },
  { id: 'ocr', label: 'OCR' },
  { id: 'shortcuts', label: 'Phím tắt' },
  { id: 'vocab', label: 'Sổ từ vựng' },
  { id: 'data', label: 'Dữ liệu' },
  { id: 'about', label: 'Giới thiệu & quyền riêng tư' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

const ACCENTS = ['#7c9cff', '#5cc78c', '#e8b356', '#f06c6c', '#b48cff', '#4cc3d9', '#f08ccf', '#a0a7b6'];

/** `hidden`: sections that do not apply to the host (e.g. keyboard shortcuts in the Android app). */
export function SettingsCenter({ hidden = [], topBar }: { hidden?: string[]; topBar?: ReactNode } = {}) {
  const { settings: s, update, reset, loaded, saveState } = useSettings('page');
  const initial = (decodeURIComponent(location.hash.slice(1)) as SectionId) || 'appearance';
  const [section, setSection] = useState<SectionId>(SECTIONS.some((x) => x.id === initial) ? initial : 'appearance');

  useEffect(() => {
    const on = () => {
      const h = decodeURIComponent(location.hash.slice(1)) as SectionId;
      if (SECTIONS.some((x) => x.id === h)) setSection(h);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  return (
    <div className={cx('mx-auto flex min-h-screen flex-col md:flex-row', PREVIEW_SECTIONS.includes(section) ? 'max-w-7xl' : 'max-w-5xl')}>
      <nav className="ml-glass-bar sticky top-0 z-10 shrink-0 border-b px-4 py-4 md:h-screen md:w-60 md:border-b-0 md:border-r">
        {topBar ? (
          <div className="-mx-4 -mt-4 mb-3">{topBar}</div>
        ) : (
          <div className="mb-4 flex items-center gap-2">
            <IconLogo size={26} />
            <div>
              <div className="text-[15px] font-semibold text-text">LingoLens</div>
              <div className="text-[11.5px] text-subtle">Settings Center</div>
            </div>
          </div>
        )}
        <ul className="relative flex gap-1 overflow-x-auto md:flex-col">
          <GlassIndicator activeKey={section} className="rounded-full md:rounded-xl" />
          {SECTIONS.filter((x) => !hidden.includes(x.id)).map((x) => (
            <li key={x.id}>
              <button
                type="button"
                {...fastTap(() => {
                  setSection(x.id);
                  // in the phone app the hash names the TAB (#settings) – keep it, so a reload stays here
                  if (!document.documentElement.dataset.app) history.replaceState(null, '', `#${x.id}`);
                })}
                data-ml-active={section === x.id}
                className={cx('ml-focus ml-press relative z-[1] w-full whitespace-nowrap rounded-full px-3 py-1.5 text-left text-[13px] md:rounded-xl', section === x.id ? 'ml-sel-text border border-transparent font-semibold' : 'border border-transparent text-muted hover:bg-text/[0.05] hover:text-text')}
              >
                {x.label}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-4 hidden text-[11.5px] text-subtle md:block">
          {saveState === 'saving' ? 'Đang lưu…' : saveState === 'saved' ? 'Đã lưu · áp dụng ngay' : saveState === 'error' ? 'Lỗi khi lưu' : 'Mọi thay đổi được lưu tự động'}
        </div>
      </nav>
      <main className="min-w-0 flex-1 px-5 py-6 md:px-8">
        {!loaded ? null : (
          <div className={cx(PREVIEW_SECTIONS.includes(section) && 'grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]')}>
          {PREVIEW_SECTIONS.includes(section) && (
            <aside className="xl:order-2">
              <div className="xl:sticky xl:top-6">
                <SettingsPreview s={s} kind={section === 'ocr' ? 'ocr' : section === 'sidebar' ? 'sidebar' : 'popup'} />
              </div>
            </aside>
          )}
          <div className="min-w-0 xl:order-1">
            {section === 'appearance' && <Appearance s={s} update={update} />}
            {section === 'popup' && <PopupSettings s={s} update={update} />}
            {section === 'sidebar' && <SidebarSettings s={s} update={update} />}
            {section === 'typography' && <Typography s={s} update={update} />}
            {section === 'dictionary' && <DictionarySettings s={s} update={update} />}
            {section === 'reading' && <Reading s={s} update={update} />}
            {section === 'ocr' && <OcrSettings s={s} update={update} />}
            {section === 'shortcuts' && <Shortcuts s={s} update={update} />}
            {section === 'vocab' && (
              <Page title="Sổ từ vựng" desc="Lưu trong chrome.storage.local trên máy này. Xuất ra JSON/CSV để sao lưu.">
                <VocabManager />
              </Page>
            )}
            {section === 'data' && <DataSettings reset={reset} />}
            {section === 'about' && <About />}
          </div>
          </div>
        )}
      </main>
    </div>
  );
}

/** Sections whose settings change how things look: shown with a live preview next to them. */
const PREVIEW_SECTIONS: string[] = ['appearance', 'popup', 'sidebar', 'typography', 'ocr', 'dictionary'];

function Page({ title, desc, children, onReset }: { title: string; desc?: string; children: ReactNode; onReset?: () => void }) {
  return (
    <section>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-text">{title}</h1>
          {desc && <p className="mt-1 text-[13px] text-muted">{desc}</p>}
        </div>
        {onReset && (
          <Button size="sm" variant="ghost" onClick={onReset}>
            Đặt lại mục này
          </Button>
        )}
      </div>
      <div className="ml-glass-card divide-y divide-border/60 rounded-[20px] px-4">{children}</div>
    </section>
  );
}

const BOX_COLORS = ['#f97316', '#ef4444', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899'];
const SIDEBAR_COLORS = ['#f8fafc', '#fffbeb', '#f0f9ff', '#f0fdf4', '#0f172a', '#111827', '#1e1b4b', '#18181b'];
const SELECT_COLORS = ['#3451d1', '#7c9cff', '#8b5cf6', '#ec4899', '#f97316', '#10b981', '#06b6d4', '#64748b'];
const POPUP_COLORS = ['#ffffff', '#fffbeb', '#f0f9ff', '#f0fdf4', '#fdf2f8', '#1e293b', '#111827', '#3b0764'];

/** Swatches + native colour picker + hex input. `emptyLabel` adds a "default" choice (value ''). */
function ColorField({ value, onChange, swatches, emptyLabel }: { value: string; onChange: (v: string) => void; swatches: string[]; emptyLabel?: string }) {
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  const valid = hex === '' ? !!emptyLabel : /^#[0-9a-fA-F]{6}$/.test(hex);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {emptyLabel && (
        <button
          type="button"
          onClick={() => onChange('')}
          className={cx('ml-focus ml-press h-7 rounded-full border px-2.5 text-[12px]', value === '' ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted hover:text-text')}
        >
          {emptyLabel}
        </button>
      )}
      {swatches.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={c}
          title={c}
          onClick={() => onChange(c)}
          className={cx('ml-focus h-6 w-6 rounded-full border border-border ring-2 ring-offset-2 ring-offset-surface', value === c ? 'ring-text' : 'ring-transparent')}
          style={{ background: c }}
        />
      ))}
      <input
        type="color"
        value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#ffffff'}
        onChange={(e) => onChange(e.target.value.toLowerCase())}
        className="ml-focus ml-glass-field h-7 w-9 cursor-pointer rounded-lg p-0.5"
        aria-label="Chọn màu"
      />
      <input
        value={hex}
        placeholder={emptyLabel ? 'mặc định' : '#rrggbb'}
        onChange={(e) => {
          setHex(e.target.value);
          if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(e.target.value.toLowerCase());
          else if (e.target.value === '' && emptyLabel) onChange('');
        }}
        className={cx('ml-focus ml-glass-field h-7 w-24 rounded-lg px-2 font-mono text-[12px] text-text', !valid && '!border-danger')}
        aria-label="Mã màu hex"
      />
    </div>
  );
}

function Appearance({ s, update }: { s: Settings; update: Update }) {
  const [custom, setCustom] = useState(s.appearance.accent);
  useEffect(() => setCustom(s.appearance.accent), [s.appearance.accent]);
  const valid = /^#[0-9a-fA-F]{6}$/.test(custom);
  return (
    <Page title="Giao diện" onReset={() => update({ appearance: DEFAULT_SETTINGS.appearance })}>
      <Field stacked label="Logo" description="Dùng trong ứng dụng, làm biểu tượng app trên điện thoại và biểu tượng tiện ích trên Chrome.">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" data-ml-logo-picker="">
          {LOGOS.map((l) => (
            <button
              key={l.id}
              type="button"
              aria-pressed={s.appearance.logo === l.id}
              onClick={() => update({ appearance: { logo: l.id } })}
              className={cx('ml-focus ml-press flex flex-col items-center gap-1.5 rounded-[18px] border-2 p-2.5', s.appearance.logo === l.id ? 'ml-glass-select' : 'border-transparent bg-text/[0.04] hover:border-accent/40')}
            >
              <LogoMark id={l.id} size={48} />
              <span className="text-[12px] font-medium text-text">{l.name}</span>
            </button>
          ))}
        </div>
      </Field>
      <Field stacked label="Nền ứng dụng" description="Nền phía sau Sidebar, trang Cài đặt, popup trên thanh công cụ và ứng dụng điện thoại. Rực rỡ làm các khung kính nổi bật nhất.">
        <Segmented value={s.appearance.background} onChange={(v) => update({ appearance: { background: v } })} options={[{ value: 'ambient', label: 'Ánh sáng dịu' }, { value: 'vivid', label: 'Rực rỡ' }, { value: 'plain', label: 'Trơn' }]} />
      </Field>
      <Field stacked label="Màu hiệu ứng chọn" description="Màu của viên kính đánh dấu mục đang chọn: tab, nút lựa chọn, trang đang mở. “Theo màu nhấn” dùng màu nhấn của giao diện.">
        <ColorField value={s.appearance.selectColor} onChange={(v) => update({ appearance: { selectColor: v } })} swatches={SELECT_COLORS} emptyLabel="Theo màu nhấn" />
      </Field>
      <Toggle
        label="Hiệu ứng kính (Liquid Glass)"
        description="Popup, Sidebar và thẻ nội dung trong suốt, làm mờ nền phía sau. Tắt nếu muốn nền đặc hoặc máy chạy chậm."
        checked={s.appearance.glass}
        onChange={(v) => update({ appearance: { glass: v } })}
      />
      <Field label="Cỡ giao diện ứng dụng" description="Cỡ chữ và nút trong ứng dụng trên điện thoại.">
        <Segmented value={s.appearance.uiScale} onChange={(v) => update({ appearance: { uiScale: v } })} options={[{ value: 'small', label: 'Nhỏ' }, { value: 'medium', label: 'Vừa' }, { value: 'large', label: 'Lớn' }]} />
      </Field>
      <Field label="Chủ đề" description="System sẽ theo cài đặt sáng/tối của hệ điều hành.">
        <Segmented value={s.appearance.theme} onChange={(v) => update({ appearance: { theme: v } })} options={[{ value: 'dark', label: 'Tối' }, { value: 'light', label: 'Sáng' }, { value: 'system', label: 'System' }]} />
      </Field>
      <Field label="Màu nhấn (accent)">
        <div className="flex flex-wrap items-center gap-1.5">
          {ACCENTS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => update({ appearance: { accent: c } })}
              className={cx('ml-focus h-6 w-6 rounded-full ring-2 ring-offset-2 ring-offset-surface', s.appearance.accent === c ? 'ring-text' : 'ring-transparent')}
              style={{ background: c }}
            />
          ))}
          <input
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value);
              if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) update({ appearance: { accent: e.target.value } });
            }}
            className={cx('ml-focus ml-glass-field h-7 w-24 rounded-lg px-2 font-mono text-[12px] text-text', !valid && '!border-danger')}
            aria-label="Mã màu hex"
          />
        </div>
      </Field>
    </Page>
  );
}

function PopupSettings({ s, update }: { s: Settings; update: Update }) {
  const p = s.popup;
  return (
    <Page title="Floating Popup" desc="Popup hiển thị gần từ/câu đang đọc." onReset={() => update({ popup: DEFAULT_SETTINGS.popup })}>
      <Toggle label="Bật popup" description="Khi tắt, kết quả tra cứu được gửi sang Sidebar." checked={p.enabled} onChange={(v) => update({ popup: { enabled: v } })} />
      <Field label="Chiều rộng">
        <Slider value={p.width} min={300} max={600} step={10} onChange={(v) => update({ popup: { width: v } })} format={(v) => `${v}px`} />
      </Field>
      <Field label="Cỡ chữ" description="0 = theo mục Chữ.">
        <Slider value={p.fontSize} min={0} max={22} onChange={(v) => update({ popup: { fontSize: v === 0 ? 0 : Math.max(11, v) } })} format={(v) => (v ? `${v}px` : 'auto')} />
      </Field>
      <Field stacked label="Chất liệu popup" description="Liquid Glass: kính mờ có màu theo chủ đề. Kính trong: kính trắng trong suốt như logo “Kính trong”, nhìn xuyên thấy trang phía sau. Nền đặc: không trong suốt. Kính trong dễ đọc nhất trên trang sáng; trên trang tối nên chọn Màu popup: Tối.">
        <Segmented value={p.material} onChange={(v) => update({ popup: { material: v } })} options={[{ value: 'glass', label: 'Liquid Glass' }, { value: 'clear', label: 'Kính trong' }, { value: 'solid', label: 'Nền đặc' }]} />
      </Field>
      {p.material !== 'solid' && (
        <Field label="Độ đục của kính" description="Kéo sang trái để popup trong hơn. 0 = tự động theo chất liệu (Liquid Glass 72%, Kính trong 12%).">
          <Slider value={p.glassAlpha} min={0} max={0.95} step={0.01} onChange={(v) => update({ popup: { glassAlpha: v === 0 ? 0 : Math.max(0.05, v) } })} format={(v) => (v ? `${Math.round(v * 100)}%` : 'tự động')} />
        </Field>
      )}
      <Field label="Màu popup" description="Popup trên trang web. Sáng dễ đọc hơn trên trang manga.">
        <Segmented value={p.theme} onChange={(v) => update({ popup: { theme: v } })} options={[{ value: 'light', label: 'Sáng' }, { value: 'dark', label: 'Tối' }, { value: 'follow', label: 'Theo giao diện' }]} />
      </Field>
      <Field stacked label="Màu nền popup" description="Chọn màu bất kỳ; màu chữ tự đổi sáng/tối để luôn dễ đọc. “Theo chủ đề” dùng màu của mục Màu popup.">
        <ColorField value={p.background} onChange={(v) => update({ popup: { background: v } })} swatches={POPUP_COLORS} emptyLabel="Theo chủ đề" />
      </Field>
      <Field label="Vị trí ưu tiên">
        <Segmented value={p.position} onChange={(v) => update({ popup: { position: v } })} options={[{ value: 'auto', label: 'Tự động' }, { value: 'below', label: 'Dưới' }, { value: 'above', label: 'Trên' }]} />
      </Field>
      <Field label="Độ trong suốt">
        <Slider value={p.opacity} min={0.7} max={1} step={0.01} onChange={(v) => update({ popup: { opacity: v } })} format={(v) => `${Math.round(v * 100)}%`} />
      </Field>
      <Toggle label="Hiệu ứng chuyển động" checked={p.animation} onChange={(v) => update({ popup: { animation: v } })} />
      <Field label="Tự đóng">
        <Select
          value={p.autoClose}
          onChange={(v) => update({ popup: { autoClose: v } })}
          options={[
            { value: 'off', label: 'Không (Esc / click ra ngoài)' },
            { value: 'scroll', label: 'Khi cuộn trang' },
            { value: 'leave', label: 'Khi rời chuột khỏi popup' },
            { value: 'timer', label: 'Sau một khoảng thời gian' },
          ]}
        />
      </Field>
      {p.autoClose === 'timer' && (
        <Field label="Thời gian tự đóng">
          <Slider value={p.autoCloseSeconds} min={2} max={60} onChange={(v) => update({ popup: { autoCloseSeconds: v } })} format={(v) => `${v}s`} />
        </Field>
      )}
      <div className="py-2.5">
        <div className="mb-1 text-[13px] font-medium text-text">Các tab hiển thị</div>
        <div className="grid grid-cols-2 gap-x-6">
          {(
            [
              ['meaning', 'Nghĩa / Dịch'],
              ['context', 'Ngữ cảnh'],
              ['examples', 'Ví dụ / Từ vựng'],
              ['grammar', 'Ngữ pháp'],
            ] as const
          ).map(([k, label]) => (
            <Toggle key={k} label={label} checked={p.sections[k]} onChange={(v) => update({ popup: { sections: { [k]: v } } })} />
          ))}
        </div>
      </div>
    </Page>
  );
}

function SidebarSettings({ s, update }: { s: Settings; update: Update }) {
  const b = s.sidebar;
  return (
    <Page title="Sidebar" desc="Chrome Side Panel. Bấm biểu tượng LingoLens trên thanh công cụ để mở." onReset={() => update({ sidebar: DEFAULT_SETTINGS.sidebar })}>
      <Toggle label="Bật Sidebar" description="Khi tắt, bấm biểu tượng tiện ích sẽ mở trang Cài đặt." checked={b.enabled} onChange={(v) => update({ sidebar: { enabled: v } })} />
      <Field label="Màu Sidebar" description="“Theo giao diện” dùng chủ đề trong mục Giao diện.">
        <Segmented value={b.theme} onChange={(v) => update({ sidebar: { theme: v } })} options={[{ value: 'follow', label: 'Theo giao diện' }, { value: 'light', label: 'Sáng' }, { value: 'dark', label: 'Tối' }]} />
      </Field>
      <Field stacked label="Màu nền Sidebar" description="Chọn màu bất kỳ; màu chữ, thẻ và viền tự điều chỉnh để luôn dễ đọc.">
        <ColorField value={b.background} onChange={(v) => update({ sidebar: { background: v } })} swatches={SIDEBAR_COLORS} emptyLabel="Theo chủ đề" />
      </Field>
      <Field label="Trạng thái mặc định khi mở">
        <Segmented value={b.defaultState} onChange={(v) => update({ sidebar: { defaultState: v } })} options={[{ value: 'expanded', label: 'Đầy đủ' }, { value: 'compact', label: 'Thu gọn' }]} />
      </Field>
      <Field label="Độ rộng nội dung" description="Chrome không cho tiện ích đặt độ rộng khung Side Panel; kéo mép panel để đổi kích thước khung. Tùy chọn này giới hạn độ rộng nội dung bên trong.">
        <Segmented value={b.width} onChange={(v) => update({ sidebar: { width: v } })} options={[{ value: 'full', label: 'Toàn bộ' }, { value: 'comfortable', label: 'Vừa' }, { value: 'narrow', label: 'Hẹp' }]} />
      </Field>
      <Field label="Cỡ chữ" description="0 = theo mục Chữ.">
        <Slider value={b.fontSize} min={0} max={22} onChange={(v) => update({ sidebar: { fontSize: v === 0 ? 0 : Math.max(11, v) } })} format={(v) => (v ? `${v}px` : 'auto')} />
      </Field>
      <Field label="Tab mặc định">
        <Select
          value={b.defaultTab}
          onChange={(v) => update({ sidebar: { defaultTab: v } })}
          options={[
            { value: 'translation', label: 'Dịch' },
            { value: 'vocabulary', label: 'Từ vựng' },
            { value: 'grammar', label: 'Ngữ pháp' },
            { value: 'context', label: 'Ngữ cảnh' },
            { value: 'saved', label: 'Đã lưu' },
          ]}
        />
      </Field>
    </Page>
  );
}

function Typography({ s, update }: { s: Settings; update: Update }) {
  const t = s.typography;
  return (
    <Page title="Chữ" desc="Áp dụng cho popup, sidebar và trang này." onReset={() => update({ typography: DEFAULT_SETTINGS.typography })}>
      <Field label="Font chữ" description="Chỉ dùng font có sẵn trên máy (không tải font từ Internet).">
        <Select
          value={t.fontFamily}
          onChange={(v) => update({ typography: { fontFamily: v } })}
          options={[
            { value: 'system', label: 'Hệ thống' },
            { value: 'sans', label: 'Sans (Inter / Segoe)' },
            { value: 'serif', label: 'Serif (Georgia)' },
            { value: 'readable', label: 'Dễ đọc (Verdana)' },
            { value: 'mono', label: 'Monospace' },
          ]}
        />
      </Field>
      <Field label="Cỡ chữ">
        <Slider value={t.fontSize} min={11} max={22} onChange={(v) => update({ typography: { fontSize: v } })} format={(v) => `${v}px`} />
      </Field>
      <Field label="Giãn dòng">
        <Slider value={t.lineHeight} min={1.1} max={2.2} step={0.05} onChange={(v) => update({ typography: { lineHeight: v } })} format={(v) => v.toFixed(2)} />
      </Field>
      <Field label="Giãn cách từ">
        <Slider value={t.wordSpacing} min={0} max={8} step={0.5} onChange={(v) => update({ typography: { wordSpacing: v } })} format={(v) => `${v}px`} />
      </Field>
      <Field label="Cỡ chữ nghĩa tiếng Việt">
        <Slider value={t.translationSize} min={11} max={26} onChange={(v) => update({ typography: { translationSize: v } })} format={(v) => `${v}px`} />
      </Field>
      <div className="py-3">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-subtle">Xem trước</div>
        <div className="text-text">“I'm gonna give up on this dream…”</div>
        <div className="ml-tr text-muted">tôi sẽ bỏ cuộc giấc mơ này…</div>
      </div>
    </Page>
  );
}

function DictionarySettings({ s, update }: { s: Settings; update: Update }) {
  const d = s.dictionary;
  const items: [keyof Settings['dictionary'], string, string?][] = [
    ['showIpa', 'Hiện phiên âm IPA', 'IPA giọng Mỹ, chuyển đổi từ CMU Pronouncing Dictionary.'],
    ['showPronunciation', 'Hiện nút phát âm', 'Dùng giọng đọc tiếng Anh tốt nhất có sẵn trên máy.'],
    ['showPos', 'Hiện từ loại'],
    ['showEnglishDefinition', 'Hiện định nghĩa tiếng Anh (WordNet)'],
    ['showExamples', 'Hiện ví dụ'],
    ['showSynonyms', 'Hiện từ đồng nghĩa'],
    ['showAntonyms', 'Hiện từ trái nghĩa'],
    ['showCollocations', 'Hiện collocations / từ ghép'],
  ];
  return (
    <Page title="Từ điển" onReset={() => update({ dictionary: DEFAULT_SETTINGS.dictionary })}>
      {items.map(([k, label, desc]) => (
        <Toggle key={k} label={label} description={desc} checked={d[k]} onChange={(v) => update({ dictionary: { [k]: v } })} />
      ))}
      <Field label="Tốc độ giọng đọc" description="Phát âm từ và đọc cả câu. 1× = bình thường.">
        <Slider value={s.reading.speechRate} min={0.5} max={1.5} step={0.05} onChange={(v) => update({ reading: { speechRate: v } })} format={(v) => `${v.toFixed(2).replace(/0$/, '')}×`} />
      </Field>
    </Page>
  );
}

function Reading({ s, update }: { s: Settings; update: Update }) {
  const r = s.reading;
  const [host, setHost] = useState('');
  const [err, setErr] = useState('');
  const add = () => {
    const h = normalizeHost(host);
    if (!h) return setErr('Tên miền không hợp lệ (ví dụ: example.com).');
    setErr('');
    setHost('');
    update({ general: { sites: [...new Set([...s.general.sites, h])] } });
  };
  return (
    <Page title="Hành vi đọc" onReset={() => update({ reading: DEFAULT_SETTINGS.reading })}>
      <Toggle
        label="Tạm dừng trên mọi trang"
        description="Tắt tạm thời LingoLens trên tất cả các trang đã bật (danh sách bên dưới được giữ nguyên)."
        checked={!s.general.enabled}
        onChange={(v) => update({ general: { enabled: !v } })}
      />
      <Toggle label="Click để tra từ" description="Click vào một từ tiếng Anh để tra. Không áp dụng cho liên kết, nút bấm và ô nhập liệu." checked={r.clickLookup} onChange={(v) => update({ reading: { clickLookup: v } })} />
      <Field label="Phím kèm khi click" description="Yêu cầu giữ phím này khi click để tránh mở popup ngoài ý muốn.">
        <Segmented value={r.clickModifier} onChange={(v) => update({ reading: { clickModifier: v } })} options={[{ value: 'none', label: 'Không' }, { value: 'alt', label: 'Alt' }, { value: 'ctrl', label: 'Ctrl' }, { value: 'shift', label: 'Shift' }]} />
      </Field>
      <Toggle label="Bôi đen để tra" description="Bôi đen từ, câu hoặc đoạn văn để tra cứu." checked={r.selectLookup} onChange={(v) => update({ reading: { selectLookup: v } })} />
      <Toggle label="Tự động mở popup khi bôi đen" description="Khi tắt, chỉ hiện một nút nhỏ cạnh vùng chọn; bấm nút để tra." checked={r.autoPopup} onChange={(v) => update({ reading: { autoPopup: v } })} />
      <Toggle label="Tự nhận diện ngôn ngữ" description="Nhận diện cục bộ (chữ viết + từ phổ biến). Văn bản không phải tiếng Anh sẽ không bị dịch sai." checked={r.autoDetectLanguage} onChange={(v) => update({ reading: { autoDetectLanguage: v } })} />
      <Field
        label="Chế độ dịch"
        description="Dịch máy: câu tự nhiên Anh → Việt bằng Translator API có sẵn trong Chrome 138+ — lần đầu Chrome tải mô hình dịch từ Google, sau đó dịch hoàn toàn trên máy, văn bản không được gửi đi. Nghĩa từ điển vẫn hiện bên dưới để đối chiếu. Chỉ từ điển: không dùng dịch máy."
      >
        <Segmented value={r.translationMode} onChange={(v) => update({ reading: { translationMode: v } })} options={[{ value: 'machine', label: 'Dịch máy (Chrome)' }, { value: 'dictionary', label: 'Chỉ từ điển' }]} />
      </Field>
      {r.translationMode === 'machine' && <MtStatus />}
      <Field label="Ngôn ngữ đích" description="Dữ liệu hiện có: tiếng Việt (bộ Starter + từ điển bạn nhập) và định nghĩa tiếng Anh.">
        <Segmented value={r.targetLanguage} onChange={(v) => update({ reading: { targetLanguage: v } })} options={[{ value: 'vi', label: 'Tiếng Việt' }, { value: 'en', label: 'English (định nghĩa)' }]} />
      </Field>
      <div className="py-2.5">
        <div className="text-[13px] font-medium text-text">Website đang bật LingoLens</div>
        <div className="mt-0.5 text-[12px] text-muted">LingoLens mặc định tắt và chỉ hoạt động trên các tên miền này (gồm tên miền con). Bật nhanh: biểu tượng LingoLens → “Bật trên trang này”.</div>
        <div className="mt-2 flex gap-1.5">
          <input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="example.com"
            className="ml-focus h-8 w-60 rounded-lg border border-border bg-elevated px-2.5 text-[13px] text-text placeholder:text-subtle"
          />
          <Button size="sm" onClick={add}>
            Thêm
          </Button>
        </div>
        {err && <div className="mt-1 text-[12px] text-danger">{err}</div>}
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {s.general.sites.map((h) => (
            <li key={h} className="inline-flex items-center gap-1 rounded-md bg-elevated px-2 py-0.5 text-[12.5px] text-text ring-1 ring-border">
              {h}
              <button type="button" aria-label={`Tắt trên ${h}`} className="text-subtle hover:text-danger" onClick={() => update({ general: { sites: s.general.sites.filter((x) => x !== h) } })}>
                ×
              </button>
            </li>
          ))}
          {!s.general.sites.length && <li className="text-[12px] text-subtle">Chưa bật trên website nào.</li>}
        </ul>
      </div>
    </Page>
  );
}

function OcrSettings({ s, update }: { s: Settings; update: Update }) {
  const o = s.ocr;
  return (
    <Page title="OCR" desc="Tesseract.js chạy cục bộ trong trình duyệt. Ảnh không được gửi đi đâu." onReset={() => update({ ocr: DEFAULT_SETTINGS.ocr })}>
      <Toggle label="Bật OCR" checked={o.enabled} onChange={(v) => update({ ocr: { enabled: v } })} />
      <Field label="Ngôn ngữ OCR" description="Chỉ tiếng Anh (chữ ngang) được đóng gói trong bản này.">
        <Select value={o.language} onChange={(v) => update({ ocr: { language: v } })} options={OCR_LANGUAGES.filter((l) => l.bundled).map((l) => ({ value: l.code as 'eng', label: l.name }))} />
      </Field>
      <Field label="Cách kích hoạt">
        <Segmented value={o.trigger} onChange={(v) => update({ ocr: { trigger: v } })} options={[{ value: 'hover', label: 'Nút khi rê chuột lên ảnh' }, { value: 'manual', label: 'Chỉ menu chuột phải / phím tắt' }]} />
      </Field>
      <Field label="Chế độ quét" description="Bong bóng thoại: tìm chữ rải rác (phù hợp trang manga). Tự động: bố cục trang. Khối: một khối chữ (phù hợp khi chọn vùng).">
        <Select value={o.layout} onChange={(v) => update({ ocr: { layout: v } })} options={[{ value: 'sparse', label: 'Bong bóng thoại (sparse)' }, { value: 'auto', label: 'Tự động' }, { value: 'block', label: 'Một khối chữ' }]} />
      </Field>
      <Toggle label="Hiện khung vùng chữ (bounding boxes)" checked={o.showBoxes} onChange={(v) => update({ ocr: { showBoxes: v } })} />
      <Field stacked label="Màu khung bong bóng" description="Khung nét đứt = độ tin cậy thấp; khung xanh lá = đã sửa.">
        <ColorField value={o.boxColor} onChange={(v) => update({ ocr: { boxColor: v } })} swatches={BOX_COLORS} />
      </Field>
      <Field label="Ngưỡng tin cậy" description="Bỏ các từ có độ tin cậy thấp hơn ngưỡng (giảm nhiễu từ nền tram, hiệu ứng).">
        <Slider value={o.confidenceThreshold} min={0} max={95} onChange={(v) => update({ ocr: { confidenceThreshold: v } })} format={(v) => `${v}%`} />
      </Field>
      <Field label="Kích thước ảnh tối thiểu" description="Ảnh nhỏ hơn sẽ không hiện nút quét.">
        <Slider value={o.minImageSize} min={80} max={1200} step={10} onChange={(v) => update({ ocr: { minImageSize: v } })} format={(v) => `${v}px`} />
      </Field>
      <Toggle label="Tự động lưu cache kết quả" description="Không quét lại ảnh đã quét (cache theo URL ảnh hoặc dấu vân tay điểm ảnh)." checked={o.autoCache} onChange={(v) => update({ ocr: { autoCache: v } })} />
      <div className="py-3">
        <Notice title="Giới hạn">
          OCR không chính xác tuyệt đối: chữ viết tay, chữ nghiêng/cong, hiệu ứng âm thanh và chữ dọc thường nhận sai. Với ảnh tải chéo nguồn bị chặn, LingoLens chụp phần đang hiển thị nên chỉ quét được phần ảnh trên màn hình.
        </Notice>
      </div>
    </Page>
  );
}

function Shortcuts({ s, update }: { s: Settings; update: Update }) {
  const [cmds, setCmds] = useState<chrome.commands.Command[]>([]);
  useEffect(() => {
    void chrome.commands.getAll().then(setCmds);
  }, []);
  return (
    <Page title="Phím tắt">
      {cmds
        .filter((c) => c.name !== '_execute_action')
        .map((c) => (
          <Field key={c.name} label={c.description ?? c.name ?? ''}>
            {c.shortcut ? <span className="ml-kbd px-2 py-0.5 text-[12px]">{c.shortcut}</span> : <Badge tone="warn">chưa gán</Badge>}
          </Field>
        ))}
      <Field label="Đóng popup" description="Escape luôn đóng popup. Có thể thêm một phím khác (không hoạt động khi đang gõ).">
        <Segmented value={s.shortcuts.closePopup} onChange={(v) => update({ shortcuts: { closePopup: v } })} options={[{ value: 'Escape', label: 'Esc' }, { value: 'q', label: 'Esc / Q' }, { value: 'x', label: 'Esc / X' }]} />
      </Field>
      <div className="py-3">
        <Button size="sm" onClick={() => void send({ type: 'shortcuts:open' })}>
          Đổi phím tắt trong Chrome
        </Button>
        <div className="mt-1.5 text-[12px] text-muted">Chrome quản lý phím tắt của tiện ích tại chrome://extensions/shortcuts.</div>
      </div>
    </Page>
  );
}

function DataSettings({ reset }: { reset: () => Promise<void> }) {
  const [stats, setStats] = useState<DictStats | null>(null);
  const [ocrStats, setOcrStats] = useState<{ entries: number; bytes: number } | null>(null);
  const [name, setName] = useState('my-dictionary');
  const [msg, setMsg] = useState<{ tone: 'info' | 'warn' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cache = new OcrCache(chromeLocal());
  const load = () => {
    void send({ type: 'dict:stats' }).then(setStats).catch((e) => setMsg({ tone: 'error', text: (e as Error).message }));
    void cache.stats().then(setOcrStats);
  };
  useEffect(load, []);

  const onImport = async (file: File) => {
    setBusy(true);
    setMsg(null);
    try {
      const text = await file.text();
      const format = /\.csv$/i.test(file.name) ? 'csv' : 'json';
      const r = await send({ type: 'dict:import', name: name.trim() || file.name, format, text });
      setMsg({ tone: r.errors.length ? 'warn' : 'info', text: `Đã nhập ${r.imported} mục, bỏ qua ${r.skipped}.${r.errors.length ? ` Lỗi: ${r.errors.slice(0, 5).join('; ')}${r.errors.length > 5 ? '…' : ''}` : ''}` });
      load();
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <Page title="Nguồn dữ liệu từ điển" desc="Tất cả dữ liệu nằm trong gói tiện ích hoặc IndexedDB trên máy này.">
        {stats?.sources.map((x) => (
          <Field key={x.id} label={x.name} description={x.license}>
            <div className="flex items-center gap-2">
              <Badge tone={x.kind === 'curated' ? 'warn' : x.kind === 'user' ? 'accent' : 'ok'}>{x.kind === 'established' ? 'dữ liệu công bố' : x.kind === 'curated' ? 'biên soạn thủ công' : 'người dùng'}</Badge>
              <span className="font-mono text-[12px] text-muted">{x.entries?.toLocaleString() ?? '—'}</span>
            </div>
          </Field>
        )) ?? <div className="py-3 text-[13px] text-muted">Đang tải…</div>}
        <div className="py-3">
          <Notice tone="warn" title="Phạm vi dữ liệu tiếng Việt">
            Bộ “LingoLens Starter” chỉ có {stats?.sources.find((x) => x.id === 'starter')?.entries?.toLocaleString() ?? 'khoảng 950'} mục (từ và cụm từ thông dụng trong truyện), biên soạn thủ công và chưa được kiểm duyệt chuyên môn. Nó <b>không</b> phải từ điển Anh–Việt đầy đủ: các từ khác chỉ có định nghĩa tiếng Anh (WordNet). Hãy nhập thêm bộ dữ liệu mà bạn có quyền sử dụng.
          </Notice>
        </div>
      </Page>

      <Page title="Nhập từ điển (JSON / CSV)" desc="CSV cần dòng tiêu đề: word, pos, vi, en, ipa, example, synonyms, antonyms, tags, note. JSON: mảng các object cùng tên trường.">
        <Field label="Tên bộ dữ liệu" description="Nhập lại cùng tên sẽ thay thế bộ cũ.">
          <input value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} className="ml-focus h-8 w-56 rounded-lg border border-border bg-elevated px-2.5 text-[13px] text-text" />
        </Field>
        <div className="flex flex-wrap items-center gap-2 py-3">
          <Button variant="primary" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            <IconUpload size={14} /> {busy ? 'Đang nhập…' : 'Chọn tệp…'}
          </Button>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept=".json,.csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImport(f);
              e.target.value = '';
            }}
          />
          <Button
            size="sm"
            variant="danger"
            disabled={!stats?.userEntries}
            onClick={async () => {
              if (!confirm('Xóa toàn bộ từ điển đã nhập?')) return;
              await send({ type: 'dict:clear-user' });
              load();
            }}
          >
            <IconTrash size={14} /> Xóa từ điển đã nhập
          </Button>
        </div>
        {stats?.userSets.length ? (
          <div className="py-2.5">
            {stats.userSets.map((u) => (
              <div key={u.name} className="text-[12.5px] text-muted">
                <b className="text-text">{u.name}</b> · {u.count.toLocaleString()} mục · {new Date(u.importedAt).toLocaleString()}
              </div>
            ))}
          </div>
        ) : null}
        {msg && (
          <div className="py-3">
            <Notice tone={msg.tone}>{msg.text}</Notice>
          </div>
        )}
      </Page>

      <Page title="Cache & bộ nhớ">
        <Field label="Cache OCR" description="Kết quả OCR đã lưu (chỉ văn bản + tọa độ, không lưu ảnh).">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] text-muted">
              {ocrStats ? `${ocrStats.entries} mục · ${(ocrStats.bytes / 1024).toFixed(0)} KB` : '—'}
            </span>
            <Button size="sm" onClick={async () => { await send({ type: 'ocr:clear-cache' }); load(); }}>
              Xóa
            </Button>
          </div>
        </Field>
        <Field label="Đặt lại toàn bộ cài đặt" description="Không ảnh hưởng sổ từ vựng và từ điển đã nhập.">
          <Button
            size="sm"
            variant="danger"
            onClick={async () => {
              if (confirm('Đặt lại toàn bộ cài đặt về mặc định?')) await reset();
            }}
          >
            Reset to Default
          </Button>
        </Field>
      </Page>
    </div>
  );
}

function About() {
  const lic = (f: string) => chrome.runtime.getURL(`licenses/${f}`);
  return (
    <Page title="Giới thiệu & quyền riêng tư">
      <div className="space-y-3 py-4 text-[13px] text-muted">
        <p>
          <b className="text-text">LingoLens {chrome.runtime.getManifest().version}</b> – trợ lý đọc tiếng Anh hoạt động cục bộ (local-first), Dictionary Mode, không dùng AI hay API trả phí.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Không gửi nội dung truyện, ảnh hay từ bạn tra tới bất kỳ máy chủ nào.</li>
          <li>Không có tracking, analytics hay tài khoản.</li>
          <li>OCR (Tesseract.js), từ điển và phân tích ngữ pháp chạy hoàn toàn trên máy.</li>
          <li>Dữ liệu lưu cục bộ: cài đặt, sổ từ, cache OCR (chrome.storage.local) và từ điển nhập (IndexedDB).</li>
        </ul>
        <p className="text-text">Giấy phép dữ liệu & thư viện:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><a className="text-accent hover:underline" href={lic('WordNet-LICENSE.txt')} target="_blank" rel="noreferrer">WordNet 3.1 – Princeton University</a></li>
          <li><a className="text-accent hover:underline" href={lic('cmu-pronouncing-dictionary-LICENSE.txt')} target="_blank" rel="noreferrer">CMU Pronouncing Dictionary</a></li>
          <li><a className="text-accent hover:underline" href={lic('tesseract.js-LICENSE.md')} target="_blank" rel="noreferrer">Tesseract.js</a> · <a className="text-accent hover:underline" href={lic('tesseract.js-core-LICENSE.txt')} target="_blank" rel="noreferrer">tesseract.js-core</a> (Apache-2.0)</li>
          <li><a className="text-accent hover:underline" href={lic('LingoLens-Starter-LICENSE.md')} target="_blank" rel="noreferrer">LingoLens Starter EN–VI (CC0)</a></li>
        </ul>
      </div>
    </Page>
  );
}
