/** Small observable store for the in-page UI (no extra state library needed). */
import { useSyncExternalStore } from 'react';
import type { LookupRequest, LookupResult, OcrBlock, OcrResult } from '@/shared/types';
import type { Rect } from '@/popup/position';
import { DEFAULT_SETTINGS, type Settings } from '@/shared/settings';

export type PopupView =
  | { kind: 'lookup'; req: LookupRequest; result?: LookupResult; error?: string; loading: boolean }
  | { kind: 'ocr'; targetId: string; blockId: string; text: string; editing: boolean };

export interface OcrTarget {
  id: string;
  kind: 'image' | 'region';
  /** Image element for image scans. */
  el?: Element;
  /** Region in document coordinates (CSS px) for region scans. */
  region?: Rect;
  jobId?: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  progress: number;
  statusText: string;
  result?: OcrResult;
  error?: string;
  /** User corrections keyed by block id. */
  edits: Record<string, string>;
  /** Block currently being re-read after the user resized its box. */
  rescanning?: string;
  hidden: boolean;
}

export interface State {
  settings: Settings;
  /** prefer: 'side' places the popup beside its anchor (OCR speech bubbles). */
  popup: { open: boolean; anchor: Rect; stack: PopupView[]; tab: string; prefer?: 'side' } | null;
  trigger: { rect: Rect; text: string; context?: string } | null;
  hoverImage: { el: Element; rect: Rect } | null;
  targets: OcrTarget[];
  regionSelect: boolean;
  toast: { text: string; tone: 'info' | 'error' | 'ok'; id: number } | null;
  capturing: boolean;
}

type Listener = () => void;

export function createStore(initial: State) {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    set(patch: Partial<State> | ((s: State) => Partial<State>)) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...p };
      listeners.forEach((l) => l());
    },
    subscribe(l: Listener) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export const store = createStore({
  settings: DEFAULT_SETTINGS,
  popup: null,
  trigger: null,
  hoverImage: null,
  targets: [],
  regionSelect: false,
  toast: null,
  capturing: false,
});

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}

export function updateTarget(id: string, patch: Partial<OcrTarget>) {
  store.set((s) => ({ targets: s.targets.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
}

export function findBlock(targetId: string, blockId: string): { target: OcrTarget; block: OcrBlock } | null {
  const target = store.get().targets.find((t) => t.id === targetId);
  const block = target?.result?.blocks.find((b) => b.id === blockId);
  return target && block ? { target, block } : null;
}

let toastSeq = 0;
export function toast(text: string, tone: 'info' | 'error' | 'ok' = 'info') {
  const id = ++toastSeq;
  store.set({ toast: { text, tone, id } });
  setTimeout(() => {
    if (store.get().toast?.id === id) store.set({ toast: null });
  }, 3200);
}
