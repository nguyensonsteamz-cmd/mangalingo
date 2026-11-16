/** UI side of the translation quota module: live snapshot + actions (everything goes through the background / in-app router). */
import { useCallback, useEffect, useState } from 'react';
import { send } from '@/shared/messages';
import type { UsageSettings, UsageSnapshot } from '@/modules/usage/types';
import { invalidateGoogleActive } from '@/translation/chrome-mt';

/** The usage snapshot, refreshed when the usage data in storage changes (any tab / the sidebar / the app). */
export function useUsage(): { snap: UsageSnapshot | null; error: string; refresh: () => Promise<void> } {
  const [snap, setSnap] = useState<UsageSnapshot | null>(null);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      setSnap(await send({ type: 'usage:snapshot' }));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const on = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && Object.keys(changes).some((k) => k.startsWith('usage:') && k !== 'usage:cache:v1')) void refresh();
    };
    chrome.storage.onChanged.addListener(on);
    return () => chrome.storage.onChanged.removeListener(on);
  }, [refresh]);
  return { snap, error, refresh };
}

export const usageActions = {
  async settings(patch?: Partial<UsageSettings>, apiKey?: string | null) {
    const s = await send({ type: 'usage:settings', patch, apiKey });
    invalidateGoogleActive();
    return s;
  },
  async authorize(enable: boolean) {
    const s = await send({ type: 'usage:authorize', enable });
    invalidateGoogleActive();
    return s;
  },
  clearHistory: () => send({ type: 'usage:clear-history' }),
  reset: () => send({ type: 'usage:reset' }),
  exportReport: (format: 'json' | 'csv') => send({ type: 'usage:export', format }),
};

export const fmtInt = (n: number) => Math.round(n).toLocaleString('vi-VN');
export const fmtUsd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: n < 0.1 ? 4 : 2, maximumFractionDigits: n < 0.1 ? 4 : 2 })}`;
export const fmtPct = (r: number) => `${(r * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`;
/** "2026-03-01" -> "01/03/2026" */
export const fmtDate = (iso: string) => iso.split('-').reverse().join('/');
