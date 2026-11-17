import { describe, expect, it } from 'vitest';
import type { KV } from '@/storage/kv';
import {
  GoogleCloudClient,
  MemorySecretStore,
  REQUIRED_PERMISSIONS,
  SetupError,
  SmartSetupFlow,
  WebCryptoSecretStore,
  makeProjectId,
  mapGoogleError,
  suggestProject,
  memoryKeyStorage,
  type FetchFn,
  type OAuthProvider,
  type SetupErrorCode,
} from '@/modules/smart-setup';
import { UsageService } from '@/modules/usage';
import type { FetchLike } from '@/modules/usage/google';

// ------------------------------------------------------------------------------------------------ fakes
function memoryKV(): KV & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    quota: 1e7,
    async get<T>(k: string) {
      return data.has(k) ? (JSON.parse(JSON.stringify(data.get(k))) as T) : undefined;
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) data.set(k, JSON.parse(JSON.stringify(v)));
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
    },
    async bytesInUse() {
      return 0;
    },
    onChange: () => () => {},
  };
}

interface FakeProject {
  id: string;
  name: string;
  perms: string[]; // permissions the user has
  services: Set<string>;
  billing: 'none' | 'enabled' | 'suspended';
  keys: Map<string, { displayName: string; apiTargets: string[]; keyString: string; deleted?: boolean }>;
}

/** A stand-in for the Google Cloud REST APIs Smart Setup uses (documented endpoints only; anything else fails the test). */
class FakeGoogle {
  projects = new Map<string, FakeProject>();
  validTokens = new Set(['tok-1']);
  revoked: string[] = [];
  offline = false;
  log: { method: string; url: string; body?: unknown }[] = [];
  /** how many translate calls with a NEW key fail with API_KEY_INVALID before it "propagates" */
  keyPropagationFailures = 0;
  /** the OAuth client's own project lacks an admin API (developer-side problem) */
  adminApiDisabled: string | null = null;
  private ops = new Map<string, () => unknown>();
  private seq = 1;
  private keyCalls = new Map<string, number>();

  addProject(id: string, over: Partial<FakeProject> = {}): FakeProject {
    const p: FakeProject = { id, name: id, perms: [...REQUIRED_PERMISSIONS], services: new Set(), billing: 'enabled', keys: new Map(), ...over };
    this.projects.set(id, p);
    return p;
  }

  private err(status: number, message: string, reason?: string, grpc = 'PERMISSION_DENIED') {
    return { ok: false, status, json: async () => ({ error: { code: status, message, status: grpc, details: reason ? [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason }] : [] } }) };
  }
  private ok(body: unknown) {
    return { ok: true, status: 200, json: async () => body };
  }
  private op(done: () => unknown) {
    const name = `operations/op-${this.seq++}`;
    this.ops.set(name, done);
    return this.ok({ name, done: false });
  }

  fetch: FetchFn = async (url, init) => {
    if (this.offline) throw new TypeError('Failed to fetch');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body) : undefined;
    this.log.push({ method, url: url.replace(/key=[^&]+/, 'key=***'), body });
    const u = new URL(url);
    const path = u.pathname;
    const bearer = (init?.headers?.authorization ?? '').replace('Bearer ', '');
    const authed = this.validTokens.has(bearer);

    // translation (the key itself, no OAuth)
    if (u.host === 'translation.googleapis.com') {
      const key = u.searchParams.get('key') ?? '';
      let found: { p: FakeProject; k: FakeProject['keys'] extends Map<string, infer V> ? V : never } | null = null;
      for (const p of this.projects.values()) for (const k of p.keys.values()) if (k.keyString === key && !k.deleted) found = { p, k };
      if (!found) return this.err(400, 'API key not valid. Please pass a valid API key.', 'API_KEY_INVALID', 'INVALID_ARGUMENT');
      const calls = (this.keyCalls.get(key) ?? 0) + 1;
      this.keyCalls.set(key, calls);
      if (calls <= this.keyPropagationFailures) return this.err(400, 'API key not valid. Please pass a valid API key.', 'API_KEY_INVALID', 'INVALID_ARGUMENT');
      if (!found.k.apiTargets.includes('translate.googleapis.com') && found.k.apiTargets.length) {
        return this.err(403, 'Requests to this API translate.googleapis.com method are blocked.', 'API_KEY_SERVICE_BLOCKED');
      }
      if (!found.p.services.has('translate.googleapis.com')) return this.err(403, `Cloud Translation API has not been used in project ${found.p.id} before or it is disabled.`, 'SERVICE_DISABLED');
      if (found.p.billing === 'none') return this.err(403, 'This API method requires billing to be enabled.', 'BILLING_DISABLED');
      if (found.p.billing === 'suspended') return this.err(403, 'The billing account for the owning project is closed.', 'BILLING_DISABLED');
      return this.ok({ data: { translations: [{ translatedText: 'Xin chào' }] } });
    }
    if (u.host === 'oauth2.googleapis.com') return this.ok({});

    if (!authed) return this.err(401, 'Request had invalid authentication credentials.', 'ACCESS_TOKEN_EXPIRED', 'UNAUTHENTICATED');
    if (this.adminApiDisabled && u.host.startsWith(this.adminApiDisabled)) {
      return this.err(403, `${this.adminApiDisabled} API has not been used in project 123 before or it is disabled.`, 'SERVICE_DISABLED');
    }
    if (u.host === 'www.googleapis.com' && path === '/oauth2/v3/userinfo') return this.ok({ email: 'user@example.com' });

    // operations (all three APIs)
    const opm = path.match(/\/(operations\/op-\d+)$/);
    if (opm) {
      const r = this.ops.get(opm[1])!();
      return this.ok({ name: opm[1], done: true, response: r });
    }

    // Resource Manager v3
    if (u.host === 'cloudresourcemanager.googleapis.com') {
      if (path === '/v3/projects:search') return this.ok({ projects: [...this.projects.values()].map((p) => ({ projectId: p.id, displayName: p.name, state: 'ACTIVE' })) });
      if (path === '/v3/projects' && method === 'POST') {
        const b = body as { projectId: string; displayName: string };
        return this.op(() => {
          this.addProject(b.projectId, { name: b.displayName, billing: 'none' });
          return { projectId: b.projectId };
        });
      }
      const tp = path.match(/^\/v3\/projects\/([^/:]+):testIamPermissions$/);
      if (tp) {
        const p = this.projects.get(tp[1]);
        if (!p) return this.err(404, 'Project not found', undefined, 'NOT_FOUND');
        const asked = (body as { permissions: string[] }).permissions;
        return this.ok({ permissions: asked.filter((x) => p.perms.includes(x)) });
      }
      const gp = path.match(/^\/v3\/projects\/([^/:]+)$/);
      if (gp && method === 'GET') {
        const p = this.projects.get(gp[1]);
        return p ? this.ok({ projectId: p.id, displayName: p.name, state: 'ACTIVE' }) : this.err(404, 'Project not found', undefined, 'NOT_FOUND');
      }
    }
    // Service Usage v1
    if (u.host === 'serviceusage.googleapis.com') {
      const sm = path.match(/^\/v1\/projects\/([^/]+)\/services\/([^/:]+)(:enable)?$/);
      if (sm) {
        const p = this.projects.get(sm[1]);
        if (!p) return this.err(404, 'Project not found', undefined, 'NOT_FOUND');
        if (sm[3]) {
          if (!p.perms.includes('serviceusage.services.enable')) return this.err(403, 'Permission denied to enable service');
          return this.op(() => {
            p.services.add(sm[2]);
            return {};
          });
        }
        return this.ok({ state: p.services.has(sm[2]) ? 'ENABLED' : 'DISABLED' });
      }
    }
    // Cloud Billing v1 (read only)
    if (u.host === 'cloudbilling.googleapis.com') {
      const bm = path.match(/^\/v1\/projects\/([^/]+)\/billingInfo$/);
      if (bm && method === 'GET') {
        const p = this.projects.get(bm[1]);
        if (!p) return this.err(404, 'Project not found', undefined, 'NOT_FOUND');
        return this.ok({ billingEnabled: p.billing === 'enabled', billingAccountName: p.billing === 'none' ? '' : 'billingAccounts/0000-1111' });
      }
    }
    // API Keys v2
    if (u.host === 'apikeys.googleapis.com') {
      const lm = path.match(/^\/v2\/projects\/([^/]+)\/locations\/global\/keys$/);
      if (lm) {
        const p = this.projects.get(lm[1]);
        if (!p) return this.err(404, 'Project not found', undefined, 'NOT_FOUND');
        if (method === 'GET') {
          return this.ok({ keys: [...p.keys.entries()].filter(([, k]) => !k.deleted).map(([name, k]) => ({ name, displayName: k.displayName, restrictions: { apiTargets: k.apiTargets.map((service) => ({ service })) } })) });
        }
        if (!p.perms.includes('apikeys.keys.create')) return this.err(403, 'Permission apikeys.keys.create denied');
        const b = body as { displayName: string; restrictions?: { apiTargets?: { service: string }[] } };
        return this.op(() => {
          const name = `projects/123/locations/global/keys/uid-${this.seq++}`;
          p.keys.set(name, { displayName: b.displayName, apiTargets: (b.restrictions?.apiTargets ?? []).map((t) => t.service), keyString: `AIzaSy${String(this.seq).padStart(4, '0')}${'k'.repeat(29)}` });
          return { name };
        });
      }
      const km = path.match(/^\/v2\/(projects\/[^/]+\/locations\/global\/keys\/[^/]+)(\/keyString)?$/);
      if (km) {
        for (const p of this.projects.values()) {
          const k = p.keys.get(km[1]);
          if (!k || k.deleted) continue;
          if (km[2]) return this.ok({ keyString: k.keyString });
          if (method === 'DELETE') {
            k.deleted = true;
            return this.ok({});
          }
        }
        return this.err(404, 'Key not found', undefined, 'NOT_FOUND');
      }
    }
    throw new Error(`FakeGoogle: undocumented request ${method} ${url}`);
  };

  /** the user links their billing account in the Console */
  linkBilling(id: string) {
    this.projects.get(id)!.billing = 'enabled';
  }
}

function testOAuth(g: FakeGoogle, o: { configured?: boolean; fail?: boolean } = {}): OAuthProvider & { signIns: number } {
  return {
    id: 'test',
    signIns: 0,
    configured: async () => o.configured ?? true,
    async signIn() {
      if (o.configured === false) throw new SetupError('OAUTH_NOT_CONFIGURED');
      if (o.fail) throw new SetupError('GOOGLE_AUTH_FAILED', 'user cancelled');
      this.signIns++;
      g.validTokens.add('tok-1');
      return { accessToken: 'tok-1', expiresAt: Date.now() + 3_600_000 };
    },
    async signOut(token) {
      g.revoked.push(token);
      g.validTokens.delete(token);
    },
  };
}

interface Rig {
  g: FakeGoogle;
  kv: ReturnType<typeof memoryKV>;
  secrets: MemorySecretStore;
  usage: UsageService;
  flow: SmartSetupFlow;
  oauth: ReturnType<typeof testOAuth>;
  translations: string[];
}
function rig(opts: { g?: FakeGoogle; kv?: ReturnType<typeof memoryKV>; secrets?: MemorySecretStore; oauth?: { configured?: boolean; fail?: boolean }; retries?: number } = {}): Rig {
  const g = opts.g ?? new FakeGoogle();
  const kv = opts.kv ?? memoryKV();
  const secrets = opts.secrets ?? new MemorySecretStore();
  const translations: string[] = [];
  const fetchImpl: FetchLike = async (_u, init) => {
    const q = (JSON.parse(init.body) as { q: string }).q;
    translations.push(q);
    return { ok: true, status: 200, json: async () => ({ data: { translations: [{ translatedText: `vi:${q}` }] } }) };
  };
  const usage = new UsageService(kv, { secrets, fetchImpl });
  const client = new GoogleCloudClient({ fetchImpl: g.fetch, sleep: async () => {}, pollIntervalMs: 0 });
  const oauth = testOAuth(g, opts.oauth);
  const flow = new SmartSetupFlow({
    client,
    oauth,
    kv,
    activate: (k) => usage.activateGoogle(k),
    deactivate: () => usage.deactivateGoogle(),
    currentKey: () => usage.currentKey(),
    sleep: async () => {},
    validateDelayMs: 0,
    validateRetries: opts.retries ?? 4,
  });
  return { g, kv, secrets, usage, flow, oauth, translations };
}
const codeOf = async (p: Promise<unknown>): Promise<SetupErrorCode | 'no error'> => {
  try {
    await p;
    return 'no error';
  } catch (e) {
    return e instanceof SetupError ? e.code : (`unexpected: ${String(e)}` as never);
  }
};

/** the whole happy path from "connect" to "done" on an existing project */
async function runAll(r: Rig, projectId: string) {
  await r.flow.connect();
  await r.flow.selectProject(projectId);
  await r.flow.checkBilling();
  await r.flow.prepareApis();
  await r.flow.generateKey();
  await r.flow.validate();
  return r.flow.activate();
}

// ------------------------------------------------------------------------------------------------ tests
describe('happy paths', () => {
  it('existing project with billing: connect → project → billing → APIs → key → validate → activate', async () => {
    const r = rig();
    r.g.addProject('my-proj');
    const s = await runAll(r, 'my-proj');
    expect(s).toMatchObject({ step: 'done', account: 'user@example.com', project: { id: 'my-proj' } });
    expect(s.apis).toEqual({ translate: true, apikeys: true });
    expect(s.completedAt).toBeGreaterThan(0);
    // activated: key saved securely, provider = google, translation works through the usage service
    const settings = await r.usage.getSettings();
    expect(settings.provider).toBe('google');
    const out = await r.usage.translate('hello there');
    expect(out).toMatchObject({ source: 'google', text: 'vi:hello there' });
    // the OAuth token was revoked and dropped
    expect(r.g.revoked).toEqual(['tok-1']);
    expect(r.flow.hasSession).toBe(false);
  });

  it('a brand-new Google account: no project → create one → billing is the user’s step → continue', async () => {
    const r = rig();
    await r.flow.connect();
    expect(await r.flow.listProjects()).toEqual([]);
    const created = await r.flow.createProject('Lingolens Translation');
    expect(created.project?.id).toMatch(/^lingolens-lingolens-tran-/);
    expect(created.step).toBe('billing');
    // new project has no billing: Smart Setup stops and explains, it never links billing itself
    expect(await codeOf(r.flow.checkBilling())).toBe('BILLING_NOT_ENABLED');
    expect((await r.flow.state()).step).toBe('billing');
    expect((await r.flow.state()).lastError).toMatchObject({ code: 'BILLING_NOT_ENABLED', step: 'billing' });
    r.g.linkBilling(created.project!.id); // the user does it in the Console
    await r.flow.checkBilling();
    await r.flow.prepareApis();
    await r.flow.generateKey();
    await r.flow.validate();
    expect((await r.flow.activate()).step).toBe('done');
  });

  it('project without the Translation API: Smart Setup enables it (and the API Keys API)', async () => {
    const r = rig();
    const p = r.g.addProject('p1');
    expect(p.services.size).toBe(0);
    await runAll(r, 'p1');
    expect([...p.services].sort()).toEqual(['apikeys.googleapis.com', 'translate.googleapis.com']);
  });

  it('the key is created restricted to the Translation API with a recognisable name', async () => {
    const r = rig();
    r.g.addProject('p1');
    await runAll(r, 'p1');
    const create = r.g.log.find((l) => l.method === 'POST' && /\/keys\?keyId=lingolens-translation-/.test(l.url))!;
    expect(create.body).toEqual({ displayName: 'Lingolens-Translation', restrictions: { apiTargets: [{ service: 'translate.googleapis.com' }] } });
  });

  it('only documented Google endpoints are used, and billing is only ever READ', async () => {
    const r = rig();
    r.g.addProject('p1');
    await runAll(r, 'p1'); // FakeGoogle throws on any undocumented request
    const billing = r.g.log.filter((l) => l.url.includes('cloudbilling'));
    expect(billing.length).toBeGreaterThan(0);
    expect(billing.every((l) => l.method === 'GET' && /\/billingInfo$/.test(l.url))).toBe(true);
    const hosts = new Set(r.g.log.map((l) => new URL(l.url).host));
    expect([...hosts].sort()).toEqual(['apikeys.googleapis.com', 'cloudbilling.googleapis.com', 'cloudresourcemanager.googleapis.com', 'serviceusage.googleapis.com', 'translation.googleapis.com', 'www.googleapis.com']);
  });
});

describe('failures and recovery (one step fails, the rest is kept)', () => {
  it('insufficient permissions on the project', async () => {
    const r = rig();
    r.g.addProject('shared', { perms: ['resourcemanager.projects.get', 'serviceusage.services.get'] });
    await r.flow.connect();
    expect(await codeOf(r.flow.selectProject('shared'))).toBe('INSUFFICIENT_PERMISSIONS');
    const s = await r.flow.state();
    expect(s.project).toBeUndefined();
    expect(s.lastError?.detail).toMatch(/apikeys\.keys\.create/);
    // the user can pick another project without signing in again
    r.g.addProject('mine');
    await r.flow.selectProject('mine');
    expect((await r.flow.state()).step).toBe('billing');
    expect(r.oauth.signIns).toBe(1);
  });

  it('project not found', async () => {
    const r = rig();
    await r.flow.connect();
    expect(await codeOf(r.flow.selectProject('gone'))).toBe('PROJECT_NOT_FOUND');
  });

  it('API key generation refused (no apikeys.keys.create) → API_KEY_GENERATION_FAILED, retry works after the fix', async () => {
    const r = rig();
    const p = r.g.addProject('p1');
    await r.flow.connect();
    await r.flow.selectProject('p1');
    await r.flow.checkBilling();
    await r.flow.prepareApis();
    p.perms = p.perms.filter((x) => x !== 'apikeys.keys.create');
    expect(await codeOf(r.flow.generateKey())).toBe('API_KEY_GENERATION_FAILED');
    expect((await r.flow.state()).step).toBe('key');
    p.perms.push('apikeys.keys.create');
    await r.flow.generateKey();
    expect((await r.flow.state()).step).toBe('validate');
  });

  it('an invalid API key never activates', async () => {
    const r = rig({ retries: 2 });
    r.g.addProject('p1');
    await r.flow.connect();
    await r.flow.selectProject('p1');
    await r.flow.checkBilling();
    await r.flow.prepareApis();
    await r.flow.generateKey();
    r.g.projects.get('p1')!.keys.forEach((k) => (k.deleted = true)); // the key disappears at Google
    expect(await codeOf(r.flow.validate())).toBe('INVALID_API_KEY');
    expect(await codeOf(r.flow.activate())).toBe('INVALID_API_KEY');
    expect((await r.usage.getSettings()).provider).toBe('device');
    expect(await r.usage.currentKey()).toBe('');
  });

  it('a new key that has not propagated yet is retried, then accepted', async () => {
    const r = rig({ retries: 5 });
    r.g.keyPropagationFailures = 3;
    r.g.addProject('p1');
    await runAll(r, 'p1');
    expect((await r.flow.state()).step).toBe('done');
  });

  it('a key restricted to another API → API_KEY_RESTRICTED', async () => {
    const r = rig();
    const p = r.g.addProject('p1', { services: new Set(['translate.googleapis.com', 'apikeys.googleapis.com']) });
    await r.flow.connect();
    await r.flow.selectProject('p1');
    await r.flow.checkBilling();
    await r.flow.prepareApis();
    await r.flow.generateKey();
    [...p.keys.values()].forEach((k) => (k.apiTargets = ['maps.googleapis.com']));
    expect(await codeOf(r.flow.validate())).toBe('API_KEY_RESTRICTED');
  });

  it('billing suspended / billing off at validation time', async () => {
    const r = rig({ retries: 1 });
    const p = r.g.addProject('p1');
    await r.flow.connect();
    await r.flow.selectProject('p1');
    await r.flow.checkBilling();
    await r.flow.prepareApis();
    await r.flow.generateKey();
    p.billing = 'suspended';
    expect(await codeOf(r.flow.validate())).toBe('BILLING_ACCOUNT_SUSPENDED');
    p.billing = 'none';
    expect(await codeOf(r.flow.validate())).toBe('BILLING_NOT_ENABLED');
    p.billing = 'enabled';
    await r.flow.validate();
  });

  it('Translation API disabled at validation time → TRANSLATION_API_DISABLED (retryable)', async () => {
    const r = rig({ retries: 1 });
    const p = r.g.addProject('p1');
    await r.flow.connect();
    await r.flow.selectProject('p1');
    await r.flow.checkBilling();
    await r.flow.prepareApis();
    await r.flow.generateKey();
    p.services.delete('translate.googleapis.com');
    expect(await codeOf(r.flow.validate())).toBe('TRANSLATION_API_DISABLED');
    p.services.add('translate.googleapis.com');
    await r.flow.validate();
  });

  it('network lost in the middle: NETWORK_ERROR, progress kept, the failed step is retried alone', async () => {
    const r = rig();
    r.g.addProject('p1');
    await r.flow.connect();
    await r.flow.selectProject('p1');
    await r.flow.checkBilling();
    r.g.offline = true;
    expect(await codeOf(r.flow.prepareApis())).toBe('NETWORK_ERROR');
    expect(await r.flow.state()).toMatchObject({ step: 'api', project: { id: 'p1' }, lastError: { code: 'NETWORK_ERROR', step: 'api' } });
    r.g.offline = false;
    await r.flow.prepareApis();
    expect((await r.flow.state()).step).toBe('key');
    expect((await r.flow.state()).lastError).toBeUndefined();
    expect(r.oauth.signIns).toBe(1); // never asked to sign in again
  });

  it('OAuth permission revoked: GOOGLE_AUTH_FAILED, reconnect resumes at the same step', async () => {
    const r = rig();
    r.g.addProject('p1');
    await r.flow.connect();
    await r.flow.selectProject('p1');
    r.g.validTokens.clear(); // the user revoked Lingolens in their Google account
    expect(await codeOf(r.flow.checkBilling())).toBe('GOOGLE_AUTH_FAILED');
    await r.flow.reconnect();
    expect((await r.flow.state()).step).toBe('billing'); // not back to the start
    expect((await r.flow.state()).project?.id).toBe('p1');
    await r.flow.checkBilling();
    expect((await r.flow.state()).step).toBe('api');
  });

  it('an expired session in the flow object is reported before any call is made', async () => {
    const r = rig();
    r.g.addProject('p1');
    expect(await codeOf(r.flow.listProjects())).toBe('GOOGLE_AUTH_FAILED');
    expect(r.g.log).toHaveLength(0);
  });

  it('the user cancels the Google sign-in', async () => {
    const r = rig({ oauth: { fail: true } });
    expect(await codeOf(r.flow.connect())).toBe('GOOGLE_AUTH_FAILED');
    expect((await r.flow.state()).step).toBe('intro');
  });

  it('no OAuth client configured in this build: OAUTH_NOT_CONFIGURED and manual keys keep working', async () => {
    const r = rig({ oauth: { configured: false } });
    expect(await r.flow.configured()).toBe(false);
    expect(await codeOf(r.flow.connect())).toBe('OAUTH_NOT_CONFIGURED');
    await r.usage.setApiKey('AIza' + 'm'.repeat(35)); // manual entry (existing feature)
    await r.usage.updateSettings({ provider: 'google' });
    expect((await r.usage.translate('manual key')).source).toBe('google');
  });

  it('an admin API disabled in the OAuth client’s own project is reported as a setup problem, not as the user’s API', async () => {
    const r = rig();
    r.g.adminApiDisabled = 'cloudresourcemanager';
    await r.flow.connect();
    const e = await r.flow.listProjects().catch((x: SetupError) => x);
    expect((e as SetupError).code).toBe('INSUFFICIENT_PERMISSIONS');
    expect((e as SetupError).detail).toMatch(/resourcemanager/);
  });
});

describe('credential management', () => {
  it('survives a restart: state, secure key and provider are restored from storage', async () => {
    const a = rig();
    a.g.addProject('p1');
    await runAll(a, 'p1');
    const b = rig({ g: a.g, kv: a.kv, secrets: a.secrets }); // "browser / app restart"
    const st = await b.flow.status();
    expect(st).toMatchObject({ connected: true, project: { id: 'p1' }, account: 'user@example.com' });
    expect(st.keyHint).toHaveLength(4);
    expect((await b.usage.getSettings()).provider).toBe('google');
    expect((await b.usage.translate('after restart')).source).toBe('google');
  });

  it('a half-finished setup is resumed after a restart', async () => {
    const a = rig();
    a.g.addProject('p1');
    await a.flow.connect();
    await a.flow.selectProject('p1');
    const b = rig({ g: a.g, kv: a.kv, secrets: a.secrets });
    expect(await b.flow.state()).toMatchObject({ step: 'billing', project: { id: 'p1' } });
    await b.flow.reconnect(); // the token was memory-only, so sign in again; the progress is kept
    await b.flow.checkBilling();
    expect((await b.flow.state()).step).toBe('api');
  });

  it('replace key: the new key is validated first, then replaces the old one (also deleted at Google)', async () => {
    const r = rig();
    const p = r.g.addProject('p1');
    await runAll(r, 'p1');
    const oldKey = await r.usage.currentKey();
    await r.flow.connect(); // new session for the replacement
    await r.flow.replaceKey();
    const newKey = await r.usage.currentKey();
    expect(newKey).not.toBe(oldKey);
    expect(newKey.slice(-4)).toBe((await r.flow.state()).key!.hint);
    const live = [...p.keys.values()].filter((k) => !k.deleted);
    expect(live).toHaveLength(1);
    expect(live[0].keyString).toBe(newKey);
    expect((await r.usage.translate('with the new key')).source).toBe('google');
    expect(r.secrets.data.size).toBe(1); // exactly one secret: the current key
  });

  it('a failed replacement leaves the working key untouched', async () => {
    const r = rig({ retries: 1 });
    const p = r.g.addProject('p1');
    await runAll(r, 'p1');
    const oldKey = await r.usage.currentKey();
    await r.flow.connect();
    await r.flow.generateKey();
    p.billing = 'none'; // validation of the new key fails
    expect(await codeOf(r.flow.validate())).toBe('BILLING_NOT_ENABLED');
    expect(await codeOf(r.flow.activate())).toBe('INVALID_API_KEY');
    expect(await r.usage.currentKey()).toBe(oldKey);
  });

  it('disconnect: key removed from the device (and optionally at Google), back to on-device translation', async () => {
    const r = rig();
    const p = r.g.addProject('p1');
    await runAll(r, 'p1');
    expect((await r.usage.translate('x')).source).toBe('google');
    await r.flow.connect();
    await r.flow.disconnect({ deleteRemoteKey: true });
    expect(await r.usage.currentKey()).toBe('');
    expect(r.secrets.data.size).toBe(0);
    expect((await r.usage.getSettings()).provider).toBe('device');
    expect([...p.keys.values()].every((k) => k.deleted)).toBe(true);
    expect((await r.usage.translate('machine translation again')).source).toBe('device');
    expect((await r.flow.state()).step).toBe('intro');
  });

  it('disconnect without deleting the remote key needs no sign-in', async () => {
    const r = rig();
    r.g.addProject('p1');
    await runAll(r, 'p1');
    await r.flow.disconnect();
    expect(await r.usage.currentKey()).toBe('');
    expect((await r.usage.getSettings()).provider).toBe('device');
  });

  it('disconnect + connect again (sign out, sign in) starts a clean setup', async () => {
    const r = rig();
    r.g.addProject('p1');
    await runAll(r, 'p1');
    await r.flow.disconnect();
    await runAll(r, 'p1');
    expect((await r.flow.state()).step).toBe('done');
    expect((await r.usage.translate('again')).source).toBe('google');
  });

  it('health check: live validation of the saved key reports problems with the right code', async () => {
    const r = rig();
    const p = r.g.addProject('p1');
    await runAll(r, 'p1');
    expect((await r.flow.checkHealth()).ok).toBe(true);
    p.billing = 'suspended';
    expect((await r.flow.checkHealth()).error?.code).toBe('BILLING_ACCOUNT_SUSPENDED');
    p.billing = 'enabled';
    r.g.offline = true;
    expect((await r.flow.checkHealth()).error?.code).toBe('NETWORK_ERROR');
  });

  it('machine translation is independent of Smart Setup (device by default, never needs Google)', async () => {
    const r = rig();
    expect((await r.usage.getSettings()).provider).toBe('device');
    expect(await r.usage.translate('hello')).toEqual({ source: 'device' });
    expect(r.g.log).toHaveLength(0);
  });
});

describe('the key is never stored in the clear', () => {
  it('state, usage data and exports contain no key; only the secure store has it', async () => {
    const r = rig();
    r.g.addProject('p1');
    await runAll(r, 'p1');
    const key = await r.usage.currentKey();
    expect(key.startsWith('AIza')).toBe(true);
    const everything = JSON.stringify([...r.kv.data.entries()]);
    expect(everything).not.toContain(key);
    expect(await r.usage.exportReport('json')).not.toContain(key);
    expect(JSON.stringify(await r.usage.snapshot())).not.toContain(key);
    expect([...r.secrets.data.values()]).toContain(key);
    expect(r.kv.data.has('usage:apikey:v1')).toBe(false);
  });

  it('a plaintext key left by an earlier version is migrated into the secure store and deleted', async () => {
    const kv = memoryKV();
    const secrets = new MemorySecretStore();
    const legacy = 'AIza' + 'q'.repeat(35);
    await kv.set({ 'usage:apikey:v1': legacy });
    const usage = new UsageService(kv, { secrets });
    expect(await usage.currentKey()).toBe(legacy);
    expect(kv.data.has('usage:apikey:v1')).toBe(false);
    expect([...secrets.data.values()]).toEqual([legacy]);
  });

  it('WebCrypto store: AES-GCM ciphertext only, non-extractable key, tamper-proof, fresh IV each time', async () => {
    const kv = memoryKV();
    const keys = memoryKeyStorage();
    const store = new WebCryptoSecretStore(kv, keys);
    const secret = 'AIza' + 'z'.repeat(35);
    await store.set('k', secret);
    const raw = JSON.stringify(kv.data.get('secret:k'));
    expect(raw).not.toContain(secret);
    expect(await store.get('k')).toBe(secret);
    const cryptoKey = (await keys.load())!;
    expect(cryptoKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', cryptoKey)).rejects.toThrow();
    const iv1 = (kv.data.get('secret:k') as { iv: string }).iv;
    await store.set('k', secret);
    expect((kv.data.get('secret:k') as { iv: string }).iv).not.toBe(iv1);
    // tampering with the ciphertext → no secret (never garbage)
    const rec = kv.data.get('secret:k') as { v: number; iv: string; ct: string };
    kv.data.set('secret:k', { ...rec, ct: rec.ct.slice(0, -4) + 'AAAA' });
    expect(await store.get('k')).toBeNull();
    // a new store instance with the same key storage reads it back (restart)
    await store.set('k', secret);
    expect(await new WebCryptoSecretStore(kv, keys).get('k')).toBe(secret);
    await store.remove('k');
    expect(await store.get('k')).toBeNull();
  });
});

describe('error mapping and helpers', () => {
  const body = (status: string, reason: string, message = '') => ({ error: { message, status, details: [{ reason }] } });
  it.each([
    [400, body('INVALID_ARGUMENT', 'API_KEY_INVALID'), 'translate', 'INVALID_API_KEY'],
    [403, body('PERMISSION_DENIED', 'API_KEY_SERVICE_BLOCKED'), 'translate', 'API_KEY_RESTRICTED'],
    [403, body('PERMISSION_DENIED', 'API_KEY_HTTP_REFERRER_BLOCKED'), 'translate', 'API_KEY_RESTRICTED'],
    [403, body('PERMISSION_DENIED', 'SERVICE_DISABLED'), 'translate', 'TRANSLATION_API_DISABLED'],
    [403, body('PERMISSION_DENIED', 'BILLING_DISABLED'), 'translate', 'BILLING_NOT_ENABLED'],
    [403, body('PERMISSION_DENIED', 'BILLING_DISABLED', 'billing account is closed'), 'translate', 'BILLING_ACCOUNT_SUSPENDED'],
    [401, body('UNAUTHENTICATED', 'ACCESS_TOKEN_EXPIRED'), 'billing', 'GOOGLE_AUTH_FAILED'],
    [429, body('RESOURCE_EXHAUSTED', 'RATE_LIMIT_EXCEEDED'), 'translate', 'QUOTA_EXCEEDED'],
    [404, body('NOT_FOUND', ''), 'billing', 'PROJECT_NOT_FOUND'],
    [403, body('PERMISSION_DENIED', ''), 'serviceusage', 'INSUFFICIENT_PERMISSIONS'],
    [403, body('PERMISSION_DENIED', 'SERVICE_DISABLED'), 'apikeys', 'INSUFFICIENT_PERMISSIONS'],
    [503, null, 'translate', 'NETWORK_ERROR'],
  ] as const)('%i %j (%s) → %s', (status, b, service, code) => {
    expect(mapGoogleError(status, b, { service }).code).toBe(code);
  });
  it('key creation failures map to API_KEY_GENERATION_FAILED', () => {
    expect(mapGoogleError(403, body('PERMISSION_DENIED', ''), { service: 'apikeys', op: 'createKey' }).code).toBe('API_KEY_GENERATION_FAILED');
  });
  it('error details never echo a key', () => {
    const e = mapGoogleError(400, { error: { message: 'key AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA is bad' } }, { service: 'translate' });
    expect(e.detail).not.toMatch(/AIzaSy/);
  });
  it('project ids are valid Google project ids (6–30 chars, lowercase, start with a letter)', () => {
    for (const n of ['Lingolens Translation', 'Dự án dịch', '123', '', 'A very very very long project display name that exceeds']) {
      const id = makeProjectId(n);
      expect(id).toMatch(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/);
    }
  });
});

describe('one-tap setup (billing stays a step; the rest runs automatically)', () => {
  it('suggestProject: a previous Lingolens project, else the only project, else nothing', () => {
    const p = (id: string) => ({ projectId: id, displayName: id });
    expect(suggestProject([p('a'), p('lingolens-x-1234'), p('b')])?.projectId).toBe('lingolens-x-1234');
    expect(suggestProject([p('only')])?.projectId).toBe('only');
    expect(suggestProject([p('a'), p('b')])).toBeNull();
    expect(suggestProject([])).toBeNull();
  });

  it('autoSetup: APIs → key → validation → save & activate in one call, reporting progress', async () => {
    const r = rig();
    const proj = r.g.addProject('p1');
    await r.flow.connect();
    await r.flow.selectProject('p1');
    await r.flow.checkBilling();
    const phases: string[] = [];
    const s = await r.flow.autoSetup((p) => phases.push(p));
    expect(phases).toEqual(['api', 'key', 'validate', 'activate']);
    expect(s.step).toBe('done');
    expect([...proj.services].sort()).toEqual(['apikeys.googleapis.com', 'translate.googleapis.com']);
    expect((await r.usage.getSettings()).provider).toBe('google');
    expect((await r.usage.translate('one tap')).source).toBe('google');
  });

  it('autoSetup without billing stops with BILLING_NOT_ENABLED (billing is a real prerequisite) and nothing is activated', async () => {
    const r = rig({ retries: 1 });
    r.g.addProject('p1', { billing: 'none' });
    await r.flow.connect();
    await r.flow.selectProject('p1');
    expect(await codeOf(r.flow.autoSetup())).toBe('BILLING_NOT_ENABLED');
    expect((await r.usage.getSettings()).provider).toBe('device');
    expect(await r.usage.currentKey()).toBe('');
    // the user links billing, taps again: the same call resumes and finishes (no duplicate key is made)
    r.g.linkBilling('p1');
    await r.flow.autoSetup();
    expect((await r.flow.state()).step).toBe('done');
    expect([...r.g.projects.get('p1')!.keys.values()].filter((k) => !k.deleted)).toHaveLength(1);
  });

  it('autoSetup resumes after a network failure without redoing the finished phases', async () => {
    const r = rig();
    r.g.addProject('p1');
    await r.flow.connect();
    await r.flow.selectProject('p1');
    await r.flow.checkBilling();
    await r.flow.prepareApis();
    await r.flow.generateKey();
    r.g.offline = true;
    expect(await codeOf(r.flow.autoSetup())).toBe('NETWORK_ERROR');
    r.g.offline = false;
    const before = r.g.log.length;
    await r.flow.autoSetup();
    expect((await r.flow.state()).step).toBe('done');
    // the key made before the failure was reused, not recreated
    expect(r.g.log.slice(before).filter((l) => l.method === 'POST' && l.url.includes('/keys?keyId=')).length).toBe(0);
  });

  it('an existing Lingolens-Translation key (restricted to Translation) is REUSED; a replacement always creates a new one', async () => {
    const r = rig();
    const p = r.g.addProject('p1');
    await runAll(r, 'p1');
    const first = [...p.keys.keys()];
    expect(first).toHaveLength(1);
    await r.flow.disconnect();
    await runAll(r, 'p1'); // same project again
    expect([...p.keys.values()].filter((k) => !k.deleted)).toHaveLength(1); // no duplicate
    await r.flow.connect();
    await r.flow.replaceKey();
    expect([...p.keys.values()].filter((k) => !k.deleted)).toHaveLength(1); // old one removed after the new one worked
    expect([...p.keys.keys()].length).toBeGreaterThan(1);
  });

  it('a key that is not restricted to Translation is not reused', async () => {
    const r = rig();
    const p = r.g.addProject('p1', { services: new Set(['translate.googleapis.com', 'apikeys.googleapis.com']) });
    p.keys.set('projects/123/locations/global/keys/old', { displayName: 'Lingolens-Translation', apiTargets: [], keyString: 'AIzaSyOldUnrestricted' + 'z'.repeat(20) });
    await r.flow.connect();
    await r.flow.selectProject('p1');
    await r.flow.checkBilling();
    await r.flow.generateKey();
    expect(await r.usage.currentKey()).toBe('');
    const st = await r.flow.state();
    expect(st.key?.name).not.toBe('projects/123/locations/global/keys/old');
  });

  it('Billing page: verifyBilling reports pending, then enabled once the user linked billing (no sign-in)', async () => {
    const r = rig();
    const p = r.g.addProject('p1');
    await runAll(r, 'p1');
    expect((await r.flow.status()).billing).toBe('ok');
    p.billing = 'none'; // billing removed later
    const bad = await r.flow.verifyBilling();
    expect(bad.enabled).toBe(false);
    expect(bad.error?.code).toBe('BILLING_NOT_ENABLED');
    expect((await r.flow.status()).billing).toBe('pending');
    const signIns = r.oauth.signIns;
    r.g.linkBilling('p1');
    expect((await r.flow.verifyBilling()).enabled).toBe(true);
    expect((await r.flow.status()).billing).toBe('ok');
    expect(r.oauth.signIns).toBe(signIns); // no new sign-in
  });
});

describe('silent sign-in (access already granted)', () => {
  it('connectSilent picks up an existing browser session without a prompt, and returns null when there is none', async () => {
    const r = rig();
    expect(await r.flow.connectSilent()).toBeNull(); // the test provider has no silent session
    (r.oauth as { silent?: () => Promise<{ accessToken: string } | null> }).silent = async () => {
      r.g.validTokens.add('tok-1');
      return { accessToken: 'tok-1' };
    };
    const st = await r.flow.connectSilent();
    expect(st).not.toBeNull();
    expect(r.flow.hasSession).toBe(true);
    expect(r.oauth.signIns).toBe(0); // no interactive sign-in happened
  });
});
