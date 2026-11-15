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
import { cx, fastTap, GlassIndicator, Notice } from '@/ui/components';
import { IconBookmark, IconGear, IconLogo, IconScan, IconSearch } from '@/ui/icons';
import { native, onResume } from './native';
import { latestScanUrl, pendingScanStamp, prepareTranslationPack, setAppIcon, translationPackStatus } from './ios';
import { Scan, openLookup } from './Scan';
import { IosGuide } from './IosGuide';

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

const APPLIED_ICON = 'mlapp:appliedIcon';
const LAST_TAB = 'mlapp:lastTab';
const PACK_ASKED = 'mlapp:packAsked';
type PackStatus = Awaited<ReturnType<typeof translationPackStatus>>;

/**
 * iPhone: the Vietnamese translation pack is fetched ahead of time, not when the first bubble is
 * scanned. Checked at launch; if it is missing iOS is asked (once, 2 s after start) to download it,
 * and the home screen keeps a card for it until it is installed.
 */
function useTranslationPack() {
  const [status, setStatus] = useState<PackStatus>('unavailable');
  const [busy, setBusy] = useState(false);
  const refresh = () => translationPackStatus().then(setStatus);
  const download = async () => {
    setBusy(true);
    await prepareTranslationPack();
    await refresh();
    setBusy(false);
  };
  useEffect(() => {
    if (PLATFORM !== 'ios') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void translationPackStatus().then((s) => {
      setStatus(s);
      let asked = false;
      try {
        asked = localStorage.getItem(PACK_ASKED) === '1';
      } catch {
        /* storage unavailable */
      }
      if (s === 'download' && !asked) {
        timer = setTimeout(() => {
          try {
            localStorage.setItem(PACK_ASKED, '1');
          } catch {
            /* storage unavailable */
          }
          void download();
        }, 2000);
      }
    });
    const back = onResume(() => void refresh());
    return () => {
      clearTimeout(timer);
      back();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { status, busy, download };
}
const SCALE = { small: 0.9, medium: 1, large: 1.15 } as const;

export function App() {
  const { settings, loaded } = useSettings('page');
  const pack = useTranslationPack();
  // logo → app icon (iPhone alternate icon / Android launcher entry). Only once the saved settings
  // are loaded (not for the default logo shown before that) and only when the logo really changed
  // since the last switch – iOS shows an alert for every icon change.
  useEffect(() => {
    if (!loaded) return;
    const logo = settings.appearance.logo;
    let applied: string | null = null;
    try {
      applied = localStorage.getItem(APPLIED_ICON);
    } catch {
      /* storage unavailable */
    }
    if (applied === logo) return;
    try {
      localStorage.setItem(APPLIED_ICON, logo);
    } catch {
      /* storage unavailable */
    }
    if (PLATFORM === 'ios') void setAppIcon(logo);
    else native?.setLogo?.(logo);
  }, [loaded, settings.appearance.logo]);
  // the last tab is remembered, so a reload of the page (iOS frees memory in the background)
  // comes back to the same tab instead of the home screen
  const [tab, setTab] = useState<Tab>(() => {
    const h = location.hash.slice(1);
    if (isTab(h)) return h;
    try {
      const last = sessionStorage.getItem(LAST_TAB) ?? '';
      if (isTab(last) && last !== 'scan') return last;
    } catch {
      /* storage unavailable */
    }
    return 'home';
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(LAST_TAB, tab);
    } catch {
      /* storage unavailable */
    }
  }, [tab]);
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
  // "Trang chủ" in the tab bar returns to the scan you were on (it stays alive in the background)
  const [homeView, setHomeView] = useState<'home' | 'scan'>('home');
  const goHome = () => go(homeView === 'scan' && scanSrcRef.current ? 'scan' : 'home');

  // iPhone: an image from the Shortcuts action (AssistiveTouch → Take Screenshot → LingoLens)
  const [scanSrc, setScanSrc] = useState<string | null>(null);
  const scanSrcRef = { current: scanSrc };
  useEffect(() => {
    if (tab === 'scan') setHomeView('scan');
  }, [tab]);
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
  /** Uploaded file: an image opens the scan screen, a text file (.txt, subtitles…) is analysed in Tra cứu. */
  const [uploadError, setUploadError] = useState('');
  const scanFile = (file: File) => {
    setUploadError('');
    if (/^text\//.test(file.type) || /\.(txt|md|srt|vtt|csv)$/i.test(file.name)) {
      void file.text().then((t) => {
        const text = t.replace(/^\uFEFF/, '').trim().slice(0, 6000);
        if (text) openLookup(text);
        else setUploadError('Tệp không có chữ.');
      });
      return;
    }
    if (!file.type.startsWith('image/') && !/\.(png|jpe?g|heic|heif|webp|gif|bmp)$/i.test(file.name)) {
      setUploadError(`Chưa hỗ trợ loại tệp này (${file.name}). Hãy chọn ảnh (PNG, JPG, HEIC…) hoặc tệp chữ (.txt).`);
      return;
    }
    setScanSrc(URL.createObjectURL(file));
    go('scan');
  };

  return (
    <div className="flex min-h-[calc(100dvh-env(safe-area-inset-top))] flex-col text-text" style={{ zoom: SCALE[settings.appearance.uiScale] ?? 1 }} data-ml-app="">
      <main className="min-h-0 flex-1 pb-[calc(100px+env(safe-area-inset-bottom))]">
        {(tab === 'home' || (tab === 'scan' && !scanSrc)) &&
          (PLATFORM === 'ios' ? <IosHome onOpen={go} onFile={scanFile} onResumeScan={scanSrc ? () => go('scan') : undefined} pack={pack} uploadError={uploadError} /> : <Home onOpen={go} />)}
        {/* kept mounted while you look words up in other tabs, so the result is still there when you come back */}
        {scanSrc && (
          <div hidden={tab !== 'scan'}>
            <Scan
              src={scanSrc}
              onNewFile={scanFile}
              onBack={() => {
                setHomeView('home');
                go('home');
              }}
            />
          </div>
        )}
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
        <GlassIndicator activeKey={tab === 'scan' ? 'home' : tab} className="rounded-[26px]" />
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            {...fastTap(() => (t.id === 'home' ? goHome() : go(t.id)))}
            data-ml-active={tab === t.id || (tab === 'scan' && t.id === 'home')}
            className={cx('ml-press relative z-[1] flex flex-col items-center gap-0.5 rounded-[26px] border border-transparent py-1.5 text-[12px] font-semibold', tab === t.id || (tab === 'scan' && t.id === 'home') ? 'ml-sel-text' : 'text-muted')}
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
        <IconLogo size={52} className="ml-float" />
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
function IosHome({
  onOpen,
  onFile,
  onResumeScan,
  pack,
  uploadError,
}: {
  onOpen: (t: Tab) => void;
  onFile: (f: File) => void;
  onResumeScan?: () => void;
  pack: ReturnType<typeof useTranslationPack>;
  uploadError?: string;
}) {
  useSettings('page'); // applies the theme
  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 pt-6" data-ml-ios-home="">
      <div className="flex items-center gap-3">
        <IconLogo size={52} className="ml-float" />
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">LingoLens</h1>
          <div className="text-[13px] text-muted">Trợ lý đọc tiếng Anh · iPhone</div>
        </div>
      </div>

      {onResumeScan && (
        <button type="button" onClick={onResumeScan} data-ml-magnetic="" className="ml-btn-primary ml-press ml-ripple ml-sheen flex w-full items-center gap-3 rounded-[24px] px-4 py-3.5 text-left" data-ml-resume-scan="">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/25 ring-1 ring-white/40">
            <IconScan size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-bold">Quay lại bản quét vừa rồi</span>
            <span className="block text-[12.5px] opacity-85">Ảnh và kết quả dịch vẫn còn</span>
          </span>
          <span className="text-[22px] leading-none opacity-90">›</span>
        </button>
      )}

      {pack.status === 'download' && (
        <div className="ml-glass flex items-center gap-3 rounded-[24px] px-4 py-3" data-ml-pack="">
          <span className="text-[24px]">🌐</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold">Tải gói dịch tiếng Việt</span>
            <span className="block text-[12px] leading-snug text-muted">Tải một lần (Apple Dịch, chạy trên máy) để lần quét đầu tiên dịch được ngay.</span>
          </span>
          <button type="button" disabled={pack.busy} onClick={() => void pack.download()} className="ml-btn-primary ml-press shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold disabled:opacity-50">
            {pack.busy ? 'Đang tải…' : 'Tải'}
          </button>
        </div>
      )}

      <div className="ml-glass space-y-2 rounded-[28px] p-5">
        <div className="text-[17px] font-bold">Quét chữ trong ảnh</div>
        <div className="text-[13px] text-muted">Chọn ảnh chụp màn hình trang truyện, kéo khung vào bong bóng (hoặc một câu, một từ) rồi quét. Nhận dạng chữ chạy trên máy.</div>
        <label data-ml-magnetic="" className="ml-press ml-btn-primary ml-sheen ml-ripple mt-1 inline-flex cursor-pointer items-center gap-1.5 rounded-full px-4 py-2 text-[14px] font-semibold">
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
        {/* any file from the Files app / iCloud / other apps: images → scan, text files → Tra cứu */}
        <label className="ml-press ml-glass-card ml-ripple ml-2 mt-1 inline-flex cursor-pointer items-center gap-1.5 rounded-full px-4 py-2 text-[14px] font-semibold" data-ml-upload="">
          📎 Tải tệp lên
          <input
            type="file"
            accept="image/*,.heic,.heif,.txt,.md,.srt,.vtt,text/plain"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = '';
            }}
          />
        </label>
        <div className="text-[11.5px] text-subtle">Tải tệp lên: ảnh (PNG, JPG, HEIC…) để quét, hoặc tệp chữ (.txt, phụ đề .srt) để dịch.</div>
        {uploadError && <div className="rounded-xl border border-warn/35 bg-warn/10 px-3 py-2 text-[12.5px] text-text">⚠️ {uploadError}</div>}
      </div>

      <IosGuide />

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
