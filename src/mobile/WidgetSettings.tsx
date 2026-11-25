import { useState } from 'react';
import { Field, Segmented } from '@/ui/components';
import { getWidgetOrder, getWidgetTheme, setWidgetOrder, setWidgetTheme, type WidgetOrder } from './widget';
import { WIDGET_THEMES, themeById, type WidgetThemeDef } from './widget-themes';
import { WidgetCard } from './WidgetCard';

const SAMPLES = [
  { w: 'destroy', ipa: '/dɪˈstrɔɪ/', pos: 'động từ', vi: 'phá hủy, tiêu diệt' },
  { w: 'And there’s only one person who could have moved around inside the house', ipa: '', pos: '', vi: 'Và chỉ có một người có thể đi lại trong nhà mà không bị nghi ngờ' },
];

/** Same layout as the Home Screen widget: word, pronunciation + part-of-speech tag, meaning, ‹ and › in the bottom corners. */
function WidgetPreview({ theme, size, sample }: { theme: WidgetThemeDef; size: 'small' | 'medium'; sample: (typeof SAMPLES)[number] }) {
  const long = sample.w.length > 28;
  const pill = theme.onDark ? { background: '#fff', color: '#15803D' } : { background: 'rgba(21,128,61,.14)', color: '#15803D' };
  const circle = { width: 26, height: 26, borderRadius: 13, background: theme.onDark ? '#fff' : '#111827', color: theme.onDark ? '#111827' : '#fff' };
  return (
    <div
      data-ml-widget-preview=""
      style={{
        width: size === 'small' ? 158 : 338,
        height: 158,
        borderRadius: 22,
        padding: 14,
        background: theme.bg,
        color: theme.ink,
        border: theme.border ? `1.5px solid ${theme.border}` : '1px solid rgba(128,128,128,.25)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ fontWeight: 700, fontSize: long ? 13 : 24, lineHeight: 1.15, display: '-webkit-box', WebkitLineClamp: long ? 4 : 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{sample.w}</div>
      {(sample.ipa || sample.pos) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          {sample.ipa && <span style={{ color: theme.accent }}>{sample.ipa}</span>}
          {sample.pos && <span style={{ ...pill, borderRadius: 99, padding: '2px 8px', fontWeight: 700, fontSize: 11 }}>{sample.pos}</span>}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', fontWeight: 600, fontSize: long ? 13 : 18, lineHeight: 1.2 }}>{sample.vi}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ ...circle, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 14 }}>‹</span>
        <span style={{ ...circle, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 14 }}>›</span>
      </div>
    </div>
  );
}

/**
 * Settings → Widget (iPhone app only): the look of the widget (with a live preview) and how it walks through the saved words.
 * Both are sent to the widget with the words; a widget set to "Theo cài đặt trong app" follows them (each widget can override them in
 * Edit Widget).
 */
export function WidgetSettings() {
  const [order, setOrder] = useState<WidgetOrder>(getWidgetOrder());
  const [themeId, setThemeId] = useState(getWidgetTheme());
  const [size, setSize] = useState<'small' | 'medium'>('small');
  const [sampleIdx, setSampleIdx] = useState(0);
  const theme = themeById(themeId);
  return (
    <div className="space-y-5" data-ml-widget-settings="">
      <h1 className="text-[20px] font-semibold tracking-tight text-text">Widget từ vựng</h1>

      <section className="space-y-3" data-ml-widget-appearance="">
        <div className="text-[13px] font-medium text-text">Giao diện</div>
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-text/[0.04] p-4">
          <WidgetPreview theme={theme} size={size} sample={SAMPLES[sampleIdx]} />
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Segmented
              value={size}
              onChange={setSize}
              options={[
                { value: 'small', label: 'Nhỏ' },
                { value: 'medium', label: 'Vừa' },
              ]}
            />
            <Segmented
              value={String(sampleIdx)}
              onChange={(v) => setSampleIdx(Number(v))}
              options={[
                { value: '0', label: 'Từ' },
                { value: '1', label: 'Câu dài' },
              ]}
            />
          </div>
          <div className="text-[11.5px] text-subtle">Bản xem trước: đổi giao diện bên dưới, widget trên màn hình đổi theo.</div>
        </div>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Giao diện widget">
          {WIDGET_THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={t.id === themeId}
              data-ml-widget-theme={t.id}
              onClick={() => {
                setThemeId(t.id);
                setWidgetTheme(t.id);
              }}
              className="ml-press flex flex-col items-center gap-1 rounded-xl p-1.5 text-[11.5px]"
              style={{ outline: t.id === themeId ? '2px solid var(--ml-accent, #7c9cff)' : '1px solid rgba(128,128,128,.25)' }}
            >
              <span style={{ width: '100%', height: 34, borderRadius: 9, background: t.bg, border: t.border ? `1px solid ${t.border}` : '1px solid rgba(128,128,128,.25)' }} />
              <span className="text-text">{t.label}</span>
            </button>
          ))}
        </div>
      </section>

      <Field label="Thứ tự từ" description="Sau mỗi giờ widget chuyển sang từ khác: ngẫu nhiên trong sổ từ, hoặc lần lượt theo thứ tự trong sổ từ (từ mới nhất trước).">
        <Segmented
          value={order}
          onChange={(v) => {
            setOrder(v);
            setWidgetOrder(v);
          }}
          options={[
            { value: 'random', label: 'Ngẫu nhiên' },
            { value: 'sequential', label: 'Theo thứ tự' },
          ]}
        />
      </Field>
      <div className="rounded-xl bg-text/[0.04] px-3 py-2 text-[12.5px] leading-snug text-muted" data-ml-widget-tips="">
        <b className="text-text">Áp dụng cho widget:</b> giữ widget trên màn hình chính → Chỉnh sửa widget → chọn <b>Theo cài đặt trong app</b> ở Giao diện và Thứ tự từ (hoặc chọn riêng cho từng widget).
        Bấm vào widget để mở Sổ từ; hai nút ‹ › ở hai góc dưới để về từ trước hoặc sang từ kế tiếp ngay.
      </div>
      <WidgetCard />
    </div>
  );
}
