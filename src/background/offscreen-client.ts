import type { OffscreenRequest } from '@/offscreen/protocol';
import { MessageError } from '@/shared/messages';

const PATH = 'offscreen/index.html';
let creating: Promise<void> | null = null;

async function hasDocument(): Promise<boolean> {
  const url = chrome.runtime.getURL(PATH);
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [url] });
  return contexts.length > 0;
}

export async function ensureOffscreen(): Promise<void> {
  if (await hasDocument()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: PATH,
      reasons: [chrome.offscreen.Reason.WORKERS, chrome.offscreen.Reason.BLOBS],
      justification: 'Run the local Tesseract OCR worker on manga images (no data leaves the device).',
    })
    .catch((e: Error) => {
      if (!/single offscreen|already exists/i.test(e.message)) throw e;
    })
    .finally(() => (creating = null));
  await creating;
}

export async function callOffscreen<T>(msg: OffscreenRequest): Promise<T> {
  await ensureOffscreen();
  const res = (await chrome.runtime.sendMessage(msg)) as { ok: boolean; data?: T; error?: string; code?: string } | undefined;
  if (!res) throw new MessageError('OCR host không phản hồi.', 'offscreen');
  if (!res.ok) throw new MessageError(res.error ?? 'OCR thất bại.', res.code);
  return res.data as T;
}
