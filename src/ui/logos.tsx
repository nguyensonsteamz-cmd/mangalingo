/**
 * LingoLens logos – one definition (64×64 SVG paths) used everywhere: in the UI (SVG), the Chrome
 * toolbar icon (Path2D in the service worker), the Android launcher icons (vector drawables) and
 * the iPhone app icons (PNG rendered by scripts/make-logo-assets.mjs). Chosen in Settings → Giao diện.
 */
import { useEffect, useState } from 'react';
import { logoById, type LogoId } from './logo-data';

export { LOGOS, logoById, drawLogo, type LogoId, type LogoDef } from './logo-data';

/** The logo as an SVG tile (rounded square like an app icon). */
export function LogoMark({ id, size = 24, className, tile = true }: { id?: string; size?: number; className?: string; tile?: boolean }) {
  const logo = logoById(id);
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true" data-ml-logo={logo.id}>
      {tile && <rect width="64" height="64" rx="15" fill={logo.bg} />}
      {logo.paths.map((p, i) => (
        <path key={i} d={p.d} fill={p.fill} fillRule={p.rule ?? 'nonzero'} />
      ))}
    </svg>
  );
}

/** Current logo from the settings (live). Works in every extension / app context with chrome.storage. */
export function useLogoId(): LogoId {
  const [id, setId] = useState<LogoId>('lens');
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
