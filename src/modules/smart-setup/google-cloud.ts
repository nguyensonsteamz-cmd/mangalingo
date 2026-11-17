/**
 * Google Cloud REST client for Smart Setup (documented v1/v2/v3 endpoints only):
 *   Resource Manager v3 · Service Usage v1 · Cloud Billing v1 · API Keys v2 · Cloud Translation v2 (validation).
 * The OAuth access token is passed per call and never stored here. Network is injectable for tests.
 */
import { SetupError, mapGoogleError, type GoogleService } from './errors';

export type FetchResponse = { ok: boolean; status: number; json(): Promise<unknown> };
export type FetchFn = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<FetchResponse>;

export interface ProjectInfo {
  projectId: string;
  displayName: string;
}
export interface KeyInfo {
  /** projects/NUMBER/locations/global/keys/UID */
  name: string;
  displayName: string;
  /** services the key is restricted to (empty = unrestricted) */
  apiTargets: string[];
}

export const TRANSLATE_SERVICE = 'translate.googleapis.com';
export const APIKEYS_SERVICE = 'apikeys.googleapis.com';
export const LINGOLENS_KEY_NAME = 'Lingolens-Translation';
/** Permissions Smart Setup needs on the project. */
export const REQUIRED_PERMISSIONS = ['resourcemanager.projects.get', 'serviceusage.services.get', 'serviceusage.services.enable', 'apikeys.keys.create', 'apikeys.keys.getKeyString'];

const RM = 'https://cloudresourcemanager.googleapis.com/v3';
const SU = 'https://serviceusage.googleapis.com/v1';
const BILLING = 'https://cloudbilling.googleapis.com/v1';
const KEYS = 'https://apikeys.googleapis.com/v2';
const TRANSLATE = 'https://translation.googleapis.com/language/translate/v2';
const MONITORING = 'https://monitoring.googleapis.com/v3';

export interface ClientOptions {
  fetchImpl?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

export class GoogleCloudClient {
  private f: FetchFn;
  private sleep: (ms: number) => Promise<void>;
  private interval: number;
  private timeout: number;

  constructor(o: ClientOptions = {}) {
    this.f = o.fetchImpl ?? ((url, init) => fetch(url, init) as unknown as Promise<FetchResponse>);
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.interval = o.pollIntervalMs ?? 1500;
    this.timeout = o.pollTimeoutMs ?? 90_000;
  }

  private async call(service: GoogleService, method: string, url: string, token: string | null, body?: unknown, op?: 'createKey'): Promise<unknown> {
    let res: FetchResponse;
    try {
      res = await this.f(url, {
        method,
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      // never echo the URL (it can carry the key)
      throw new SetupError('NETWORK_ERROR');
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* empty body */
    }
    if (!res.ok) throw mapGoogleError(res.status, json, { service, op });
    return json;
  }

  /** Long-running operations: poll until `done`; an error result is mapped like any other failure. */
  private async wait(service: GoogleService, base: string, op: { name?: string; done?: boolean; error?: unknown; response?: unknown }, token: string, kind?: 'createKey') {
    let cur = op;
    const started = Date.now();
    while (!cur.done) {
      if (Date.now() - started > this.timeout) throw new SetupError('NETWORK_ERROR', 'Google xử lý quá lâu (hết thời gian chờ).');
      await this.sleep(this.interval);
      cur = (await this.call(service, 'GET', `${base}/${cur.name}`, token)) as typeof cur;
    }
    if (cur.error) {
      const e = cur.error as { code?: number; message?: string; status?: string };
      throw mapGoogleError(e.code === 7 ? 403 : e.code === 5 ? 404 : e.code === 8 ? 429 : 400, { error: { message: e.message, status: e.status } }, { service, op: kind });
    }
    return cur.response as Record<string, unknown> | undefined;
  }

  // ---- usage of the whole project (Cloud Monitoring)
  /**
   * Characters the project translated between `start` and `end` (every device and platform that used its key), from the quota
   * usage metric of Cloud Translation. The quota metrics are summed per `quota_metric`; the ones that name characters are the
   * answer. When none does, the breakdown is returned with `chars: null` so the caller can say what was found.
   */
  async translateUsage(token: string, projectId: string, start: Date, end: Date): Promise<{ chars: number | null; byMetric: Record<string, number> }> {
    const span = Math.max(60, Math.ceil((end.getTime() - start.getTime()) / 1000));
    const filter = 'metric.type="serviceruntime.googleapis.com/quota/rate/net_usage" AND resource.type="consumer_quota" AND resource.labels.service="translate.googleapis.com"';
    const q = new URLSearchParams({
      filter,
      'interval.startTime': start.toISOString(),
      'interval.endTime': end.toISOString(),
      'aggregation.alignmentPeriod': `${span}s`,
      'aggregation.perSeriesAligner': 'ALIGN_SUM',
      'aggregation.crossSeriesReducer': 'REDUCE_SUM',
      view: 'FULL',
    });
    q.append('aggregation.groupByFields', 'metric.label.quota_metric');
    const r = (await this.call('monitoring', 'GET', `${MONITORING}/projects/${encodeURIComponent(projectId)}/timeSeries?${q.toString()}`, token)) as {
      timeSeries?: { metric?: { labels?: Record<string, string> }; points?: { value?: { int64Value?: string; doubleValue?: number } }[] }[];
    };
    const byMetric: Record<string, number> = {};
    for (const ts of r.timeSeries ?? []) {
      const name = ts.metric?.labels?.quota_metric ?? 'unknown';
      let sum = 0;
      for (const p of ts.points ?? []) sum += Number(p.value?.int64Value ?? p.value?.doubleValue ?? 0);
      byMetric[name] = (byMetric[name] ?? 0) + sum;
    }
    const chars = Object.entries(byMetric).filter(([k]) => /char/i.test(k));
    return { chars: chars.length ? chars.reduce((a, [, v]) => a + v, 0) : Object.keys(byMetric).length ? null : 0, byMetric };
  }

  // ---- account
  async userEmail(token: string): Promise<string | undefined> {
    try {
      const r = (await this.call('resourcemanager', 'GET', 'https://www.googleapis.com/oauth2/v3/userinfo', token)) as { email?: string };
      return r.email;
    } catch {
      return undefined;
    }
  }

  // ---- projects (Resource Manager v3)
  async listProjects(token: string): Promise<ProjectInfo[]> {
    const out: ProjectInfo[] = [];
    let page = '';
    for (let i = 0; i < 5; i++) {
      const r = (await this.call('resourcemanager', 'GET', `${RM}/projects:search?pageSize=100${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`, token)) as {
        projects?: { projectId: string; displayName?: string; state?: string }[];
        nextPageToken?: string;
      };
      for (const p of r.projects ?? []) if (!p.state || p.state === 'ACTIVE') out.push({ projectId: p.projectId, displayName: p.displayName || p.projectId });
      if (!r.nextPageToken) break;
      page = r.nextPageToken;
    }
    return out;
  }

  async createProject(token: string, projectId: string, displayName: string): Promise<ProjectInfo> {
    const op = (await this.call('resourcemanager', 'POST', `${RM}/projects`, token, { projectId, displayName })) as { name?: string; done?: boolean };
    await this.wait('resourcemanager', RM, op, token);
    return { projectId, displayName };
  }

  /** Which of the permissions Smart Setup needs the caller has on the project. */
  async missingPermissions(token: string, projectId: string): Promise<string[]> {
    const r = (await this.call('resourcemanager', 'POST', `${RM}/projects/${encodeURIComponent(projectId)}:testIamPermissions`, token, { permissions: REQUIRED_PERMISSIONS })) as { permissions?: string[] };
    const have = new Set(r.permissions ?? []);
    return REQUIRED_PERMISSIONS.filter((p) => !have.has(p));
  }

  async getProject(token: string, projectId: string): Promise<ProjectInfo> {
    const r = (await this.call('resourcemanager', 'GET', `${RM}/projects/${encodeURIComponent(projectId)}`, token)) as { projectId: string; displayName?: string; state?: string };
    if (r.state && r.state !== 'ACTIVE') throw new SetupError('PROJECT_NOT_FOUND', `Dự án ở trạng thái ${r.state}.`);
    return { projectId: r.projectId, displayName: r.displayName || r.projectId };
  }

  // ---- services (Service Usage v1)
  async isServiceEnabled(token: string, projectId: string, service: string): Promise<boolean> {
    const r = (await this.call('serviceusage', 'GET', `${SU}/projects/${encodeURIComponent(projectId)}/services/${service}`, token)) as { state?: string };
    return r.state === 'ENABLED';
  }

  async enableService(token: string, projectId: string, service: string): Promise<void> {
    const op = (await this.call('serviceusage', 'POST', `${SU}/projects/${encodeURIComponent(projectId)}/services/${service}:enable`, token, {})) as { name?: string; done?: boolean };
    await this.wait('serviceusage', SU, op, token);
  }

  // ---- billing (Cloud Billing v1, read only)
  async billingInfo(token: string, projectId: string): Promise<{ enabled: boolean; account?: string }> {
    const r = (await this.call('billing', 'GET', `${BILLING}/projects/${encodeURIComponent(projectId)}/billingInfo`, token)) as { billingEnabled?: boolean; billingAccountName?: string };
    return { enabled: !!r.billingEnabled, account: r.billingAccountName };
  }

  // ---- API keys (API Keys API v2)
  async listKeys(token: string, projectId: string): Promise<KeyInfo[]> {
    const r = (await this.call('apikeys', 'GET', `${KEYS}/projects/${encodeURIComponent(projectId)}/locations/global/keys`, token)) as {
      keys?: { name: string; displayName?: string; restrictions?: { apiTargets?: { service?: string }[] } }[];
    };
    return (r.keys ?? []).map((k) => ({ name: k.name, displayName: k.displayName ?? '', apiTargets: (k.restrictions?.apiTargets ?? []).map((t) => t.service ?? '') }));
  }

  /** Creates a key restricted to the Translation API and returns its name + key string. */
  async createKey(token: string, projectId: string, displayName = LINGOLENS_KEY_NAME): Promise<{ name: string; keyString: string }> {
    const keyId = `lingolens-translation-${Math.random().toString(36).slice(2, 8)}`;
    const op = (await this.call(
      'apikeys',
      'POST',
      `${KEYS}/projects/${encodeURIComponent(projectId)}/locations/global/keys?keyId=${keyId}`,
      token,
      { displayName, restrictions: { apiTargets: [{ service: TRANSLATE_SERVICE }] } },
      'createKey',
    )) as { name?: string; done?: boolean };
    const resp = await this.wait('apikeys', KEYS, op, token, 'createKey');
    const name = String((resp as { name?: string } | undefined)?.name ?? '');
    if (!name) throw new SetupError('API_KEY_GENERATION_FAILED', 'Google không trả về tên khoá.');
    return { name, keyString: await this.getKeyString(token, name) };
  }

  /** The key string of an existing key (needs apikeys.keys.getKeyString). */
  async getKeyString(token: string, keyName: string): Promise<string> {
    const ks = (await this.call('apikeys', 'GET', `${KEYS}/${keyName}/keyString`, token, undefined, 'createKey')) as { keyString?: string };
    if (!ks.keyString) throw new SetupError('API_KEY_GENERATION_FAILED', 'Google không trả về chuỗi khoá.');
    return ks.keyString;
  }

  async deleteKey(token: string, keyName: string): Promise<void> {
    await this.call('apikeys', 'DELETE', `${KEYS}/${keyName}`, token);
  }

  // ---- validation (Cloud Translation v2, the key itself)
  /** One real translation request; resolves with the translated sample when the key works. */
  async validateKey(apiKey: string): Promise<string> {
    const r = (await this.call('translate', 'POST', `${TRANSLATE}?key=${encodeURIComponent(apiKey)}`, null, { q: 'Hello', source: 'en', target: 'vi', format: 'text' })) as {
      data?: { translations?: { translatedText?: string }[] };
    };
    const t = r?.data?.translations?.[0]?.translatedText;
    if (typeof t !== 'string' || !t) throw new SetupError('INVALID_API_KEY', 'Google trả về dữ liệu không hợp lệ.');
    return t;
  }
}
