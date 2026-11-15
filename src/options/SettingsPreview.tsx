/**
 * Live preview for appearance-related settings (Giao diện, Popup, Chữ, OCR): a small manga panel
 * with an OCR box in the configured colour, and the popup rendered with the real theme tokens
 * (popup theme / background, accent, width, font, sizes, opacity, tabs, IPA, animation).
 */
import { useEffect, useState, type CSSProperties } from 'react';
import type { Settings } from '@/shared/settings';
import { popupSurface, prefersDark, resolveTheme, sidebarSurface, themeVars } from '@/ui/theme';
import { cx } from '@/ui/components';
import { IconBookmark, IconEdit, IconGear, IconInfo, IconLayers, IconLogo, IconPanel, IconSearch, IconVolume, IconX } from '@/ui/icons';

/** Which part to preview: the OCR box on a manga panel, or the lookup popup. */
export type PreviewKind = 'ocr' | 'popup' | 'sidebar';

export function SettingsPreview({ s, kind }: { s: Settings; kind: PreviewKind }) {
  if (kind === 'sidebar') return <SidebarPreview s={s} />;
  const surface = popupSurface(s, resolveTheme(s.appearance.theme, prefersDark()));
  const vars = themeVars(s, 'popup') as CSSProperties;
  // Replay the open animation whenever a setting changes, so its effect is visible.
  const [tick, setTick] = useState(0);
  const sig = JSON.stringify([s.popup, s.typography, s.appearance, s.ocr.boxColor, s.dictionary.showIpa]);
  useEffect(() => setTick((t) => t + 1), [sig]);

  const tabs = [
    s.popup.sections.meaning && 'Nghĩa',
    s.popup.sections.context && 'Ngữ cảnh',
    s.popup.sections.examples && 'Ví dụ',
    s.popup.sections.grammar && 'Ngữ pháp',
  ].filter(Boolean) as string[];
  // The popup is shown at 70% scale so a 300–600 px popup fits next to the settings.
  const scale = 0.7;

  return (
    <div className="ml-root rounded-xl border border-border bg-bg p-3" style={vars} data-ml-preview="">
      <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-subtle">
        <span>Xem trước</span>
        <span className="font-normal normal-case tracking-normal">thay đổi hiện ngay</span>
      </div>

      {/* manga panel with a speech bubble and the OCR box */}
      {kind === 'ocr' && (
      <div className="relative h-[120px] overflow-hidden rounded-lg border border-border" style={{ background: 'repeating-linear-gradient(135deg,#d9d9d9 0 6px,#cfcfcf 6px 12px)' }}>
        <div className="absolute left-4 top-3 flex h-[90px] w-[150px] items-center justify-center rounded-[50%] border-2 border-black bg-white text-center">
          <span className="relative px-1 font-[Comic_Sans_MS,Comic_Neue,cursive] text-[12px] font-bold leading-tight text-black">
            I&apos;M GONNA BECOME
            <br />
            THE STRONGEST!
            <span className="absolute -inset-1 rounded-md border-2" style={{ borderColor: `rgb(var(--ml-box))`, background: 'rgb(var(--ml-box) / 0.12)' }} data-ml-preview-box="" />
          </span>
        </div>
        <div className="absolute right-3 top-3 text-right text-[10.5px] leading-snug text-neutral-700">
          Khung OCR
          <br />
          <span className="font-mono">{s.ocr.boxColor}</span>
        </div>
      </div>
      )}

      {/* popup */}
      {kind === 'popup' && (
      <>
      <div className="flex justify-center overflow-hidden pb-2">
        {/* zoom (not transform) so the scaled popup also takes its scaled height in the layout */}
        <div style={{ zoom: scale, width: s.popup.width } as CSSProperties}>
          <div
            key={tick}
            data-theme={surface.theme}
            className={cx('overflow-hidden rounded-xl border border-border bg-surface text-text shadow-pop', s.popup.animation && 'animate-ml-in')}
            style={{ ...(surface.vars as CSSProperties), width: s.popup.width, opacity: s.popup.opacity }}
            data-ml-preview-popup=""
          >
            <div className="flex items-start gap-1 border-b border-border px-3 pb-2 pt-2.5">
              <div className="min-w-0 flex-1">
                <span className="text-[16px] font-semibold">strongest</span>
                {s.dictionary.showIpa && <span className="ml-2 ml-ipa text-[13px] text-accent">/ˈstrɔŋɡəst/</span>}
                <div className="mt-1 flex gap-1">
                  <span className="rounded-md bg-accent/15 px-1.5 text-[11px] font-medium text-accent">Từ</span>
                  {s.dictionary.showPos && <span className="rounded-md border border-border bg-elevated px-1.5 text-[11px] text-muted">adj. · tính từ</span>}
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-muted">
                <IconVolume size={16} />
                <IconPanel size={16} />
                <IconGear size={16} />
                <IconX size={16} />
              </div>
            </div>
            {tabs.length > 1 && (
              <div className="flex gap-3 border-b border-border px-3 text-[13px]">
                {tabs.map((t, i) => (
                  <span key={t} className={cx('py-1.5', i === 0 ? 'border-b-2 border-accent font-medium text-text' : 'text-muted')}>
                    {t}
                  </span>
                ))}
              </div>
            )}
            <div className="space-y-2 px-3 py-2.5">
              <div className="rounded-xl border border-accent/25 border-l-[4px] border-l-accent bg-accent/[0.07] px-3 py-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-accent">Nghĩa</div>
                <div className="ml-tr font-bold">mạnh nhất</div>
              </div>
              <div className="ml-tr leading-[var(--ml-line)] text-text">
                Tôi sẽ trở thành ninja <b>mạnh nhất</b>!
              </div>
              <div className="text-[12.5px] text-muted">1. adj. having strength or power greater than average</div>
            </div>
          </div>
        </div>
      </div>
      <div className="text-center text-[10.5px] text-subtle">
        Popup {s.popup.width}px · chữ {s.popup.fontSize || s.typography.fontSize}px · {Math.round(s.popup.opacity * 100)}%
      </div>
      </>
      )}
    </div>
  );
}

const SB_TABS = [
  { id: 'translation', label: 'Dịch', icon: <IconPanel size={14} /> },
  { id: 'vocabulary', label: 'Từ vựng', icon: <IconLayers size={14} /> },
  { id: 'grammar', label: 'Ngữ pháp', icon: <IconEdit size={14} /> },
  { id: 'context', label: 'Ngữ cảnh', icon: <IconInfo size={14} /> },
  { id: 'saved', label: 'Đã lưu', icon: <IconBookmark size={14} /> },
];

/** Miniature side panel rendered with the real sidebar theme / background / font size / default tab. */
function SidebarPreview({ s }: { s: Settings }) {
  const surface = sidebarSurface(s, resolveTheme(s.appearance.theme, prefersDark()));
  const vars = { ...themeVars(s, 'sidebar'), ...surface.vars } as CSSProperties;
  const compact = s.sidebar.defaultState === 'compact';
  const widthLabel = s.sidebar.width === 'narrow' ? 'hẹp (400px)' : s.sidebar.width === 'comfortable' ? 'vừa (540px)' : 'toàn bộ';
  return (
    <div className="ml-root rounded-xl border border-border bg-bg p-3" data-ml-preview="">
      <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-subtle">
        <span>Xem trước</span>
        <span className="font-normal normal-case tracking-normal">thay đổi hiện ngay</span>
      </div>
      <div className="flex justify-center">
        <div
          data-theme={surface.theme}
          style={vars}
          className="w-[300px] overflow-hidden rounded-xl border border-border bg-bg text-text shadow-pop"
          data-ml-preview-sidebar=""
        >
          <div className="h-1 bg-gradient-to-r from-accent via-[rgb(var(--ml-box))] to-ok" />
          <div className="flex items-center gap-2 px-3 pb-2 pt-2.5">
            <IconLogo size={32} />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-bold leading-tight">LingoLens</div>
              <div className="flex items-center gap-1 text-[10.5px] text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-ok" /> Dịch máy · chạy trên máy
              </div>
            </div>
            <IconGear size={15} className="text-muted" />
          </div>
          <div className="px-3 pb-2">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-2.5 py-2 text-[12px] text-subtle">
              <IconSearch size={14} className="text-accent" /> Nhập từ, câu tiếng Anh…
            </div>
          </div>
          <div className="px-3 pb-2">
            <div className="grid grid-cols-5 gap-1 rounded-xl bg-elevated/70 p-1 ring-1 ring-border">
              {SB_TABS.map((t) => (
                <span
                  key={t.id}
                  className={cx('flex flex-col items-center gap-0.5 rounded-lg py-1 text-[10px] font-semibold', s.sidebar.defaultTab === t.id ? 'bg-accent text-accent-fg' : 'text-muted')}
                >
                  {t.icon}
                  {t.label}
                </span>
              ))}
            </div>
          </div>
          <div className="space-y-2 border-t border-border px-3 py-2.5">
            <div className="rounded-xl border border-border border-l-[4px] border-l-subtle bg-surface p-2.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Văn bản gốc</div>
              <div className="ml-tr font-medium">I'm gonna become the strongest ninja!</div>
            </div>
            <div className="rounded-xl border border-accent/25 border-l-[4px] border-l-accent bg-accent/[0.07] p-2.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-accent">Bản dịch</div>
              <div className="ml-tr font-semibold">Tôi sẽ trở thành ninja mạnh nhất!</div>
            </div>
            <div className="rounded-xl border border-border border-l-[4px] border-l-warn bg-surface p-2.5">
              <div className="flex items-baseline gap-1.5">
                <span className="text-[14px] font-bold">strongest</span>
                <span className="ml-ipa text-[11px] text-accent">/ˈstrɔŋɡəst/</span>
              </div>
              <div className="ml-tr font-semibold">mạnh nhất</div>
              {!compact && <div className="mt-1.5 rounded-lg bg-elevated/70 px-2 py-1 text-[11.5px] italic text-muted">“I'M GONNA BECOME THE STRONGEST NINJA!”</div>}
              <div className="mt-1.5 flex gap-1">
                <span className="rounded-full px-2 text-[10px] font-semibold text-muted ring-1 ring-border">Mới</span>
                <span className="rounded-full bg-warn px-2 text-[10px] font-semibold text-white">Đang học</span>
                <span className="rounded-full px-2 text-[10px] font-semibold text-muted ring-1 ring-border">Đã thuộc</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-2 text-center text-[10.5px] text-subtle">
        Chữ {s.sidebar.fontSize || s.typography.fontSize}px · nội dung {widthLabel} · {compact ? 'thu gọn' : 'đầy đủ'}
      </div>
    </div>
  );
}
