/**
 * Typed message contract between contexts. All requests go content/page → background
 * (`chrome.runtime.sendMessage`); background → tab events use `chrome.tabs.sendMessage`.
 */
import type { LookupRequest, LookupResult, OcrProgress, OcrResult } from './types';

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
      throw new MessageError('MangaLingo đã được cập nhật hoặc tải lại. Hãy tải lại trang này.', 'invalidated');
    }
    throw new MessageError(msg, 'transport');
  }
  if (!res) throw new MessageError('Không nhận được phản hồi từ background.', 'no-response');
  if (!res.ok) throw new MessageError(res.error, res.code);
  return res.data;
}
