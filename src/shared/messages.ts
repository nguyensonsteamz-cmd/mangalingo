/**
 * Typed message contract between contexts. All requests go content/page → background
 * (`chrome.runtime.sendMessage`); background → tab events use `chrome.tabs.sendMessage`.
 */
import type { LookupRequest, LookupResult, OcrProgress, OcrResult } from './types';
import type { TranslateOutcome, UsageSettings, UsageSnapshot } from '@/modules/usage/types';

export interface ScanTarget {
  /** Image URL to fetch at full resolution (optional). */
  src?: string;
  /** Pixels already extracted by the content script (same-origin / CORS-enabled images). */
  dataUrl?: string;
  /** Viewport-relative rectangle (CSS px) of the visible scan area, for capture fallback. */
  viewportRect: { x: number; y: number; w: number; h: number };
  /** Portion of the target that the viewportRect covers, normalised 0..1 (for partial captures). */
  visibleFraction?: { x: number; y: number; w: number; h: number };
  devicePixelRatio: number;
  /** Stable key for the cache (image URL + natural size, or region hash computed later). */
  cacheKey?: string;
  layout: 'sparse' | 'auto' | 'block';
  lang: string;
  useCache: boolean;
}

export type SidebarPayload =
  | { type: 'lookup'; text: string; context?: string; result?: LookupResult; source?: { url?: string; title?: string } }
  | { type: 'ocr'; result?: OcrResult; pending?: boolean; error?: string; source?: { url?: string; title?: string } };

export type Request =
  | { type: 'lookup'; req: LookupRequest }
  | { type: 'ocr:scan'; jobId: string; target: ScanTarget }
  | { type: 'ocr:cancel'; jobId: string }
  | { type: 'ocr:warmup'; lang: string }
  | { type: 'ocr:clear-cache' }
  | { type: 'sidebar:open'; payload?: SidebarPayload }
  | { type: 'sidebar:push'; payload: SidebarPayload }
  | { type: 'options:open'; section?: string }
  | { type: 'dict:stats' }
  | { type: 'dict:import'; name: string; format: 'json' | 'csv'; text: string }
  | { type: 'dict:clear-user' }
  | { type: 'shortcuts:open' }
  /** Machine translation through the quota guard: tells the caller to use the device, or returns Google's text, or a block. */
  | { type: 'usage:translate'; text: string; /** stable key of a chunk: a retry is counted once */ idempotencyKey?: string; keepBreaks?: boolean; languagePair?: string }
  /** a finished translation job (any number of chunks) = one operation */
  | { type: 'usage:operation'; jobId: string }
  /** an on-device provider processed this many characters (informational ledger, not metered) */
  | { type: 'usage:device-processed'; provider: string; chars: number; idempotencyKey?: string }
  | { type: 'usage:snapshot' }
  /** characters Google reports for the whole account this month (read by the UI through Cloud Monitoring) */
  | { type: 'usage:set-account'; chars: number; month: string; credentialId?: string }
  /** Update the usage settings and / or the API key (null removes it); answers with a fresh snapshot. */
  | { type: 'usage:settings'; patch?: Partial<UsageSettings>; apiKey?: string | null }
  /** The user's explicit consent to paid translation (or its withdrawal). */
  | { type: 'usage:authorize'; enable: boolean }
  /** Smart Setup finished: save the (validated) key in the secure store and switch to Google translation. */
  | { type: 'usage:activate'; key: string; /** usage ledger id (the Smart Setup project) */ credential?: string }
  | { type: 'usage:deactivate' }
  /** One real translation with the SAVED key (health check); rejects with the Smart Setup error code. */
  | { type: 'usage:validate-saved' }
  | { type: 'usage:clear-history' }
  | { type: 'usage:reset' }
  | { type: 'usage:export'; format?: 'json' | 'csv' }
  | { type: 'ping' };

export interface DictStats {
  sources: { id: string; name: string; license: string; kind: string; entries: number | null }[];
  userEntries: number;
  userSets: { name: string; count: number; importedAt: number }[];
}

export interface ImportReport {
  imported: number;
  skipped: number;
  errors: string[];
}

export interface ResponseMap {
  lookup: LookupResult;
  'ocr:scan': OcrResult;
  'ocr:cancel': boolean;
  'ocr:warmup': boolean;
  'ocr:clear-cache': number;
  'sidebar:open': boolean;
  'sidebar:push': boolean;
  'options:open': boolean;
  'dict:stats': DictStats;
  'dict:import': ImportReport;
  'dict:clear-user': boolean;
  'shortcuts:open': boolean;
  'usage:translate': TranslateOutcome;
  'usage:operation': boolean;
  'usage:device-processed': boolean;
  'usage:snapshot': UsageSnapshot;
  'usage:set-account': UsageSnapshot;
  'usage:settings': UsageSnapshot;
  'usage:authorize': UsageSnapshot;
  'usage:activate': UsageSnapshot;
  'usage:deactivate': UsageSnapshot;
  'usage:validate-saved': { ok: boolean; code?: string; detail?: string };
  'usage:clear-history': boolean;
  'usage:reset': boolean;
  'usage:export': string;
  ping: string;
}

export type Envelope<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

/** Events pushed from background to a tab's content script. */
export type TabEvent =
  | { type: 'ocr:progress'; progress: OcrProgress }
  /** Sent around captureVisibleTab so the in-page UI can hide itself from the screenshot. */
  | { type: 'ocr:capture'; phase: 'begin' | 'end' }
  | { type: 'ml:ping' }
  | { type: 'cmd:lookup-selection' }
  | { type: 'cmd:scan-image' }
  | { type: 'ctx:lookup'; text: string }
  | { type: 'ctx:scan-image'; srcUrl?: string }
  | { type: 'ctx:scan-region' };

/** Broadcast from background to extension pages (side panel). */
export type PageEvent = { type: 'sidebar:update'; payload: SidebarPayload } | { type: 'sidebar:close' };

export class MessageError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

/** Send a typed request to the background and unwrap the envelope. */
export async function send<R extends Request>(req: R): Promise<ResponseMap[R['type']]> {
  let res: Envelope<ResponseMap[R['type']]> | undefined;
  try {
    res = await chrome.runtime.sendMessage(req);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (/Extension context invalidated/i.test(msg)) {
      throw new MessageError('LingoLens đã được cập nhật hoặc tải lại. Hãy tải lại trang này.', 'invalidated');
    }
    throw new MessageError(msg, 'transport');
  }
  if (!res) throw new MessageError('Không nhận được phản hồi từ background.', 'no-response');
  if (!res.ok) throw new MessageError(res.error, res.code);
  return res.data;
}
