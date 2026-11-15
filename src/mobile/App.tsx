/**
 * LingoLens phone app UI (inside the app's WebView). Android: Home with the on/off switch for the
 * floating button. iPhone: Home with the AssistiveTouch + Shortcuts setup and the scan screen.
 * Both: Lookup (the extension's sidebar), Vocabulary notebook, Settings (the extension's Settings
 * Center).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { SettingsCenter } from '@/options/SettingsCenter';
import { SidePanel } from '@/sidepanel/SidePanel';
import { VocabManager } from '@/ui/VocabManager';
import { useSettings } from '@/ui/hooks';
import { cx, Notice } from '@/ui/components';
import { IconBookmark, IconGear, IconLogo, IconScan, IconSearch } from '@/ui/icons';
import { native, onResume } from './native';
import { latestScanUrl, pendingScanStamp, setAppIcon } from './ios';
import { Scan } from './Scan';

type Tab = 'home' | 'lookup' | 'vocab' | 'settings' | 'scan';
const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'home', label: 'Trang chủ', icon: <IconLogo size={24} /> },
  { id: 'lookup', label: 'Tra cứu', icon: <IconSearch size={24} /> },
  { id: 'vocab', label: 'Sổ từ', icon: <IconBookmark size={24} /> },
  { id: 'settings', label: 'Cài đặt', icon: <IconGear size={24} /> },
];
const isTab = (h: string): h is Tab => TABS.some((t) => t.id === h) || h === 'scan';
const LAST_SCAN = 'mlapp:lastScanStamp';
/** Set by the iPhone app's WebView ('ios'); the Android app exposes `MangaLingoNative` instead. */
const PLATFORM = (globalThis as { MangaLingoPlatform?: string }).MangaLingoPlatform ?? (native ? 'android' : 'web');

const SCALE = { small: 0.9, medium: 1, large: 1.15 } as const;

export function App() {
  const { settings } = useSettings('page');
  // logo → app icon (iPhone alternate icon / Android launcher entry); both are idempotent
  useEffect(() => {
    const logo = settings.appearance.logo;
    if (PLATFORM === 'ios') void setAppIcon(logo);
    else native?.setLogo?.(logo);
  }, [settings.appearance.logo]);
  const [tab, setTab] = useState<Tab>(() => {
    const h = location.hash.slice(1);
    return isTab(h) ? h : 'home';
  });
  useEffect(() => {
    // the floating button's menu opens the app at a tab (#lookup, #vocab, #settings)
    const on = () => {
      const h = location.hash.slice(1);
      if (isTab(h)) setTab(h);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = (t: Tab) => {
    setTab(t);
    history.replaceState(null, '', `#${t}`);
  };

  // iPhone: an image from the Shortcuts action (AssistiveTouch → Take Screenshot → LingoLens)
  const [scanSrc, setScanSrc] = useState<string | null>(null);
  useEffect(() => {
    if (PLATFORM !== 'ios') return;
    const open = (stamp: number) => {
      if (!stamp) return;
      try {
        localStorage.setItem(LAST_SCAN, String(stamp));
      } catch {
        /* storage unavailable */
      }
      setScanSrc(latestScanUrl(stamp));
      setTab('scan');
      history.replaceState(null, '', '#scan');
    };
    (globalThis as { __mlNewScan?: (s: number) => void }).__mlNewScan = open;
    // app was opened (cold start) by the Shortcuts action: show the image it brought
    void pendingScanStamp().then((stamp) => {
      let seen = 0;
      try {
        seen = Number(localStorage.getItem(LAST_SCAN) ?? 0);
      } catch {
        /* storage unavailable */
      }
      if (stamp > seen) open(stamp);
    });
  }, []);
  const scanFile = (file: File) => {
    setScanSrc(URL.createObjectURL(file));
    go('scan');
  };

  return (
    <div className="flex min-h-[100dvh] flex-col text-text" style={{ zoom: SCALE[settings.appearance.uiScale] ?? 1 }} data-ml-app="">
      <main className="min-h-0 flex-1 pb-[100px]">
        {tab === 'home' && (PLATFORM === 'ios' ? <IosHome onOpen={go} onFile={scanFile} /> : <Home onOpen={go} />)}
        {tab === 'scan' && (scanSrc ? <Scan src={scanSrc} onBack={() => go('home')} /> : <IosHome onOpen={go} onFile={scanFile} />)}
        {tab === 'lookup' && <SidePanel />}
        {tab === 'vocab' && (
          <div className="px-3 py-3">
            <h1 className="mb-3 text-[18px] font-bold">Sổ từ vựng</h1>
            <VocabManager />
          </div>
        )}
        {tab === 'settings' && <SettingsCenter hidden={['shortcuts']} />}
      </main>
      <nav className="ml-glass fixed inset-x-3 bottom-[max(10px,env(safe-area-inset-bottom))] z-20 grid grid-cols-4 rounded-[30px] p-1" data-ml-app-nav="">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => go(t.id)}
            className={cx('ml-press flex flex-col items-center gap-0.5 rounded-[26px] py-1.5 text-[12px] font-semibold', tab === t.id || (tab === 'scan' && t.id === 'home') ? 'ml-glass-select border border-transparent' : 'border border-transparent text-muted')}
            aria-current={tab === t.id ? 'page' : undefined}
          >
            <span className="px-4 py-0.5">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function BigSwitch({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Bật / tắt nút nổi LingoLens"
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cx('relative h-[52px] w-[92px] shrink-0 rounded-full border transition-colors duration-200 disabled:opacity-40', on ? 'ml-btn-primary border-transparent' : 'ml-glass-field')}
      data-ml-main-switch=""
    >
      <span className={cx('absolute left-0 top-1/2 h-[44px] w-[44px] -translate-y-1/2 rounded-full bg-white shadow-[0_3px_10px_rgb(0_0_0/0.25)] transition-transform duration-300 [transition-timing-function:var(--ml-ease-spring)]', on ? 'translate-x-[43px]' : 'translate-x-[3px]')} />
    </button>
  );
}

function Home({ onOpen }: { onOpen: (t: Tab) => void }) {
  useSettings('page'); // applies the theme
  const [, refresh] = useState(0);
  useEffect(() => onResume(() => refresh((n) => n + 1)), []);
  const allowed = native?.overlayAllowed() ?? false;
  const on = native?.isEnabled() ?? false;

  const toggle = (v: boolean) => {
    if (!native) return;
    if (v && !native.overlayAllowed()) {
      native.openOverlaySettings();
      return;
    }
    if (v && !native.notificationsAllowed()) native.requestNotifications();
    native.setEnabled(v);
    refresh((n) => n + 1);
  };

  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 pt-6">
      <div className="flex items-center gap-3">
        <IconLogo size={52} />
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">LingoLens</h1>
          <div className="text-[13px] text-muted">Trợ lý đọc tiếng Anh</div>
        </div>
      </div>

      <div className={cx('ml-glass rounded-[28px] p-5 transition-colors', on && 'bg-accent/10')} data-ml-home-card="">
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-[20px] font-bold">{on ? 'Đang bật' : 'Đang tắt'}</div>
            <div className="mt-1 text-[13px] text-muted">
              {on ? 'Nút nổi LingoLens đang hiện trên màn hình.' : 'Bật để hiện nút nổi LingoLens trên mọi ứng dụng.'}
            </div>
          </div>
          <BigSwitch on={on} onChange={toggle} disabled={!native} />
        </div>
      </div>

      {!native && <Notice tone="warn" title="Đang xem trên trình duyệt">Nút nổi chỉ có trong ứng dụng Android LingoLens.</Notice>}
      {native && !allowed && (
        <Notice tone="warn" title="Cần quyền “Hiển thị trên ứng dụng khác”">
          Để nút nổi hiện trên các ứng dụng đọc truyện, hãy cho phép LingoLens hiển thị trên ứng dụng khác.
          <button type="button" className="mt-2 block rounded-xl bg-accent px-3 py-2 text-[13px] font-semibold text-accent-fg" onClick={() => native?.openOverlaySettings()}>
            Cấp quyền
          </button>
        </Notice>
      )}

      <div className="space-y-2 ml-glass-card rounded-[28px] p-4">
        <div className="text-[13px] font-bold">Nút nổi</div>
        <ul className="space-y-1.5 text-[13px] text-muted">
          <li>• Kéo nút đi bất kỳ đâu; thả ra, nút tự hít vào cạnh màn hình.</li>
          <li>• Không dùng một lúc, nút mờ đi để không che truyện.</li>
          <li>• Chạm vào nút để mở menu tính năng.</li>
        </ul>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {(['lookup', 'vocab', 'settings'] as Tab[]).map((t) => {
          const item = TABS.find((x) => x.id === t)!;
          return (
            <button key={t} type="button" onClick={() => onOpen(t)} className="ml-card ml-glass-card ml-press ml-sheen flex flex-col items-center gap-1 rounded-[22px] py-3 text-[12.5px] font-semibold text-text">
              <span className="text-accent">{item.icon}</span>
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** iPhone: iOS does not let apps draw over other apps — the system AssistiveTouch button runs a
 *  Shortcut (Take Screenshot → Quét ảnh với LingoLens) instead. */
function IosHome({ onOpen, onFile }: { onOpen: (t: Tab) => void; onFile: (f: File) => void }) {
  useSettings('page'); // applies the theme
  const steps = [
    ['Tạo Phím tắt', 'Mở app Phím tắt → + → thêm “Chụp ảnh màn hình”, rồi thêm “Quét ảnh với LingoLens” (ô Ảnh: Ảnh chụp màn hình). Đặt tên “LingoLens: Quét”.'],
    ['Bật nút nổi', 'Cài đặt → Trợ năng → Cảm ứng → AssistiveTouch → bật. Chỉnh “Độ mờ khi không dùng” khoảng 40%.'],
    ['Gán thao tác', 'Trong AssistiveTouch → Tác vụ tùy chỉnh → Chạm hai lần → chọn Phím tắt “LingoLens: Quét”.'],
    ['Dùng', 'Đang đọc truyện, chạm hai lần vào nút nổi → LingoLens mở ảnh vừa chụp → kéo khung vào chữ → Quét.'],
  ];
  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 pt-6" data-ml-ios-home="">
      <div className="flex items-center gap-3">
        <IconLogo size={52} />
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">LingoLens</h1>
          <div className="text-[13px] text-muted">Trợ lý đọc tiếng Anh · iPhone</div>
        </div>
      </div>

      <div className="space-y-2 rounded-3xl border border-accent/40 bg-accent/10 p-5">
        <div className="text-[17px] font-bold">Quét chữ trong ảnh</div>
        <div className="text-[13px] text-muted">Chọn ảnh chụp màn hình trang truyện, kéo khung vào bong bóng (hoặc một câu, một từ) rồi quét. Nhận dạng chữ chạy trên máy.</div>
        <label className="mt-1 inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-[14px] font-semibold text-accent-fg">
          <IconScan size={16} /> Chọn ảnh để quét
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = '';
            }}
          />
        </label>
      </div>

      <div className="ml-glass-card rounded-[28px] p-4" data-ml-ios-setup="">
        <div className="text-[15px] font-bold">Nút nổi (AssistiveTouch)</div>
        <div className="mt-0.5 text-[12.5px] text-muted">iOS không cho ứng dụng tự hiện nút nổi trên ứng dụng khác, nên LingoLens dùng nút AssistiveTouch của iPhone. Thiết lập một lần:</div>
        <ol className="mt-3 space-y-2.5">
          {steps.map(([title, body], i) => (
            <li key={title} className="flex gap-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[12px] font-bold text-accent-fg">{i + 1}</span>
              <div className="min-w-0">
                <div className="text-[13.5px] font-semibold">{title}</div>
                <div className="text-[12.5px] leading-snug text-muted">{body}</div>
              </div>
            </li>
          ))}
        </ol>
        <a href="shortcuts://" className="mt-3 inline-block rounded-xl border border-border bg-elevated px-3 py-1.5 text-[13px] font-semibold text-text">
          Mở app Phím tắt
        </a>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {(['lookup', 'vocab', 'settings'] as Tab[]).map((t) => {
          const item = TABS.find((x) => x.id === t)!;
          return (
            <button key={t} type="button" onClick={() => onOpen(t)} className="ml-card ml-glass-card ml-press ml-sheen flex flex-col items-center gap-1 rounded-[22px] py-3 text-[12.5px] font-semibold text-text">
              <span className="text-accent">{item.icon}</span>
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
