/**
 * Toolbar popup (click on the LingoLens icon): master on/off switch, per-site switch, quick
 * actions (sidebar, settings) and the translation-model status with its one-time download button.
 */
import { useEffect, useState } from 'react';
import { hostListed, normalizeHost } from '@/shared/settings';
import { useSettings } from '@/ui/hooks';
import { cx } from '@/ui/components';
import { IconGear, IconLogo, IconPanel } from '@/ui/icons';
import { MtStatus } from '@/ui/MtStatus';
import { ScanButtons } from '@/ui/ScanButtons';

function useActiveTab() {
  const [tab, setTab] = useState<{ host: string | null; rawHost: string; windowId?: number; id?: number } | null>(null);
  useEffect(() => {
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => {
      let host: string | null = null;
      try {
        const u = new URL(t?.url ?? '');
        if (u.protocol === 'http:' || u.protocol === 'https:') host = normalizeHost(u.hostname);
      } catch {
        /* chrome://, new tab… */
      }
      let rawHost = '';
      try {
        rawHost = new URL(t?.url ?? '').hostname;
      } catch {
        /* no URL */
      }
      setTab({ host, rawHost, windowId: t?.windowId, id: t?.id });
    });
  }, []);
  return tab;
}

function Switch({ on, onChange, label, big }: { on: boolean; onChange: (v: boolean) => void; label: string; big?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cx(
        'ml-focus relative shrink-0 rounded-full border transition-colors duration-200',
        big ? 'h-7 w-[52px]' : 'h-5 w-9',
        on ? 'ml-btn-primary border-transparent' : 'ml-glass-field',
      )}
    >
      <span
        className={cx(
          'absolute left-0 top-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_2px_6px_rgb(0_0_0/0.25)] transition-transform duration-300 [transition-timing-function:var(--ml-ease-spring)]',
          big ? 'h-[22px] w-[22px]' : 'h-4 w-4',
          on ? (big ? 'translate-x-[27px]' : 'translate-x-[18px]') : 'translate-x-[3px]',
        )}
      />
    </button>
  );
}

export function ActionPopup() {
  const { settings: s, update, loaded } = useSettings('page');
  const tab = useActiveTab();
  const host = tab?.host ?? null;
  const siteOn = !!host && hostListed(s.general.sites, host);
  const on = siteOn && s.general.enabled;

  const setSite = (v: boolean) => {
    if (!host) return;
    const list = s.general.sites.filter((h) => h !== host && !(host.endsWith(`.${h}`) && !v));
    // switching on also lifts a pause and an old "ignore" entry for this site
    update({ general: { sites: v ? [...list, host] : list, ...(v ? { enabled: true } : {}) }, reading: { ignoredSites: s.reading.ignoredSites.filter((h) => h !== host) } });
  };

  if (!loaded) return <div className="h-[220px] w-[300px]" />;

  return (
    <div className="w-[300px] space-y-2.5 p-3 text-text animate-ml-in" data-ml-action="">
      <div className="ml-glass flex items-center gap-2.5 rounded-[20px] px-3 py-2.5">
        <IconLogo size={30} />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold">LingoLens</div>
          <div className={cx('truncate text-[12px]', on ? 'text-ok' : 'text-muted')} data-ml-action-status="">
            {!host ? 'Không dùng được trên trang này' : on ? `Đang bật trên ${host}` : siteOn ? 'Đang tạm dừng (Cài đặt → Hành vi đọc)' : 'Đang tắt trên trang này'}
          </div>
        </div>
        <Switch big on={on} onChange={setSite} label="Bật LingoLens trên trang này" />
      </div>

      <div className="ml-glass-card rounded-2xl px-3 py-2 text-[12px] text-muted">
        LingoLens chỉ hoạt động trên những trang bạn bật.{' '}
        {s.general.sites.length ? <>Đang bật trên <b className="text-text">{s.general.sites.length}</b> trang web.</> : 'Chưa bật trên trang nào.'}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {s.sidebar.enabled && (
          <button
            type="button"
            data-ml-magnetic=""
            className="ml-focus ml-press ml-sheen ml-ripple ml-glass-card flex items-center justify-center gap-1.5 rounded-2xl px-2 py-2.5 text-[12.5px] font-medium hover:border-accent/50 hover:text-accent"
            onClick={() => {
              if (tab?.id === undefined) return;
              // Only for this tab (it does not follow you to other tabs). Opened from this click (user gesture).
              void chrome.sidePanel.setOptions({ tabId: tab.id, path: 'sidepanel/index.html', enabled: true });
              void chrome.sidePanel.open({ tabId: tab.id }).then(() => window.close(), () => {});
              // Remember the site so the background closes the panel if this tab moves to another site.
              const id = tab.id;
              void chrome.storage.session.get('panelHosts').then((r) => chrome.storage.session.set({ panelHosts: { ...(r.panelHosts ?? {}), [id]: tab.rawHost } }));
            }}
          >
            <IconPanel size={16} /> Mở Sidebar
          </button>
        )}
        <button
          type="button"
          data-ml-magnetic=""
          className={cx('ml-focus ml-press ml-sheen ml-ripple ml-glass-card flex items-center justify-center gap-1.5 rounded-2xl px-2 py-2.5 text-[12.5px] font-medium hover:border-accent/50 hover:text-accent', !s.sidebar.enabled && 'col-span-2')}
          onClick={() => void chrome.runtime.openOptionsPage().then(() => window.close())}
        >
          <IconGear size={16} /> Cài đặt
        </button>
      </div>

      {/* OCR from the toolbar: only where LingoLens is switched on (it never touches other pages) */}
      {on ? <ScanButtons onStarted={() => window.close()} /> : <div className="ml-glass-card rounded-2xl px-3 py-2 text-[12px] text-muted" data-ml-scan-off="">Bật LingoLens cho trang này để quét OCR (Quét ảnh / Chọn vùng quét).</div>}

      {s.reading.translationMode === 'machine' && (
        <div className="ml-glass-card rounded-2xl px-3 py-1">
          <div className="pt-1.5 text-[12px] font-semibold text-muted">Nguồn dịch</div>
          <MtStatus />
        </div>
      )}
    </div>
  );
}
