/** Installs window.__mlReader (called by the native Web Reader through callAsyncJavaScript). iPhone app only. */
import { send } from '@/shared/messages';
import { machineTranslate } from '@/translation/chrome-mt';
import { vocabStore } from '@/ui/VocabManager';
import { POS_EN, POS_VI, primaryMeaning } from '@/ui/views';
import type { Pos } from '@/shared/types';
import { iosBridge } from './ios';
import { openLookup } from './Scan';
import { createReaderBridge } from './reader-bridge';

export function installReaderBridge(): void {
  if (!iosBridge()) return;
  const bridge = createReaderBridge({
    lookup: (req) => send({ type: 'lookup', req }),
    translate: (text) => machineTranslate(text),
    hasLemma: async (lemma) => !!(await vocabStore.findByLemma(lemma)),
    saveWord: async (e) => {
      await vocabStore.add(e);
    },
    openDetails: (text, context) => {
      (globalThis as { __mlNextSidebarTab?: string }).__mlNextSidebarTab = 'translation';
      openLookup(text);
      void context;
    },
    posLabel: (pos: Pos) => `${POS_EN[pos] ?? pos} · ${POS_VI[pos]}`,
    primaryMeaning,
  });
  // single-argument wrappers: Swift calls window.__mlReader[fn](arg) with one JSON value
  (globalThis as { __mlReader?: unknown }).__mlReader = {
    lookup: bridge.lookup,
    save: bridge.save,
    ocrBlocks: bridge.ocrBlocks,
    openDetails: (a: { text: string; context?: string }) => bridge.openDetails(a.text, a.context),
  };
}
