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

/**
 * Splits text into sentence-sized pieces (≤ max characters). Browsers cut a long utterance after ~15 s (Chrome's speech engine stops
 * silently), so long text is spoken piece by piece. Nothing is dropped: the pieces joined give the original words.
 */
export function splitForSpeech(text: string, max = 200): string[] {
  const sentences = text.match(/[^.!?…;:]+[.!?…;:]*(?:["')\]]+)?\s*/g) ?? [text];
  const out: string[] = [];
  let cur = '';
  const push = () => {
    if (cur.trim()) out.push(cur.trim());
    cur = '';
  };
  for (const raw of sentences) {
    let part = raw;
    while (part.length > max) {
      // a very long sentence: cut at the last comma / space before the limit
      const cut = Math.max(part.lastIndexOf(', ', max), part.lastIndexOf(' ', max));
      const at = cut > 40 ? cut + 1 : max;
      if (cur) push();
      out.push(part.slice(0, at).trim());
      part = part.slice(at);
    }
    if ((cur + part).length > max) push();
    cur += part;
  }
  push();
  return out.filter(Boolean);
}

// Apple's joke / effect voices – unpleasant for reading sentences
const NOVELTY = /albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|ralph|kathy|grandma|grandpa|rocko|shelley|eddy|flo|reed|sandy/i;

function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices().filter((v) => !NOVELTY.test(v.name));
  const en = voices.filter((v) => v.lang.replace('_', '-').startsWith('en-US'));
  const any = en.length ? en : voices.filter((v) => v.lang.startsWith('en'));
  // natural-sounding voices first
  // on-device voices first: network voices ("Google US English") are the ones Chrome cuts off after ~15 s
  const rank = (v: SpeechSynthesisVoice) => (v.localService ? 0 : 10) + (/enhanced|premium|neural|natural|online/i.test(v.name) ? 0 : /samantha|google|microsoft|aria|jenny|guy|alex|ava|allison|tom/i.test(v.name) ? 1 : 2);
  return [...any].sort((a, b) => rank(a) - rank(b))[0];
}

/** Speaks English text; `rate` multiplies the user's speed (e.g. 0.95 for single words). */
export function speak(text: string, rate = 1): boolean {
  const clean = naturalCase(text.replace(/\s+/g, ' ').trim()).slice(0, 5000);
  if (!clean) return false;
  const r = Math.min(1.6, Math.max(0.4, speechRate * rate));
  const b = iosBridge();
  if (b) {
    void b.postMessage({ cmd: 'speak', text: clean, rate: r }).catch(() => {});
    return true;
  }
  if (!canSpeak()) return false;
  try {
    const synth = window.speechSynthesis;
    const busy = synth.speaking || synth.pending;
    synth.cancel();
    const v = pickVoice();
    const say = () => {
      for (const piece of splitForSpeech(clean)) {
        const u = new SpeechSynthesisUtterance(piece);
        u.lang = 'en-US';
        u.rate = r * 0.95;
        if (v) u.voice = v;
        synth.speak(u);
      }
    };
    // Chrome drops a speak() issued right after cancel(): give the engine a moment when it was busy
    if (busy) setTimeout(say, 60);
    else say();
    return true;
  } catch {
    return false;
  }
}
