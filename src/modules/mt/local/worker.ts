/// <reference lib="webworker" />
/**
 * Web Worker that runs the local translation model (ONNX Runtime Web, WASM, single thread) so the page never blocks while
 * translating. Protocol (see engine.ts): requests carry an id; answers are { id, type: 'progress' | 'done' | 'error' }.
 *  - prepare : download (once) and load the model; progress = bytes downloaded
 *  - translate : one text (a sentence / short paragraph, within the model's 512-token window)
 *  - cancel  : skip a queued request
 * Nothing here talks to any translation service: the only network access is the one-time model download from Hugging Face.
 */
import { env, pipeline } from '@huggingface/transformers';
import type { LocalModelSpec } from './models';

type Req =
  | { id: number; op: 'init'; wasmBase: string }
  | { id: number; op: 'prepare'; model: LocalModelSpec }
  | { id: number; op: 'translate'; model: LocalModelSpec; text: string }
  | { id: number; op: 'cancel'; target: number }
  | { id: number; op: 'drop'; modelId?: string };

type Translator = (text: string, o: Record<string, unknown>) => Promise<{ translation_text: string }[]>;
const ctx = self as unknown as DedicatedWorkerGlobalScope;
const models = new Map<string, Promise<Translator>>();
const cancelled = new Set<number>();
let queue: Promise<unknown> = Promise.resolve();

env.allowLocalModels = false;
env.useBrowserCache = true;

function load(spec: LocalModelSpec, id?: number): Promise<Translator> {
  let p = models.get(spec.id);
  if (!p) {
    const files = new Map<string, { loaded: number; total: number }>();
    p = pipeline('translation', spec.repo, {
      dtype: spec.dtype,
      revision: spec.revision,
      device: 'wasm',
      progress_callback: (e: { status?: string; file?: string; loaded?: number; total?: number }) => {
        if (e.status !== 'progress' || !e.file || id === undefined) return;
        files.set(e.file, { loaded: e.loaded ?? 0, total: e.total ?? 0 });
        let loaded = 0;
        let total = 0;
        for (const f of files.values()) {
          loaded += f.loaded;
          total += f.total;
        }
        ctx.postMessage({ id, type: 'progress', loaded, total });
      },
    } as never) as unknown as Promise<Translator>;
    p.catch(() => models.delete(spec.id)); // a failed load is retried next time, never cached as a failure
    models.set(spec.id, p);
  }
  return p;
}

async function handle(m: Req) {
  try {
    switch (m.op) {
      case 'init': {
        // ONNX Runtime's WASM files are shipped inside the app (no remote code); single thread (no cross-origin isolation needed)
        const wasm = env.backends.onnx.wasm as { wasmPaths?: unknown; numThreads?: number; proxy?: boolean };
        wasm.wasmPaths = m.wasmBase;
        wasm.numThreads = 1;
        wasm.proxy = false;
        ctx.postMessage({ id: m.id, type: 'done' });
        return;
      }
      case 'prepare':
        await load(m.model, m.id);
        ctx.postMessage({ id: m.id, type: 'done' });
        return;
      case 'translate': {
        if (cancelled.delete(m.id)) return ctx.postMessage({ id: m.id, type: 'error', message: 'cancelled', code: 'aborted' });
        let tr: Translator;
        try {
          tr = await load(m.model);
        } catch (e) {
          // the files are on the device but the model cannot be loaded: reported as damaged (the host deletes it)
          return ctx.postMessage({ id: m.id, type: 'error', code: 'load-failed', message: e instanceof Error ? e.message : String(e) });
        }
        if (cancelled.delete(m.id)) return ctx.postMessage({ id: m.id, type: 'error', message: 'cancelled', code: 'aborted' });
        const out = await tr(m.text, { num_beams: 4, max_new_tokens: 512 });
        ctx.postMessage({ id: m.id, type: 'done', text: out[0]?.translation_text ?? '' });
        return;
      }
      case 'drop':
        for (const k of [...models.keys()]) if (!m.modelId || k === m.modelId) models.delete(k);
        ctx.postMessage({ id: m.id, type: 'done' });
        return;
    }
  } catch (e) {
    ctx.postMessage({ id: m.id, type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}

ctx.onmessage = (e: MessageEvent<Req>) => {
  const m = e.data;
  if (m.op === 'cancel') {
    cancelled.add(m.target); // takes effect when the request reaches the front of the queue
    return;
  }
  queue = queue.then(() => handle(m));
};
