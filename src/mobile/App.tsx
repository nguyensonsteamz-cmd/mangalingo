/**
 * MangaLingo Android app UI (inside the app's WebView): Home (on/off switch for the floating
 * button), Lookup (the extension's sidebar), Vocabulary notebook, Settings (the extension's
 * Settings Center).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { SettingsCenter } from '@/options/SettingsCenter';
import { SidePanel } from '@/sidepanel/SidePanel';
import { VocabManager } from '@/ui/VocabManager';
import { useSettings } from '@/ui/hooks';
import { cx, Notice } from '@/ui/components';
import { IconBookmark, IconGear, IconLogo, IconSearch } from '@/ui/icons';
import { native, onResume } from './native';

type Tab = 'home' | 'lookup' | 'vocab' | 'settings';
const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'home', label: 'Trang chủ', icon: <IconLogo size={20} /> },
  { id: 'lookup', label: 'Tra cứu', icon: <IconSearch size={20} /> },
  { id: 'vocab', label: 'Sổ từ', icon: <IconBookmark size={20} /> },
  { id: 'settings', label: 'Cài đặt', icon: <IconGear size={20} /> },
];
const isTab = (h: string): h is Tab => TABS.some((t) => t.id === h);
/** Set by the iPhone app's WebView ('ios'); the Android app exposes `MangaLingoNative` instead. */
const PLATFORM = (globalThis as { MangaLingoPlatform?: string }).MangaLingoPlatform ?? (native ? 'android' : 'web');

export function App() {
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

  return (
    <div className="flex min-h-[100dvh] flex-col bg-bg text-text">
      <main className="min-h-0 flex-1 pb-[72px]">
        {tab === 'home' && (PLATFORM === 'ios' ? <IosHome onOpen={go} /> : <Home onOpen={go} />)}
        {tab === 'lookup' && <SidePanel />}
        {tab === 'vocab' && (
          <div className="px-3 py-3">
            <h1 className="mb-3 text-[18px] font-bold">Sổ từ vựng</h1>
            <VocabManager />
          </div>
        )}
        {tab === 'settings' && <SettingsCenter hidden={['shortcuts']} />}
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur" data-ml-app-nav="">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => go(t.id)}
            className={cx('flex flex-col items-center gap-0.5 py-2 text-[11.5px] font-semibold', tab === t.id ? 'text-accent' : 'text-muted')}
            aria-current={tab === t.id ? 'page' : undefined}
          >
            <span className={cx('rounded-full px-4 py-1', tab === t.id && 'bg-accent/15')}>{t.icon}</span>
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
      aria-label="Bật / tắt nút nổi MangaLingo"
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cx('relative h-[52px] w-[92px] shrink-0 rounded-full transition-colors disabled:opacity-40', on ? 'bg-accent' : 'bg-border')}
      data-ml-main-switch=""
    >
      <span className={cx('absolute left-0 top-1/2 h-[44px] w-[44px] -translate-y-1/2 rounded-full bg-white shadow-md transition-transform', on ? 'translate-x-[44px]' : 'translate-x-[4px]')} />
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
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/15 ring-1 ring-accent/30">
          <IconLogo size={30} />
        </span>
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">MangaLingo</h1>
          <div className="text-[13px] text-muted">Trợ lý đọc tiếng Anh</div>
        </div>
      </div>

      <div className={cx('rounded-3xl border p-5 transition-colors', on ? 'border-accent/40 bg-accent/10' : 'border-border bg-surface')} data-ml-home-card="">
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-[20px] font-bold">{on ? 'Đang bật' : 'Đang tắt'}</div>
            <div className="mt-1 text-[13px] text-muted">
              {on ? 'Nút nổi MangaLingo đang hiện trên màn hình.' : 'Bật để hiện nút nổi MangaLingo trên mọi ứng dụng.'}
            </div>
          </div>
          <BigSwitch on={on} onChange={toggle} disabled={!native} />
        </div>
      </div>

      {!native && <Notice tone="warn" title="Đang xem trên trình duyệt">Nút nổi chỉ có trong ứng dụng Android MangaLingo.</Notice>}
      {native && !allowed && (
        <Notice tone="warn" title="Cần quyền “Hiển thị trên ứng dụng khác”">
          Để nút nổi hiện trên các ứng dụng đọc truyện, hãy cho phép MangaLingo hiển thị trên ứng dụng khác.
          <button type="button" className="mt-2 block rounded-xl bg-accent px-3 py-2 text-[13px] font-semibold text-accent-fg" onClick={() => native?.openOverlaySettings()}>
            Cấp quyền
          </button>
        </Notice>
      )}

      <div className="space-y-2 rounded-3xl border border-border bg-surface p-4">
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
            <button key={t} type="button" onClick={() => onOpen(t)} className="ml-card flex flex-col items-center gap-1 rounded-2xl border border-border bg-surface py-3 text-[12.5px] font-semibold text-text">
              <span className="text-accent">{item.icon}</span>
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** iPhone: no floating button (iOS does not allow drawing over other apps). */
function IosHome({ onOpen }: { onOpen: (t: Tab) => void }) {
  useSettings('page'); // applies the theme
  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 pt-6" data-ml-ios-home="">
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/15 ring-1 ring-accent/30">
          <IconLogo size={30} />
        </span>
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">MangaLingo</h1>
          <div className="text-[13px] text-muted">Trợ lý đọc tiếng Anh · iPhone</div>
        </div>
      </div>
      <div className="space-y-2 rounded-3xl border border-accent/40 bg-accent/10 p-5">
        <div className="text-[17px] font-bold">Tra từ và câu tiếng Anh</div>
        <div className="text-[13px] text-muted">Nhập hoặc dán từ, câu, đoạn văn để xem nghĩa tiếng Việt, IPA, ngữ pháp và ngữ cảnh. Mọi thứ chạy trên máy, không cần mạng.</div>
        <button type="button" onClick={() => onOpen('lookup')} className="mt-1 rounded-xl bg-accent px-4 py-2 text-[14px] font-semibold text-accent-fg">
          Tra cứu ngay
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(['vocab', 'settings'] as Tab[]).map((t) => {
          const item = TABS.find((x) => x.id === t)!;
          return (
            <button key={t} type="button" onClick={() => onOpen(t)} className="ml-card flex flex-col items-center gap-1 rounded-2xl border border-border bg-surface py-3 text-[12.5px] font-semibold text-text">
              <span className="text-accent">{item.icon}</span>
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
