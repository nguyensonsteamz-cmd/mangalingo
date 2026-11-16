/**
 * First-use sign-in state. LingoLens has no account system of its own: "signing in" = Google OAuth through Smart Setup (the user's own
 * Google Cloud project pays for Google translation). The state is one small record in chrome.storage.local, readable from every
 * page of the extension (the content script included, which cannot call chrome.identity itself).
 *   signedIn : the Google sign-in completed on this device
 *   skipped  : the build has no OAuth client id yet, so sign-in is impossible; the user continued (temporary, shown as a notice)
 * Users who already have a Google key configured before this feature existed are let through without being asked again.
 */
import { useEffect, useState } from 'react';
import { send } from '@/shared/messages';

export const AUTH_KEY = 'auth:v1';
export interface AuthRecord {
  signedIn?: boolean;
  skipped?: boolean;
  account?: string;
  at?: number;
}

export async function readAuth(): Promise<AuthRecord> {
  try {
    const r = await chrome.storage.local.get(AUTH_KEY);
    return (r[AUTH_KEY] as AuthRecord | undefined) ?? {};
  } catch {
    return {};
  }
}
export async function writeAuth(patch: AuthRecord): Promise<void> {
  const cur = await readAuth();
  await chrome.storage.local.set({ [AUTH_KEY]: { ...cur, ...patch, at: Date.now() } });
}
export async function clearAuth(): Promise<void> {
  await chrome.storage.local.remove(AUTH_KEY);
}

/** Pure rule (unit-tested): who may use the app. */
export function isUnlocked(a: AuthRecord, hasGoogleKey: boolean): boolean {
  return !!a.signedIn || !!a.skipped || hasGoogleKey;
}

export type GateState = 'loading' | 'open' | 'locked';

/** Live gate state for any page. In the content script (no router access to the key) the stored record alone decides. */
export function useGate(opts: { checkKey?: boolean } = { checkKey: true }): GateState {
  const [state, setState] = useState<GateState>('loading');
  useEffect(() => {
    let alive = true;
    const compute = async () => {
      const a = await readAuth();
      let key = false;
      if (opts.checkKey !== false && !a.signedIn && !a.skipped) key = await send({ type: 'usage:snapshot' }).then((s) => s.hasKey, () => false);
      if (alive) setState(isUnlocked(a, key) ? 'open' : 'locked');
    };
    void compute();
    const on = (c: Record<string, chrome.storage.StorageChange>, area: string) => area === 'local' && AUTH_KEY in c && void compute();
    chrome.storage.onChanged.addListener(on);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(on);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return state;
}
