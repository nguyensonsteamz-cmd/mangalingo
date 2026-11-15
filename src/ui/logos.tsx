/**
 * LingoLens logos – one canvas renderer (logo-data.ts) used everywhere: in the UI (<canvas>), the
 * Chrome toolbar icon (OffscreenCanvas in the service worker) and the Android / iPhone app icons
 * (PNGs rendered by scripts/make-logo-assets.mjs). Chosen in Settings → Giao diện.
 */
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_LOGO, drawLogo, logoById, type LogoId } from './logo-data';

export { LOGOS, DEFAULT_LOGO, logoById, drawLogo, type LogoId, type LogoDef } from './logo-data';

/** The logo as a rounded app-icon tile, drawn sharp for the screen's pixel density. */
export function LogoMark({ id, size = 24, className }: { id?: string; size?: number; className?: string }) {
  const logo = logoById(id);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const px = Math.round(size * Math.min(3, Math.max(1, globalThis.devicePixelRatio || 1)));
    c.width = px;
    c.height = px;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, px, px);
    drawLogo(ctx, logo.id, px);
  }, [logo.id, size]);
  return <canvas ref={ref} width={size} height={size} style={{ width: size, height: size }} className={className} aria-hidden="true" data-ml-logo={logo.id} />;
}

/** Current logo from the settings (live). Works in every extension / app context with chrome.storage. */
export function useLogoId(): LogoId {
  const [id, setId] = useState<LogoId>(DEFAULT_LOGO);
  useEffect(() => {
    let alive = true;
    const g = globalThis as { chrome?: typeof chrome };
    const area = g.chrome?.storage?.local;
    if (!area) return;
    const read = (v: unknown) => {
      const logo = (v as { appearance?: { logo?: string } } | undefined)?.appearance?.logo;
      if (alive) setId(logoById(logo).id);
    };
    void Promise.resolve(area.get('settings:v1')).then((r) => read((r as Record<string, unknown>)['settings:v1']));
    const on = (changes: Record<string, chrome.storage.StorageChange>, name: string) => {
      if (name === 'local' && 'settings:v1' in changes) read(changes['settings:v1'].newValue);
    };
    g.chrome!.storage.onChanged.addListener(on);
    return () => {
      alive = false;
      g.chrome!.storage.onChanged.removeListener(on);
    };
  }, []);
  return id;
}

/** The app's logo, following the setting. */
export function AppLogo({ size = 24, className }: { size?: number; className?: string }) {
  return <LogoMark id={useLogoId()} size={size} className={className} />;
}
