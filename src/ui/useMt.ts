import { useEffect, useState } from 'react';
import type { Settings } from '@/shared/settings';
import { getTranslator, machineTranslate, mtAvailability, translatorReady } from '@/translation/chrome-mt';

/**
 * Machine-translates a short text (a word, a definition) with Chrome's on-device translator when
 * the translation mode is "machine". Returns undefined while pending, null when unavailable.
 * Starts the one-time model download only if the user has just clicked (Chrome requires a gesture);
 * otherwise waits for a download started elsewhere (preload, "Tải mô hình dịch" button).
 */
export function useMt(text: string | undefined, s: Settings): string | null | undefined {
  const on = s.reading.translationMode === 'machine' && !!text?.trim();
  const [out, setOut] = useState<string | null | undefined>(on ? undefined : null);
  useEffect(() => {
    if (!on) {
      setOut(null);
      return;
    }
    let alive = true;
    setOut(undefined);
    void mtAvailability().then((a) => {
      if (!alive) return;
      if (a === 'unsupported' || a === 'unavailable') return setOut(null);
      if (a === 'downloadable' && (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive) {
        void getTranslator().catch(() => {});
      }
      (a === 'available' ? Promise.resolve() : translatorReady())
        .then(() => machineTranslate(text!))
        .then(
          (r) => alive && setOut(r),
          () => alive && setOut(null),
        );
    });
    return () => {
      alive = false;
    };
  }, [text, on]);
  return on ? out : null;
}
