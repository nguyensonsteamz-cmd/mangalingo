/**
 * Pronunciation. In the iPhone app the system speech engine is used through the bridge (best
 * installed English voice); elsewhere the Web Speech API with a good voice (never Apple's novelty
 * voices such as "Albert" or "Bad News"). ALL CAPS comic text is read in normal case so the engine
 * does not spell it out. The speed comes from Settings (Tốc độ giọng đọc) or the 1× chip.
 */
import { naturalCase } from '@/translation/casing';

let speechRate = 1; // 1 = normal speed

/** Speed multiplier (0.5–1.5), applied from the settings. */
export function setSpeechRate(r: number) {
  if (Number.isFinite(r)) speechRate = Math.min(1.5, Math.max(0.5, r));
}
export const getSpeechRate = () => speechRate;

interface Bridge {
  postMessage(msg: unknown): Promise<unknown>;
}
const iosBridge = (): Bridge | undefined => (globalThis as { webkit?: { messageHandlers?: { ml?: Bridge } } }).webkit?.messageHandlers?.ml;

export function canSpeak(): boolean {
  if (iosBridge()) return true;
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

// Apple's joke / effect voices – unpleasant for reading sentences
const NOVELTY = /albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|ralph|kathy|grandma|grandpa|rocko|shelley|eddy|flo|reed|sandy/i;

function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices().filter((v) => !NOVELTY.test(v.name));
  const en = voices.filter((v) => v.lang.replace('_', '-').startsWith('en-US'));
  const any = en.length ? en : voices.filter((v) => v.lang.startsWith('en'));
  // natural-sounding voices first
  const rank = (v: SpeechSynthesisVoice) => (/enhanced|premium|neural|natural|online/i.test(v.name) ? 0 : /samantha|google|microsoft|aria|jenny|guy|alex|ava|allison|tom/i.test(v.name) ? 1 : 2);
  return [...any].sort((a, b) => rank(a) - rank(b))[0];
}

/** Speaks English text; `rate` multiplies the user's speed (e.g. 0.95 for single words). */
export function speak(text: string, rate = 1): boolean {
  const clean = naturalCase(text.replace(/\s+/g, ' ').trim()).slice(0, 600);
  if (!clean) return false;
  const r = Math.min(1.6, Math.max(0.4, speechRate * rate));
  const b = iosBridge();
  if (b) {
    void b.postMessage({ cmd: 'speak', text: clean, rate: r }).catch(() => {});
    return true;
  }
  if (!canSpeak()) return false;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'en-US';
    u.rate = r * 0.95;
    const v = pickVoice();
    if (v) u.voice = v;
    window.speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}
