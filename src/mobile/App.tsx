/**
 * LingoLens phone app UI (inside the app's WebView). Android: Home with the on/off switch for the
 * floating button. iPhone: Home with the AssistiveTouch + Shortcuts setup and the scan screen.
 * Both: Lookup (the extension's sidebar), Vocabulary notebook, Settings (the extension's Settings
 * Center).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SettingsCenter } from '@/options/SettingsCenter';
import { SidePanel } from '@/sidepanel/SidePanel';
import { VocabManager } from '@/ui/VocabManager';
import { useSettings } from '@/ui/hooks';
import { cx, fastTap, GlassIndicator, Notice } from '@/ui/components';
import { IconBack, IconBookmark, IconGear, IconLogo, IconScan, IconSearch } from '@/ui/icons';
import { native, onResume } from './native';
import { useUsage } from '@/ui/usage-client';
import { latestScanUrl, openReader, pendingScanStamp, prepareTranslationPack, setAppIcon, translationPackStatus } from './ios';
import { Scan, type HlBox } from './Scan';
import { Assist, type AssistItem } from './Assist';
import { NotesDrawer } from '@/ui/NotesDrawer';
import { TextReader, type TextRange } from './TextReader';
import { renderPdf } from './pdf';
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
 * ONLY when the translation source is the phone itself (`provider === 'device'`): with Google Translate (web), the default, Apple's pack is
 * not used, so no system sheet appears and no card is shown.
 */
function useTranslationPack(provider: string | undefined) {
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
    if (PLATFORM !== 'ios' || provider !== 'device') {
      setStatus('unavailable');
      return;
    }
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
  }, [provider]);
  return { status, busy, download };
}
const SCALE = { small: 0.9, medium: 1, large: 1.15 } as const;

export function App() {
  const { settings, loaded } = useSettings('page');
  const { snap: usageSnap } = useUsage();
  const pack = useTranslationPack(usageSnap?.settings.provider);
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
      if (isTab(h))
        setTab((cur) => {
          if (cur !== h) prevTab.current = cur; // "‹" returns to the page you came from
          return h;
        });
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const prevTab = useRef<Tab>('home');
  const go = (t: Tab) => {
    if (t !== tab) prevTab.current = tab;
    setTab(t);
    history.replaceState(null, '', `#${t}`);
  };
  /** "‹" of a page: back to the tab you came from (home if none). */
  const back = () => go(prevTab.current !== tab ? prevTab.current : 'home');

  // iPhone: an image from the Shortcuts action (AssistiveTouch → Take Screenshot → LingoLens)
  // the open document on the scan page: page images (screenshot, photo, PDF pages) or a text file
  type Doc = { kind: 'pages'; pages: string[]; page: number; name: string } | { kind: 'text'; text: string; name: string };
  const [doc, setDoc] = useState<Doc | null>(null);
  const [opening, setOpening] = useState(''); // "Đang mở PDF… 3/12"
  const [highlightMode, setHighlightMode] = useState(false);
  const [hlBoxes, setHlBoxes] = useState<Record<string, HlBox[]>>({}); // per page image
  const [hlText, setHlText] = useState<TextRange[]>([]);
  const [notesOpen, setNotesOpen] = useState(false);
  const [noteContext, setNoteContext] = useState<string | undefined>(undefined);
  const openDoc = (d: Doc | null) => {
    setDoc(d);
    setHighlightMode(false);
    setHlBoxes({});
    setHlText([]);
  };
  useEffect(() => {
    if (PLATFORM !== 'ios') return;
    const open = (stamp: number) => {
      if (!stamp) return;
      try {
        localStorage.setItem(LAST_SCAN, String(stamp));
      } catch {
        /* storage unavailable */
      }
      openDoc({ kind: 'pages', pages: [latestScanUrl(stamp)], page: 0, name: 'Ảnh chụp màn hình' });
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
  /** Uploaded file: images and PDF pages open the scan screen, text files (.txt, subtitles…) the reader. */
  const [uploadError, setUploadError] = useState('');
  const scanFile = (file: File) => {
    setUploadError('');
    go('scan');
    if (/^text\//.test(file.type) || /\.(txt|md|srt|vtt|csv)$/i.test(file.name)) {
      void file.text().then((t) => {
        const text = t.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().slice(0, 200000);
        if (text) openDoc({ kind: 'text', text, name: file.name });
        else setUploadError('Tệp không có chữ.');
      });
      return;
    }
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      setOpening('Đang mở PDF…');
      void renderPdf(file, (done, total) => setOpening(`Đang mở PDF… ${done}/${total}`))
        .then((pages) => {
          if (pages.length) openDoc({ kind: 'pages', pages, page: 0, name: file.name });
          else setUploadError('PDF không có trang nào.');
        })
        .catch(() => setUploadError(`Không mở được PDF này (${file.name}). Tệp có thể bị khoá mật khẩu hoặc hỏng.`))
        .finally(() => setOpening(''));
      return;
    }
    if (!file.type.startsWith('image/') && !/\.(png|jpe?g|heic|heif|webp|gif|bmp)$/i.test(file.name)) {
      setUploadError(`Chưa hỗ trợ loại tệp này (${file.name}). Hãy chọn ảnh, PDF hoặc tệp chữ (.txt).`);
      return;
    }
    openDoc({ kind: 'pages', pages: [URL.createObjectURL(file)], page: 0, name: file.name });
  };
  // tools in the floating button of the scan page
  const notesItem: AssistItem = { id: 'notes', label: 'Ghi chú', icon: '✏️', onClick: () => setNotesOpen(true) };
  const hlItem: AssistItem = { id: 'highlight', label: highlightMode ? 'Tắt tô' : 'Tô sáng', icon: '🖍', active: highlightMode, onClick: () => setHighlightMode((v) => !v) };

  return (
    <div className="flex min-h-[calc(100dvh-env(safe-area-inset-top))] flex-col text-text" style={{ zoom: SCALE[settings.appearance.uiScale] ?? 1 }} data-ml-app="">
      <main className="min-h-0 flex-1 pb-[calc(104px+env(safe-area-inset-bottom))]">
        {tab === 'home' && (PLATFORM === 'ios' ? <IosHome onOpen={go} pack={pack} /> : <Home onOpen={go} />)}
        {/* the scan page: pick an image (or come from the Shortcut) → the scan screen */}
        {tab === 'scan' && !doc && (
          <>
            <ScanStart onFile={scanFile} uploadError={uploadError} opening={opening} />
            <Assist items={[notesItem]} />
          </>
        )}
        {/* kept mounted while you look words up in other tabs, so the result is still there when you come back */}
        {doc && (
          <div hidden={tab !== 'scan'}>
            {doc.kind === 'pages' ? (
              <Scan
                key={doc.pages[0]}
                src={doc.pages[doc.page]}
                title={doc.pages.length > 1 ? `${doc.name} · trang ${doc.page + 1}` : doc.name}
                onNewFile={scanFile}
                onBack={() => openDoc(null)}
                extraItems={[notesItem, hlItem]}
                highlightMode={highlightMode}
                highlights={hlBoxes[doc.pages[doc.page]] ?? []}
                onHighlights={(h) => setHlBoxes((x) => ({ ...x, [doc.pages[doc.page]]: h }))}
                onActiveText={setNoteContext}
                pager={{ page: doc.page, total: doc.pages.length, go: (p) => setDoc({ ...doc, page: Math.max(0, Math.min(doc.pages.length - 1, p)) }) }}
              />
            ) : (
              <>
                <TextReader name={doc.name} text={doc.text} highlightMode={highlightMode} highlights={hlText} onHighlights={setHlText} onBack={() => openDoc(null)} />
                <Assist items={[notesItem, hlItem]} />
              </>
            )}
          </div>
        )}
        {tab === 'scan' && <NotesDrawer open={notesOpen} onClose={() => setNotesOpen(false)} context={noteContext} />}
        {tab === 'lookup' && <SidePanel topBar={<AppBar title="Tra cứu" onBack={back} />} />}
        {tab === 'vocab' && (
          <>
            <AppBar title="Sổ từ vựng" onBack={back} sticky />
            <div className="px-3 py-3">
              <VocabManager />
            </div>
          </>
        )}
        {tab === 'settings' && <SettingsCenter hidden={['shortcuts']} topBar={<AppBar title="Cài đặt" onBack={back} />} />}
      </main>
      <TabBar ios={PLATFORM === 'ios'} tab={tab} go={go} />
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
function IosHome({ onOpen, pack }: { onOpen: (t: Tab) => void; pack: ReturnType<typeof useTranslationPack> }) {
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


      {/* the in-app browser: open a manga / English site and translate while reading */}
      <button type="button" onClick={() => void openReader()} className="ml-glass-card ml-press ml-sheen flex w-full items-center gap-3 rounded-[24px] px-4 py-3.5 text-left" data-ml-open-reader="">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent/15 text-[22px]">🌐</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold">Trình đọc web</span>
          <span className="block text-[12.5px] leading-snug text-muted">Mở trang truyện ngay trong ứng dụng, chạm từ hoặc chọn câu để dịch, quét chữ trong ảnh.</span>
        </span>
        <span className="text-[20px] text-muted">›</span>
      </button>

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

/**
 * Scan page (middle button of the tab bar), before an image is chosen: pick a photo or any file
 * (images → scan screen, text files → Tra cứu); the AssistiveTouch shortcut opens it directly.
 */
function ScanStart({ onFile, uploadError, opening }: { onFile: (f: File) => void; uploadError?: string; opening?: string }) {
  useSettings('page'); // applies the theme
  const pick = (accept: string, label: ReactNode, className: string, attr: Record<string, string>) => (
    <label className={cx('ml-press ml-ripple flex cursor-pointer items-center justify-center gap-2 rounded-[22px] py-4 text-[15.5px] font-bold', className)} {...attr}>
      {label}
      <input
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </label>
  );
  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 pt-6" data-ml-scan-start="">
      <div className="flex items-center gap-3">
        <span className="ml-btn-primary flex h-[52px] w-[52px] items-center justify-center rounded-[18px]">
          <IconScan size={26} />
        </span>
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Quét chữ</h1>
          <div className="text-[13px] text-muted">Ảnh truyện, ảnh chụp màn hình, tệp chữ</div>
        </div>
      </div>

      <div className="ml-glass space-y-3 rounded-[28px] p-5">
        <div className="text-[13.5px] leading-snug text-muted">
          Chọn ảnh rồi kéo khung vào bong bóng (một câu, một từ) hoặc quét cả trang. Nhận dạng chữ và dịch đều chạy trên máy.
        </div>
        {pick('image/*', <><IconScan size={20} /> Chọn ảnh để quét</>, 'ml-btn-primary ml-sheen', { 'data-ml-magnetic': '' })}
        {/* any file from the Files app / iCloud / other apps: images → scan, text files → Tra cứu */}
        {pick('image/*,.heic,.heif,.pdf,application/pdf,.txt,.md,.srt,.vtt,text/plain', <>📎 Tải tệp lên</>, 'ml-glass-card', { 'data-ml-upload': '' })}
        <div className="text-[11.5px] text-subtle">Tải tệp lên: ảnh (PNG, JPG, HEIC…), PDF, hoặc tệp chữ (.txt, phụ đề .srt). Có thể tô sáng và ghi chú khi đọc.</div>
        {opening && <div className="ml-glass-select rounded-xl border px-3 py-2 text-[13px] font-semibold">⏳ {opening}</div>}
        {uploadError && <div className="rounded-xl border border-warn/35 bg-warn/10 px-3 py-2 text-[12.5px] text-text">⚠️ {uploadError}</div>}
      </div>

      <div className="ml-glass-card flex items-start gap-3 rounded-[24px] p-4">
        <span className="text-[22px]">⚡️</span>
        <div className="text-[13px] leading-snug text-muted">
          <b className="text-text">Nhanh hơn khi đang đọc:</b> chạm hai lần vào nút nổi AssistiveTouch – iPhone chụp màn hình và mở thẳng trang này. Cách thiết lập có ở <b className="text-text">Trang chủ</b>.
        </div>
      </div>
    </div>
  );
}

/** Minimal top bar of a page: back button + page title (nothing else). */
function AppBar({ title, onBack, sticky }: { title: string; onBack: () => void; sticky?: boolean }) {
  return (
    <div className={cx('flex h-11 items-center gap-1 px-2', sticky && 'ml-glass-bar sticky top-0 z-10 border-b')} data-ml-app-bar="">
      <button type="button" onClick={onBack} className="ml-press flex h-9 w-9 items-center justify-center rounded-full text-muted" aria-label="Quay lại">
        <IconBack size={22} />
      </button>
      <div className="min-w-0 flex-1 truncate text-[15.5px] font-bold">{title}</div>
    </div>
  );
}

/**
 * Bottom tab bar. On the iPhone the bar's top edge rises into a smooth hill above the middle (scan)
 * button: the bar and the hill are ONE glass shape (clip-path), outlined by an SVG stroke, and the
 * selection pill grows taller and higher when it moves onto that button.
 */
const BAR_H = 66;
const RISE = 18; // height of the hill above the bar
const HALF = 46; // half width of the hill
function barPath(w: number, hill: boolean) {
  const r = 30;
  const y0 = RISE; // the shape's box starts RISE px above the bar
  const cx = w / 2;
  let d = `M ${r} ${y0}`;
  if (hill) d += ` L ${cx - HALF} ${y0} C ${cx - HALF * 0.5} ${y0} ${cx - HALF * 0.5} 0 ${cx} 0 C ${cx + HALF * 0.5} 0 ${cx + HALF * 0.5} ${y0} ${cx + HALF} ${y0}`;
  d += ` L ${w - r} ${y0} A ${r} ${r} 0 0 1 ${w} ${y0 + r} L ${w} ${y0 + BAR_H - r} A ${r} ${r} 0 0 1 ${w - r} ${y0 + BAR_H} L ${r} ${y0 + BAR_H} A ${r} ${r} 0 0 1 0 ${y0 + BAR_H - r} L 0 ${y0 + r} A ${r} ${r} 0 0 1 ${r} ${y0} Z`;
  return d;
}

function TabBar({ ios, tab, go }: { ios: boolean; tab: Tab; go: (t: Tab) => void }) {
  const ref = useRef<HTMLElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const d = w ? barPath(w, ios) : '';
  const item = (t: (typeof TABS)[number]) => (
    <button
      key={t.id}
      type="button"
      {...fastTap(() => go(t.id))}
      data-ml-active={tab === t.id}
      className={cx('ml-press relative z-[1] flex flex-col items-center gap-0.5 rounded-[26px] border border-transparent py-1.5 text-[11.5px] font-semibold', tab === t.id ? 'ml-sel-text' : 'text-muted')}
      aria-current={tab === t.id ? 'page' : undefined}
    >
      <span className="px-3 py-0.5">{t.icon}</span>
      {t.label}
    </button>
  );
  return (
    <nav ref={ref} className="fixed inset-x-3 bottom-[max(10px,env(safe-area-inset-bottom))] z-20" style={{ height: BAR_H }} data-ml-app-nav="">
      {/* depth (the bar body) */}
      <div className="absolute inset-0 rounded-[30px]" style={{ boxShadow: 'var(--ml-glass-shadow)' }} aria-hidden="true" />
      {/* one glass shape: the bar with its hill */}
      <div className="ml-glass-shape absolute inset-x-0 bottom-0" style={{ top: -RISE, clipPath: d ? `path("${d}")` : undefined }} aria-hidden="true" />
      {d && (
        <svg className="pointer-events-none absolute inset-x-0 bottom-0 overflow-visible" style={{ top: -RISE }} width={w} height={BAR_H + RISE} viewBox={`0 0 ${w} ${BAR_H + RISE}`} aria-hidden="true">
          <path d={d} fill="none" stroke="rgb(255 255 255 / calc(var(--ml-glass-hi) * 0.55))" strokeWidth="1" transform="translate(0 1)" />
          <path d={d} fill="none" stroke="rgb(var(--ml-glass-edge) / var(--ml-glass-edge-a))" strokeWidth="1" />
        </svg>
      )}
      <div className={cx('relative grid h-full p-1', ios ? 'grid-cols-5' : 'grid-cols-4')}>
        <GlassIndicator activeKey={tab} className="rounded-[26px]" />
        {TABS.flatMap((t, i) => {
          if (!ios || i !== 1) return [item(t)];
          return [
            item(t),
            // the scan tab: same bar background, a taller cell that reaches up into the hill – the
            // selection pill follows this size, so it bulges upwards when it lands here
            <div key="scan" className="flex justify-center">
              <button
                type="button"
                {...fastTap(() => go('scan'))}
                data-ml-active={tab === 'scan'}
                className={cx('ml-press ml-ripple relative z-[1] -mt-[14px] flex h-[72px] w-[58px] flex-col items-center justify-center gap-0.5 rounded-[26px] border border-transparent text-[11.5px] font-semibold', tab === 'scan' ? 'ml-sel-text' : 'text-muted')}
                aria-label="Quét chữ trong ảnh"
                aria-current={tab === 'scan' ? 'page' : undefined}
                data-ml-scan-tab=""
              >
                <span className={cx('-mt-0.5', tab !== 'scan' && 'text-accent')}>
                  <IconScan size={26} />
                </span>
                Quét
              </button>
            </div>,
          ];
        })}
      </div>
    </nav>
  );
}
