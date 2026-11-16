/**
 * Native pieces of Smart Setup for the phone apps, reached through the existing bridges:
 *   iPhone  – Keychain, ASWebAuthenticationSession (PKCE), Safari for Console links
 *   Android – Android Keystore, system-browser sign-in (PKCE), openUrl
 * Where neither exists (a normal browser) the secure store falls back to the non-extractable WebCrypto store.
 */
import type { KV } from '@/storage/kv';
import { NativeSecretStore, WebCryptoSecretStore, idbKeyStorage, nativeOAuthProvider, type NativeOAuthBridge, type NativeSecretApi, type OAuthProvider, type SecretStore } from '@/modules/smart-setup';
import { iosBridge, iosPost } from './ios';
import { native } from './native';

const iosSecrets: NativeSecretApi = {
  get: async (name) => ((await iosPost({ cmd: 'secretGet', name })) as { value?: string | null } | null)?.value ?? null,
  set: async (name, value) => void (await iosPost({ cmd: 'secretSet', name, value })),
  remove: async (name) => void (await iosPost({ cmd: 'secretRemove', name })),
};

const androidSecrets: NativeSecretApi = {
  get: async (name) => {
    const v = native?.secretGet?.(name) ?? '';
    return v || null;
  },
  set: async (name, value) => void native?.secretSet?.(name, value),
  remove: async (name) => void native?.secretRemove?.(name),
};

/** The platform's secure store for the API key. */
export function createMobileSecretStore(kv: KV): SecretStore {
  if (iosBridge()) return new NativeSecretStore('keychain', iosSecrets);
  if (native?.secretGet) return new NativeSecretStore('keystore', androidSecrets);
  return new WebCryptoSecretStore(kv, idbKeyStorage());
}

// ---- Android sign-in answers (window.__mlOAuth(id, ok, json))
let seq = 0;
const pending = new Map<number, { ok: (v: { accessToken: string; expiresIn?: number }) => void; fail: (e: Error) => void }>();
(globalThis as { __mlOAuth?: (id: number, ok: boolean, payload: string) => void }).__mlOAuth = (id, ok, payload) => {
  const p = pending.get(id);
  pending.delete(id);
  if (!p) return;
  if (ok) {
    try {
      p.ok(JSON.parse(payload));
    } catch {
      p.fail(new Error('bad token response'));
    }
  } else p.fail(new Error(payload || 'sign-in failed'));
};

const iosOAuth: NativeOAuthBridge = {
  configured: async () => !!((await iosPost({ cmd: 'oauthConfigured' })) as { configured?: boolean } | null)?.configured,
  start: async (scopes) => (await iosPost({ cmd: 'oauthStart', scopes })) as { accessToken: string; expiresIn?: number },
  revoke: async (token) => void (await iosPost({ cmd: 'oauthRevoke', token })),
};

const androidOAuth: NativeOAuthBridge = {
  configured: async () => !!native?.oauthConfigured?.(),
  start: (scopes) =>
    new Promise((ok, fail) => {
      if (!native?.oauthStart) return fail(new Error('unavailable'));
      const id = ++seq;
      pending.set(id, { ok, fail });
      native.oauthStart(id, scopes.join(' '));
    }),
  revoke: async (token) => void native?.oauthRevoke?.(token),
};

/** The phone's Google sign-in, or null when this build is not a phone app. */
export function mobileOAuthProvider(): OAuthProvider | null {
  if (iosBridge()) return nativeOAuthProvider('ios', iosOAuth);
  if (native?.oauthStart) return nativeOAuthProvider('android', androidOAuth);
  return null;
}

/** Opens a Google Cloud Console page in the system browser (never inside our own WebView). */
export function openExternalMobile(url: string): boolean {
  if (iosBridge()) {
    void iosPost({ cmd: 'openUrl', url }).catch(() => {});
    return true;
  }
  if (native?.openUrl) {
    native.openUrl(url);
    return true;
  }
  return false;
}
