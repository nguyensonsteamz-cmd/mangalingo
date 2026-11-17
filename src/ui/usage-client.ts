/** UI side of the translation quota module: live snapshot + actions (everything goes through the background / in-app router). */
import { useCallback, useEffect, useState } from 'react';
import { send } from '@/shared/messages';
import type { UsageSettings, UsageSnapshot } from '@/modules/usage/types';
import { invalidateGoogleActive } from '@/translation/chrome-mt';
import { getSmartSetup } from '@/ui/smart-setup-client';
import type { SetupError } from '@/modules/smart-setup';

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

import { authorizePaidWithBillingCheck } from './billing-gate';

/** Opens Settings → Billing wherever the caller lives (options page, side panel / in-page popup, phone app). */
export function openBillingPage() {
  const loc = globalThis.location;
  if (document.documentElement.dataset.app === 'mobile') {
    (globalThis as { __mlNextSettingsSection?: string }).__mlNextSettingsSection = 'billing';
    window.dispatchEvent(new Event('ml-settings-section'));
    loc.hash = 'settings';
  } else if (loc.protocol === 'chrome-extension:' && loc.pathname.includes('/options/')) {
    loc.hash = 'billing';
  } else {
    void send({ type: 'options:open', section: 'billing' }).catch(() => {});
  }
}

/** Authorises paid translation after checking billing; sends the user to the Billing page when it is not set up. */
export const authorizePaid = () =>
  authorizePaidWithBillingCheck({
    validateSaved: () => send({ type: 'usage:validate-saved' }),
    authorize: () => usageActions.authorize(true),
    openBilling: openBillingPage,
  });

export type AccountRefresh = { ok: true; chars: number } | { ok: false; reason: 'no-session' | 'no-project' | 'no-metric' | 'error'; error?: SetupError; byMetric?: Record<string, number> };

/**
 * Reads this month's characters as Google counts them for the whole project (every platform using the account), and stores them as the
 * base of the ledger. `interactive: false` only uses a Google session the browser already has (never opens a window).
 */
export async function refreshAccountUsage(opts: { interactive: boolean }): Promise<AccountRefresh> {
  const flow = getSmartSetup();
  try {
    if (!flow.hasSession) {
      const st = await flow.connectSilent();
      if (!st) {
        if (!opts.interactive) return { ok: false, reason: 'no-session' };
        await flow.connect();
      }
    }
    const u = await flow.fetchAccountUsage();
    if (u.chars === null) return { ok: false, reason: 'no-metric', byMetric: u.byMetric };
    await send({ type: 'usage:set-account', chars: u.chars, month: u.month, credentialId: u.projectId });
    return { ok: true, chars: u.chars };
  } catch (e) {
    const err = e as SetupError;
    return { ok: false, reason: err.code === 'PROJECT_NOT_FOUND' ? 'no-project' : 'error', error: err };
  }
}
