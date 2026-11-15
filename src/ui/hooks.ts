import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, mergeSettings, type DeepPartial, type Settings } from '@/shared/settings';
import { chromeLocal } from '@/storage/kv';
import { SettingsStore } from '@/storage/settings-store';
import { applyPageTheme } from './theme';

export const settingsStore = new SettingsStore(chromeLocal());

/**
 * Settings for extension pages: optimistic local updates, debounced persistence and live sync
 * with changes made in other contexts. Also applies theme variables to <html>.
 */
export function useSettings(surface: 'sidebar' | 'page') {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const pending = useRef<DeepPartial<Settings>>({});
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    void settingsStore.load().then((s) => {
      setSettings(s);
      setLoaded(true);
    });
    return settingsStore.subscribe((s) => setSettings(s));
  }, []);

  useEffect(() => {
    applyPageTheme(settings, surface);
    if (settings.appearance.theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => applyPageTheme(settings, surface);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [settings, surface]);

  const update = useCallback((patch: DeepPartial<Settings>) => {
    setSettings((cur) => mergeSettings(cur, patch));
    const merge = (a: Record<string, unknown>, b: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(b)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) a[k] = merge((a[k] as Record<string, unknown>) ?? {}, v as Record<string, unknown>);
        else a[k] = v;
      }
      return a;
    };
    pending.current = merge(pending.current as Record<string, unknown>, patch as Record<string, unknown>) as DeepPartial<Settings>;
    clearTimeout(timer.current);
    setSaveState('saving');
    timer.current = setTimeout(() => {
      const p = pending.current;
      pending.current = {};
      settingsStore
        .update(p)
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('error'));
    }, 180);
  }, []);

  const reset = useCallback(async () => {
    clearTimeout(timer.current);
    pending.current = {};
    setSettings(await settingsStore.reset());
    setSaveState('saved');
  }, []);

  return { settings, update, reset, loaded, saveState };
}

export function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function readFile(file: File): Promise<string> {
  return file.text();
}

export const stamp = () => new Date().toISOString().slice(0, 10);
