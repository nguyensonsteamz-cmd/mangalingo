/**
 * Unified translation provider interface. Every way LingoLens can translate (the platform's own translator, a downloaded local
 * model, the user's own Google Cloud key) is an `MtProvider`; the registry (registry.ts) picks one per request.
 * Providers do NOT all support the same things: `capabilities` says what each one can do and callers must check it.
 */
export type Lang = 'en' | 'vi';
export interface LanguagePair {
  source: Lang;
  target: Lang;
}
export const pairKey = (p: LanguagePair) => `${p.source}-${p.target}`;
export const EN_VI: LanguagePair = { source: 'en', target: 'vi' };
export const VI_EN: LanguagePair = { source: 'vi', target: 'en' };
export const reversePair = (p: LanguagePair): LanguagePair => ({ source: p.target, target: p.source });

/** native = the OS / browser translator; local-model = a model LingoLens downloads and runs itself; cloud-byok = the user's own cloud key */
export type ProviderKind = 'native' | 'local-model' | 'cloud-byok';
export type Platform = 'chrome' | 'android' | 'ios';
export type Availability = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported';

export interface ProviderCapabilities {
  pairs: LanguagePair[];
  platforms: Platform[];
  /** text never leaves the device */
  local: boolean;
  /** usage is metered / may cost money */
  metered: boolean;
  /** can be cancelled while a request is in flight (otherwise the result is just ignored) */
  cancellable: boolean;
  /** reports progress for a single request (rare; chunk-level progress is the runner's job) */
  streaming: boolean;
  /** needs a model / language pack on the device before first use */
  needsDownload: boolean;
}

export interface ResourceRequirements {
  downloadBytes?: number;
  diskBytes?: number;
  /** approximate peak RAM while translating, measured (see docs/TRANSLATION_BENCHMARK_LAB.md) */
  peakRamBytes?: number;
}

export interface ProviderLimitsInfo {
  /** preferred / hard chunk size, in code points (API providers) */
  targetChars: number;
  maxChars: number;
  /** local models are limited by tokens, not characters; the adapter converts to a conservative character size */
  maxTokens?: number;
}

export interface TranslateRequest {
  text: string;
  pair: LanguagePair;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** same key = same chunk: a metered provider must count it once */
  idempotencyKey?: string;
  keepBreaks?: boolean;
  onProgress?: (fraction: number) => void;
}

export interface TranslateResponse {
  text: string;
  providerId: string;
  modelId?: string;
  pair: LanguagePair;
  /** characters (code points) of the source text that were processed */
  chars: number;
}

export type MtErrorCode =
  | 'unsupported-pair'
  | 'unavailable'
  | 'needs-download'
  | 'timeout'
  | 'aborted'
  | 'blocked'
  | 'no-provider'
  | 'provider-error';

export class MtError extends Error {
  constructor(
    public code: MtErrorCode,
    message: string,
    public extra: { providerId?: string; retryable?: boolean; fatal?: boolean; detail?: unknown } = {},
  ) {
    super(message);
    this.name = 'MtError';
  }
}

export interface MtProvider {
  /** stable id, e.g. 'device-chrome', 'google-v2', 'local-opus-mt' */
  readonly id: string;
  readonly kind: ProviderKind;
  readonly label: string;
  /** exact model / checkpoint for local models */
  readonly modelId?: string;
  readonly capabilities: ProviderCapabilities;
  readonly resources?: ResourceRequirements;
  readonly limits: ProviderLimitsInfo;
  availability(pair: LanguagePair): Promise<Availability>;
  /** downloads / warms the model. Only ever called after the user agreed (see `confirm` in the registry). */
  prepare?(pair: LanguagePair, onProgress?: (fraction: number) => void): Promise<void>;
  translate(req: TranslateRequest): Promise<TranslateResponse>;
  dispose?(): Promise<void> | void;
}

/** What the user chose (stored in the existing settings; defaults reproduce today's behaviour). */
export interface SelectionConfig {
  /** 'auto' = local providers only, by priority; a provider id = exactly that provider (no silent switching) */
  preferred: string;
  platform: Platform;
  /** a valid key / credential exists for cloud-byok providers */
  cloudReady: boolean;
  /** explicit consent to metered use (the quota guard still applies on top) */
  allowMetered?: boolean;
}
