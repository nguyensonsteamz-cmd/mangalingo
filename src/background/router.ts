/**
 * Request router for messages arriving at the service worker. Pure dependency injection so it can
 * be integration-tested without Chrome.
 */
import type { DictStats, Envelope, ImportReport, Request, ResponseMap } from '@/shared/messages';
import { MessageError } from '@/shared/messages';
import type { LookupResult, OcrResult } from '@/shared/types';
import type { SidebarState } from './sidebar';
import type { UsageService } from '@/modules/usage';

export interface RouterDeps {
  lookup(req: Extract<Request, { type: 'lookup' }>['req']): Promise<LookupResult>;
  scan(jobId: string, target: Extract<Request, { type: 'ocr:scan' }>['target'], tab: { id?: number; windowId?: number }): Promise<OcrResult>;
  cancelScan(jobId: string): Promise<boolean>;
  /** Starts the OCR worker ahead of a scan (hover on a manga image, region selection). */
  warmOcr(lang: string): Promise<boolean>;
  clearOcrCache(): Promise<number>;
  sidebar: SidebarState;
  /** Must be called synchronously inside the user-gesture turn. */
  openSidePanel(tab: { id?: number; windowId?: number; url?: string }): Promise<void>;
  openOptions(section?: string): Promise<void>;
  openShortcuts(): Promise<void>;
  dictStats(): Promise<DictStats>;
  dictImport(name: string, format: 'json' | 'csv', text: string): Promise<ImportReport>;
  dictClearUser(): Promise<void>;
  /** Translation quota / cost protection (see src/modules/usage). */
  usage: UsageService;
}

type Handler<K extends Request['type']> = (msg: Extract<Request, { type: K }>, sender: chrome.runtime.MessageSender) => Promise<ResponseMap[K]>;

export function createRouter(d: RouterDeps) {
  const handlers: { [K in Request['type']]: Handler<K> } = {
    ping: async () => 'pong',
    lookup: (m) => d.lookup(m.req),
    'ocr:scan': (m, s) => d.scan(m.jobId, m.target, { id: s.tab?.id, windowId: s.tab?.windowId }),
    'ocr:cancel': (m) => d.cancelScan(m.jobId),
    'ocr:warmup': (m) => d.warmOcr(m.lang),
    'ocr:clear-cache': () => d.clearOcrCache(),
    'sidebar:open': async (m, s) => {
      // Open first (keeps the user gesture), then deliver the payload.
      const opening = d.openSidePanel({ id: s.tab?.id, windowId: s.tab?.windowId, url: s.tab?.url });
      if (m.payload) await d.sidebar.push(m.payload);
      await opening;
      return true;
    },
    'sidebar:push': async (m) => {
      await d.sidebar.push(m.payload);
      return true;
    },
    'options:open': async (m) => {
      await d.openOptions(m.section);
      return true;
    },
    'shortcuts:open': async () => {
      await d.openShortcuts();
      return true;
    },
    'dict:stats': () => d.dictStats(),
    'dict:import': (m) => {
      if (typeof m.text !== 'string' || m.text.length > 60 * 1024 * 1024) throw new MessageError('Tệp quá lớn (tối đa 60 MB).');
      return d.dictImport(String(m.name ?? 'import').slice(0, 60) || 'import', m.format === 'csv' ? 'csv' : 'json', m.text);
    },
    'dict:clear-user': async () => {
      await d.dictClearUser();
      return true;
    },
    // one chunk (≤ 5,000 characters): longer texts are split BEFORE this call, never cut here
    'usage:translate': (m) => d.usage.translate(String(m.text ?? ''), { idempotencyKey: m.idempotencyKey, keepBreaks: m.keepBreaks, languagePair: m.languagePair }),
    'usage:operation': async (m) => {
      await d.usage.completeOperation(String(m.jobId));
      return true;
    },
    'usage:device-processed': async (m) => {
      await d.usage.recordDeviceProcessed(String(m.provider), Number(m.chars) || 0, m.idempotencyKey);
      return true;
    },
    'usage:snapshot': () => d.usage.snapshot(),
    'usage:set-account': (m) => d.usage.setAccountUsage(m.chars, m.month, m.credentialId),
    'usage:settings': async (m) => {
      if (m.patch) await d.usage.updateSettings(m.patch);
      if (m.apiKey !== undefined) await d.usage.setApiKey(m.apiKey);
      return d.usage.snapshot();
    },
    'usage:authorize': async (m) => {
      await d.usage.setPaidAuthorized(!!m.enable);
      return d.usage.snapshot();
    },
    'usage:activate': async (m) => {
      await d.usage.activateGoogle(String(m.key ?? ''), m.credential);
      return d.usage.snapshot();
    },
    'usage:deactivate': async () => {
      await d.usage.deactivateGoogle();
      return d.usage.snapshot();
    },
    'usage:validate-saved': () => d.usage.validateSaved(),
    'usage:clear-history': async () => {
      await d.usage.clearHistory();
      return true;
    },
    'usage:reset': async () => {
      await d.usage.resetAll();
      return true;
    },
    'usage:export': (m) => d.usage.exportReport(m.format === 'csv' ? 'csv' : 'json'),
  };

  return async function route(msg: unknown, sender: chrome.runtime.MessageSender): Promise<Envelope<unknown> | undefined> {
    if (!msg || typeof msg !== 'object' || typeof (msg as { type?: unknown }).type !== 'string') return undefined;
    const m = msg as Request;
    const h = handlers[m.type] as Handler<typeof m.type> | undefined;
    if (!h) return undefined;
    try {
      return { ok: true, data: await h(m as never, sender) };
    } catch (e) {
      const err = e as MessageError;
      return { ok: false, error: err?.message ?? String(e), code: err?.code };
    }
  };
}
