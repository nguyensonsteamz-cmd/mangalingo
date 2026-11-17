/**
 * Lingolens Smart Setup: connect Google -> project -> billing -> APIs -> API key -> validate -> save & activate.
 * Pure business logic shared by Chrome, iPhone and Android. Every step can be retried on its own; the persisted
 * state holds NO secrets (the OAuth token lives in memory for this session, the key goes to the SecretStore through
 * `deps.activate`). Billing is only READ, never created or linked.
 */
import type { KV } from '@/storage/kv';
import { SetupError, type SetupErrorCode } from './errors';
import { APIKEYS_SERVICE, GoogleCloudClient, LINGOLENS_KEY_NAME, TRANSLATE_SERVICE, type ProjectInfo } from './google-cloud';
import type { OAuthProvider } from './oauth';

export type SetupStep = 'intro' | 'connect' | 'project' | 'billing' | 'api' | 'key' | 'validate' | 'done';
export const STEP_ORDER: SetupStep[] = ['intro', 'connect', 'project', 'billing', 'api', 'key', 'validate', 'done'];

export interface SetupState {
  version: 1;
  step: SetupStep;
  /** Google account the setup was made with (label only). */
  account?: string;
  project?: { id: string; name: string };
  billing?: { enabled: boolean; checkedAt: number };
  apis?: { translate: boolean; apikeys: boolean };
  /** The key Lingolens created: name at Google + last 4 characters. The key itself is never in this state. */
  key?: { name: string; hint: string; createdAt: number; validatedAt?: number };
  completedAt?: number;
  lastError?: { code: SetupErrorCode; detail: string; step: SetupStep };
}

export interface FlowDeps {
  client: GoogleCloudClient;
  oauth: OAuthProvider;
  /** where the (non-secret) setup state is kept */
  kv: KV;
  /** Saves the key in the secure store and switches the provider to Google. */
  activate(apiKey: string, credentialId?: string): Promise<void>;
  /** Removes the saved key and switches back to on-device translation. */
  deactivate(): Promise<void>;
  /** The saved key (tests, or where the flow runs next to the secure store). */
  currentKey?(): Promise<string>;
  /** Last 4 characters of the saved key, when the flow runs in a UI that must not hold the key. */
  keyHint?(): Promise<string>;
  /** Health check done where the key lives (extension background / native): one real translation. */
  validateSaved?(): Promise<{ ok: boolean; code?: string; detail?: string }>;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** attempts / delay for a freshly created key or freshly enabled API (Google needs a moment to propagate) */
  validateRetries?: number;
  validateDelayMs?: number;
}

const STATE_KEY = 'smartsetup:v1';
const fresh = (): SetupState => ({ version: 1, step: 'intro' });

/** Which project to pre-select: a previous Lingolens project, else the only one; null when the user must choose / create. */
export function suggestProject(projects: ProjectInfo[]): ProjectInfo | null {
  const mine = projects.filter((p) => p.projectId.startsWith('lingolens-'));
  if (mine.length) return mine[0];
  return projects.length === 1 ? projects[0] : null;
}

export function makeProjectId(name: string, rand = () => Math.random().toString(36).slice(2, 6)): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 14) || 'translate';
  return `lingolens-${slug}-${rand()}`.slice(0, 30).replace(/-+$/g, '');
}

export class SmartSetupFlow {
  private token = '';
  private tokenExpires = 0;
  private pending: { name: string; keyString: string } | null = null;
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;

  constructor(private d: FlowDeps) {
    this.now = d.clock ?? Date.now;
    this.sleep = d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  // ---------------------------------------------------------------- state
  async state(): Promise<SetupState> {
    const s = await this.d.kv.get<SetupState>(STATE_KEY);
    return s && s.version === 1 ? s : fresh();
  }
  private async save(patch: Partial<SetupState>): Promise<SetupState> {
    const s = { ...(await this.state()), ...patch };
    await this.d.kv.set({ [STATE_KEY]: s });
    return s;
  }
  get hasSession(): boolean {
    return !!this.token && this.now() < this.tokenExpires;
  }
  async configured(): Promise<boolean> {
    return this.d.oauth.configured();
  }

  /** Runs a step: clears the last error on success, records it (with the step) on failure, rethrows. */
  private async step<T>(step: SetupStep, fn: () => Promise<T>): Promise<T> {
    try {
      const r = await fn();
      const s = await this.state();
      if (s.lastError) await this.save({ lastError: undefined });
      return r;
    } catch (e) {
      const err = e instanceof SetupError ? e : new SetupError('NETWORK_ERROR', String((e as Error)?.message ?? e).slice(0, 200));
      await this.save({ lastError: { code: err.code, detail: err.detail, step } });
      throw err;
    }
  }

  private tok(): string {
    if (!this.hasSession) throw new SetupError('GOOGLE_AUTH_FAILED', 'Phiên đăng nhập đã hết hạn hoặc chưa đăng nhập.');
    return this.token;
  }

  async goTo(step: SetupStep) {
    await this.save({ step });
  }
  async back() {
    const s = await this.state();
    const i = STEP_ORDER.indexOf(s.step);
    if (i > 0) await this.save({ step: STEP_ORDER[i - 1], lastError: undefined });
  }

  // ---------------------------------------------------------------- 1 connect
  async connect(): Promise<SetupState> {
    return this.step('connect', async () => {
      const session = await this.d.oauth.signIn();
      this.token = session.accessToken;
      this.tokenExpires = session.expiresAt ?? this.now() + 55 * 60_000;
      // the e-mail is only a label: never let a slow network hold the sign-in
      const account = await Promise.race([this.d.client.userEmail(this.token), new Promise<undefined>((r) => setTimeout(() => r(undefined), 6000))]);
      const s = await this.state();
      return this.save({ account: account ?? s.account, step: s.project && s.step !== 'intro' && s.step !== 'connect' && s.step !== 'done' ? s.step : 'project' });
    });
  }

  /** Picks up a Google session the browser already has (access granted earlier): no window. Returns the state when there was one. */
  async connectSilent(): Promise<SetupState | null> {
    const session = await this.d.oauth.silent?.().catch(() => null);
    if (!session) return null;
    this.token = session.accessToken;
    this.tokenExpires = session.expiresAt ?? this.now() + 55 * 60_000;
    const account = await Promise.race([this.d.client.userEmail(this.token), new Promise<undefined>((r) => setTimeout(() => r(undefined), 6000))]);
    const s = await this.state();
    return this.save({ account: account ?? s.account });
  }

  /**
   * This month's characters as Google counts them for the whole project (all platforms). Needs a session (the caller tries
   * connectSilent first); throws SetupError when Google refuses. `chars` is null when Monitoring has no character metric.
   */
  async fetchAccountUsage(now = new Date(this.now())): Promise<{ chars: number | null; month: string; projectId: string; byMetric: Record<string, number> }> {
    return this.step('validate', async () => {
      const s = await this.state();
      const projectId = s.project?.id;
      if (!projectId) throw new SetupError('PROJECT_NOT_FOUND', 'Chưa chọn dự án Google Cloud (Smart Setup).');
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const u = await this.d.client.translateUsage(this.tok(), projectId, start, now);
      return { ...u, month: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`, projectId };
    });
  }

  /** Drops the OAuth session (revokes the token). Nothing else changes. */
  async endSession(): Promise<void> {
    const t = this.token;
    this.token = '';
    this.tokenExpires = 0;
    if (t) await this.d.oauth.signOut(t);
  }

  // ---------------------------------------------------------------- 2 project
  async listProjects(): Promise<ProjectInfo[]> {
    return this.step('project', () => this.d.client.listProjects(this.tok()));
  }

  async selectProject(projectId: string): Promise<SetupState> {
    return this.step('project', async () => {
      const t = this.tok();
      const p = await this.d.client.getProject(t, projectId);
      const missing = await this.d.client.missingPermissions(t, projectId);
      if (missing.length) throw new SetupError('INSUFFICIENT_PERMISSIONS', `Thiếu quyền: ${missing.join(', ')}`);
      return this.save({ project: { id: p.projectId, name: p.displayName }, billing: undefined, apis: undefined, key: undefined, step: 'billing' });
    });
  }

  async createProject(displayName: string): Promise<SetupState> {
    return this.step('project', async () => {
      const t = this.tok();
      const id = makeProjectId(displayName);
      const p = await this.d.client.createProject(t, id, displayName.trim() || 'Lingolens Translation');
      // the creator owns the new project, but the permissions can take a moment to appear
      const missing = await this.d.client.missingPermissions(t, p.projectId).catch(() => []);
      if (missing.length) throw new SetupError('INSUFFICIENT_PERMISSIONS', `Thiếu quyền: ${missing.join(', ')}`);
      return this.save({ project: { id: p.projectId, name: p.displayName }, billing: undefined, apis: undefined, key: undefined, step: 'billing' });
    });
  }

  // ---------------------------------------------------------------- 3 billing (read only)
  async checkBilling(): Promise<SetupState> {
    return this.step('billing', async () => {
      const s = await this.state();
      if (!s.project) throw new SetupError('PROJECT_NOT_FOUND', 'Chưa chọn dự án.');
      const info = await this.d.client.billingInfo(this.tok(), s.project.id);
      await this.save({ billing: { enabled: info.enabled, checkedAt: this.now() } });
      if (!info.enabled) throw new SetupError('BILLING_NOT_ENABLED');
      return this.save({ step: 'api' });
    });
  }

  // ---------------------------------------------------------------- 4 APIs
  async prepareApis(): Promise<SetupState> {
    return this.step('api', async () => {
      const s = await this.state();
      if (!s.project) throw new SetupError('PROJECT_NOT_FOUND', 'Chưa chọn dự án.');
      const t = this.tok();
      const apis = { translate: false, apikeys: false };
      for (const [flag, service] of [['apikeys', APIKEYS_SERVICE], ['translate', TRANSLATE_SERVICE]] as const) {
        let on = await this.d.client.isServiceEnabled(t, s.project.id, service);
        if (!on) {
          await this.d.client.enableService(t, s.project.id, service);
          on = await this.d.client.isServiceEnabled(t, s.project.id, service);
        }
        apis[flag] = on;
        if (!on) throw new SetupError(flag === 'translate' ? 'TRANSLATION_API_DISABLED' : 'API_KEY_GENERATION_FAILED', `Không bật được ${service}.`);
      }
      return this.save({ apis, step: 'key' });
    });
  }

  // ---------------------------------------------------------------- 5 key
  /**
   * Gets the key to use: an existing `Lingolens-Translation` key that is restricted to the Translation API is REUSED
   * (no duplicate keys, and a half-finished setup can be resumed); otherwise a new restricted key is created.
   * `reuse: false` (replace key) always creates a new one. Old Lingolens keys are removed only after the new one works.
   */
  async generateKey(opts: { reuse?: boolean } = {}): Promise<SetupState> {
    return this.step('key', async () => {
      const s = await this.state();
      if (!s.project) throw new SetupError('PROJECT_NOT_FOUND', 'Chưa chọn dự án.');
      if (opts.reuse ?? true) {
        const mine = (await this.d.client.listKeys(this.tok(), s.project.id)).find((k) => k.displayName === LINGOLENS_KEY_NAME && k.apiTargets.length === 1 && k.apiTargets[0] === TRANSLATE_SERVICE);
        if (mine) {
          try {
            const keyString = await this.d.client.getKeyString(this.tok(), mine.name);
            this.pending = { name: mine.name, keyString };
            return this.save({ key: { name: mine.name, hint: keyString.slice(-4), createdAt: this.now() }, step: 'validate' });
          } catch {
            /* cannot read it: create a fresh one below */
          }
        }
      }
      const k = await this.d.client.createKey(this.tok(), s.project.id, LINGOLENS_KEY_NAME);
      this.pending = k;
      return this.save({ key: { name: k.name, hint: k.keyString.slice(-4), createdAt: this.now() }, step: 'validate' });
    });
  }

  // ---------------------------------------------------------------- 6 validate
  /** A real translation with the NEW key. Retries a few times: a new key / newly enabled API can take a minute to work. */
  async validate(): Promise<string> {
    return this.step('validate', async () => {
      if (!this.pending) throw new SetupError('INVALID_API_KEY', 'Chưa có khoá mới để kiểm tra. Hãy tạo khoá.');
      const tries = this.d.validateRetries ?? 6;
      const delay = this.d.validateDelayMs ?? 5000;
      let last: SetupError | null = null;
      for (let i = 0; i < tries; i++) {
        try {
          const sample = await this.d.client.validateKey(this.pending.keyString);
          const s = await this.state();
          if (s.key) await this.save({ key: { ...s.key, validatedAt: this.now() } });
          return sample;
        } catch (e) {
          last = e instanceof SetupError ? e : new SetupError('NETWORK_ERROR', String(e));
          const retryable = last.code === 'TRANSLATION_API_DISABLED' || last.code === 'INVALID_API_KEY';
          if (!retryable) break;
          if (i < tries - 1 && delay > 0) await this.sleep(delay);
          else if (i < tries - 1) await this.sleep(0);
        }
      }
      throw last ?? new SetupError('INVALID_API_KEY');
    });
  }

  // ---------------------------------------------------------------- 7 save & activate
  /** Only after a successful validation: saves the key securely, turns Google translation on, ends the OAuth session. */
  async activate(): Promise<SetupState> {
    return this.step('done', async () => {
      const s = await this.state();
      if (!this.pending || !s.key?.validatedAt) throw new SetupError('INVALID_API_KEY', 'Khoá chưa được xác minh.');
      const previous = s.key;
      await this.d.activate(this.pending.keyString, s.project?.id);
      this.pending = null;
      // tidy up: older Lingolens-Translation keys in this project (best effort; the new key already works)
      if (s.project) {
        try {
          const keys = await this.d.client.listKeys(this.tok(), s.project.id);
          for (const k of keys) if (k.displayName === LINGOLENS_KEY_NAME && k.name !== previous.name) await this.d.client.deleteKey(this.tok(), k.name).catch(() => {});
        } catch {
          /* the old key can be removed in the Console */
        }
      }
      await this.endSession();
      return this.save({ step: 'done', completedAt: this.now(), lastError: undefined });
    });
  }

  /** Replace the key: new key -> validate -> activate (the old one is removed at Google afterwards). Needs a session. */
  async replaceKey(): Promise<SetupState> {
    await this.generateKey({ reuse: false });
    await this.validate();
    return this.activate();
  }

  // ---------------------------------------------------------------- one-tap setup
  /**
   * After the billing check: APIs -> key -> validation -> save & activate in ONE go (the user taps once). Idempotent:
   * it resumes after an error or a reload (enabled APIs are skipped, the existing Lingolens key is reused).
   */
  async autoSetup(onProgress?: (phase: 'api' | 'key' | 'validate' | 'activate') => void): Promise<SetupState> {
    const s = await this.state();
    if (!s.project) throw new SetupError('PROJECT_NOT_FOUND', 'Chưa chọn dự án.');
    onProgress?.('api');
    await this.prepareApis();
    onProgress?.('key');
    if (!this.pending) await this.generateKey();
    onProgress?.('validate');
    await this.validate();
    onProgress?.('activate');
    return this.activate();
  }

  // ---------------------------------------------------------------- billing page
  /**
   * Settings → Billing: is billing working? One real translation with the saved key (no sign-in). Updates the stored billing
   * state: enabled, or pending when Google answers BILLING_*.
   */
  async verifyBilling(): Promise<{ enabled: boolean; error?: SetupError }> {
    const r = await this.checkHealth();
    if (r.ok) {
      await this.save({ billing: { enabled: true, checkedAt: this.now() } });
      return { enabled: true };
    }
    if (r.error?.code === 'BILLING_NOT_ENABLED' || r.error?.code === 'BILLING_ACCOUNT_SUSPENDED') await this.save({ billing: { enabled: false, checkedAt: this.now() } });
    return { enabled: false, error: r.error };
  }

  // ---------------------------------------------------------------- credential management
  /** Local status (no network): is there a key, which project, when was it validated. */
  async status(): Promise<{ connected: boolean; project?: SetupState['project']; account?: string; keyHint?: string; validatedAt?: number; completedAt?: number; billing: 'unknown' | 'pending' | 'ok' }> {
    const s = await this.state();
    const hint = this.d.keyHint ? await this.d.keyHint().catch(() => '') : ((await this.d.currentKey?.().catch(() => '')) ?? '').slice(-4);
    return { connected: !!hint, project: s.project, account: s.account, keyHint: hint || undefined, validatedAt: s.key?.validatedAt, completedAt: s.completedAt, billing: s.billing ? (s.billing.enabled ? 'ok' : 'pending') : 'unknown' };
  }

  /** Live check of the saved key (one 5-character translation request to the user's own project). */
  async checkHealth(): Promise<{ ok: boolean; error?: SetupError }> {
    try {
      if (this.d.validateSaved) {
        const r = await this.d.validateSaved();
        if (!r.ok) return { ok: false, error: new SetupError((r.code as SetupErrorCode) ?? 'NETWORK_ERROR', r.detail ?? '') };
      } else {
        const key = (await this.d.currentKey?.()) ?? '';
        if (!key) return { ok: false, error: new SetupError('INVALID_API_KEY', 'Chưa có khoá API.') };
        await this.d.client.validateKey(key);
      }
      const s = await this.state();
      if (s.key) await this.save({ key: { ...s.key, validatedAt: this.now() } });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof SetupError ? e : new SetupError('NETWORK_ERROR', String(e)) };
    }
  }

  /**
   * Disconnect: removes the saved key from this device and goes back to on-device translation. With
   * `deleteRemoteKey` the key is also deleted at Google (needs a session; otherwise reconnect first).
   */
  async disconnect(opts: { deleteRemoteKey?: boolean } = {}): Promise<void> {
    const s = await this.state();
    if (opts.deleteRemoteKey && s.key?.name) {
      await this.d.client.deleteKey(this.tok(), s.key.name);
    }
    await this.d.deactivate();
    this.pending = null;
    await this.endSession().catch(() => {});
    await this.d.kv.set({ [STATE_KEY]: { ...fresh(), account: s.account } satisfies SetupState });
  }

  /** Back to the connect step to sign in again (e.g. after the OAuth permission was revoked). */
  async reconnect(): Promise<SetupState> {
    await this.endSession().catch(() => {});
    return this.connect();
  }
}
