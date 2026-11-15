import { useEffect } from 'react';
import { FloatingPopup } from '@/popup/FloatingPopup';
import { computePopupPosition } from '@/popup/position';
import { resolveTheme, prefersDark, themeVars } from '@/ui/theme';
import { cx } from '@/ui/components';
import { IconSearch } from '@/ui/icons';
import { useStore } from './store';
import { OcrLayer } from './OcrLayer';
import * as A from './actions';

export function App({ shadow }: { shadow: ShadowRoot }) {
  const s = useStore((x) => x.settings);
  const capturing = useStore((x) => x.capturing);
  const theme = resolveTheme(s.appearance.theme, prefersDark());
  return (
    <div className="ml-root" data-theme={theme} style={{ ...(themeVars(s, 'popup') as React.CSSProperties), visibility: capturing ? 'hidden' : 'visible' }}>
      <OcrLayer />
      <SelectionTrigger />
      <FloatingPopup shadow={shadow} />
      <Toast />
    </div>
  );
}

/** Small "look up" button shown next to a selection when automatic popup is off. */
function SelectionTrigger() {
  const t = useStore((x) => x.trigger);
  if (!t) return null;
  const p = computePopupPosition(t.rect, { width: 34, height: 30 }, { width: window.innerWidth, height: window.innerHeight }, 'auto', 4);
  return (
    <button
      type="button"
      data-ml-trigger=""
      onClick={() => A.lookup(t.text, t.rect, t.context)}
      className="ml-focus pointer-events-auto fixed inline-flex h-[30px] w-[34px] items-center justify-center rounded-lg border border-border bg-surface text-accent shadow-pop animate-ml-in hover:border-accent"
      style={{ left: Math.min(t.rect.left + t.rect.width - 17, window.innerWidth - 42), top: p.top }}
      title="Tra cứu với MangaLingo"
    >
      <IconSearch />
    </button>
  );
}

function Toast() {
  const toast = useStore((x) => x.toast);
  useEffect(() => undefined, [toast]);
  if (!toast) return null;
  return (
    <div
      role="status"
      className={cx(
        'pointer-events-none fixed bottom-5 left-1/2 max-w-[90vw] -translate-x-1/2 rounded-lg border px-3 py-2 text-[12.5px] shadow-pop animate-ml-in',
        toast.tone === 'error' ? 'border-danger/40 bg-surface text-danger' : toast.tone === 'ok' ? 'border-ok/40 bg-surface text-text' : 'border-border bg-surface text-text',
      )}
    >
      {toast.text}
    </div>
  );
}
