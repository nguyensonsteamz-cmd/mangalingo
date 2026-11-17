/**
 * Google OAuth, per platform. The access token is used only during setup (list / create projects, enable APIs,
 * create the key) and is revoked + dropped at the end: it is never written to storage.
 * No client secret exists in any of these flows (extension-, iOS- and Android-type clients are public clients).
 */
import { SetupError } from './errors';

/** cloud-platform: the narrowest scope covering Resource Manager, Service Usage, API Keys and Billing reads. `email` only labels the account. */
export const OAUTH_SCOPES = ['https://www.googleapis.com/auth/cloud-platform', 'email'];

export interface OAuthSession {
  accessToken: string;
  /** epoch ms, when known */
  expiresAt?: number;
}

export interface OAuthProvider {
  readonly id: 'chrome' | 'ios' | 'android' | 'test';
  /** Is a client ID present in this build? (public identifier, injected at build time) */
  configured(): Promise<boolean>;
  signIn(): Promise<OAuthSession>;
  /** A token the browser already holds (access was granted before): no window, never prompts. Null when there is none. */
  silent?(): Promise<OAuthSession | null>;
  /** Revokes the token at Google and forgets it locally. Best effort. */
  signOut(token: string): Promise<void>;
}

const revoke = async (token: string) => {
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  } catch {
    /* offline: the token expires by itself within an hour */
  }
};

interface ChromeIdentity {
  getAuthToken(d: { interactive: boolean; scopes?: string[] }): Promise<string | { token?: string }> | void;
  removeCachedAuthToken(d: { token: string }): Promise<void> | void;
}
interface ChromeLike {
  identity?: ChromeIdentity;
  runtime?: { getManifest?: () => { oauth2?: { client_id?: string } } };
}

/** Chrome: chrome.identity.getAuthToken with an extension-type OAuth client (declared in the manifest at build time). */
export function chromeIdentityProvider(api: ChromeLike | undefined = (globalThis as { chrome?: ChromeLike }).chrome): OAuthProvider {
  return {
    id: 'chrome',
    async configured() {
      const id = api?.runtime?.getManifest?.().oauth2?.client_id ?? '';
      return !!api?.identity?.getAuthToken && !!id && !/YOUR_|placeholder/i.test(id);
    },
    async silent() {
      if (!(await this.configured())) return null;
      try {
        const r = await new Promise<string | { token?: string } | undefined>((resolve, reject) => {
          const done = (res: string | { token?: string } | undefined) => {
            const err = (globalThis as { chrome?: { runtime?: { lastError?: { message?: string } } } }).chrome?.runtime?.lastError;
            if (err) reject(new Error(err.message));
            else resolve(res);
          };
          const p = (api!.identity!.getAuthToken as unknown as (d: unknown, cb: (r: string | { token?: string } | undefined) => void) => Promise<string | { token?: string }> | void)({ interactive: false, scopes: OAUTH_SCOPES }, done);
          if (p && typeof (p as Promise<unknown>).then === 'function') (p as Promise<string | { token?: string }>).then(resolve, reject);
        });
        const token = typeof r === 'string' ? r : r?.token;
        return token ? { accessToken: token, expiresAt: Date.now() + 55 * 60_000 } : null;
      } catch {
        return null;
      }
    },
    async signIn() {
      if (!(await this.configured())) throw new SetupError('OAUTH_NOT_CONFIGURED');
      try {
        const r = await new Promise<string | { token?: string } | undefined>((resolve, reject) => {
          const done = (res: string | { token?: string } | undefined) => {
            const err = (globalThis as { chrome?: { runtime?: { lastError?: { message?: string } } } }).chrome?.runtime?.lastError;
            if (err) reject(new Error(err.message));
            else resolve(res);
          };
          const p = (api!.identity!.getAuthToken as unknown as (d: unknown, cb: (r: string | { token?: string } | undefined) => void) => Promise<string | { token?: string }> | void)({ interactive: true, scopes: OAUTH_SCOPES }, done);
          if (p && typeof (p as Promise<unknown>).then === 'function') (p as Promise<string | { token?: string }>).then(resolve, reject);
        });
        const token = typeof r === 'string' ? r : r?.token;
        if (!token) throw new Error('no token');
        return { accessToken: token, expiresAt: Date.now() + 55 * 60_000 };
      } catch (e) {
        throw new SetupError('GOOGLE_AUTH_FAILED', String((e as Error)?.message ?? e).slice(0, 200));
      }
    },
    async signOut(token) {
      try {
        await api?.identity?.removeCachedAuthToken({ token });
      } catch {
        /* ignore */
      }
      await revoke(token);
    },
  };
}

/** What the native shells expose (iOS: ASWebAuthenticationSession + PKCE; Android: system browser + PKCE). */
export interface NativeOAuthBridge {
  configured(): Promise<boolean>;
  start(scopes: string[]): Promise<{ accessToken: string; expiresIn?: number }>;
  revoke(token: string): Promise<void>;
}

export function nativeOAuthProvider(id: 'ios' | 'android', b: NativeOAuthBridge): OAuthProvider {
  return {
    id,
    configured: () => b.configured().catch(() => false),
    async signIn() {
      if (!(await b.configured().catch(() => false))) throw new SetupError('OAUTH_NOT_CONFIGURED');
      try {
        const r = await b.start(OAUTH_SCOPES);
        if (!r?.accessToken) throw new Error('no token');
        return { accessToken: r.accessToken, expiresAt: Date.now() + (r.expiresIn ?? 3300) * 1000 };
      } catch (e) {
        throw new SetupError('GOOGLE_AUTH_FAILED', String((e as Error)?.message ?? e).slice(0, 200));
      }
    },
    async signOut(token) {
      await b.revoke(token).catch(() => {});
    },
  };
}
