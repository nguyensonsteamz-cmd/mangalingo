import type { Box } from '@/shared/types';
import type { RawBlock, RawLine } from '@/ocr/result';

/** Messages between the service worker and the offscreen OCR document. */
export type OffscreenRequest =
  | { target: 'offscreen'; type: 'prepare'; jobId: string; image: string; crop?: Box }
  | { target: 'offscreen'; type: 'recognize'; jobId: string; lang: string; layout: 'sparse' | 'auto' | 'block'; refine?: boolean }
  | { target: 'offscreen'; type: 'warmup'; lang: string }
  | { target: 'offscreen'; type: 'discard'; jobId: string }
  | { target: 'offscreen'; type: 'cancel'; jobId: string };

export interface PrepareResult {
  pixelKey: string;
  width: number;
  height: number;
}

/** One speech bubble found by the per-bubble second pass (coordinates of the processed image). */
export interface RefinedBubble {
  /** True when the text sits inside a closed light balloon (artwork around it was blanked). */
  enclosed: boolean;
  /** Lines come from the per-bubble pass (Tesseract's own line order is reliable on a clean crop). */
  pass2?: boolean;
  lines: RawLine[];
}

export interface RecognizeResult {
  blocks: RawBlock[];
  /** Full-page scans: one entry per detected bubble (replaces grouping of the first pass). */
  bubbles?: RefinedBubble[];
  /** Dimensions of the processed (scaled) image the bboxes refer to. */
  width: number;
  height: number;
  durationMs: number;
}

export interface OffscreenProgress {
  target: 'background';
  type: 'offscreen:progress';
  jobId: string;
  status: string;
  progress: number;
}
