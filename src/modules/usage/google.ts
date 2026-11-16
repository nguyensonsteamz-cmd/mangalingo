/**
 * Google Cloud Translation (Basic, v2) client. The API key comes from the user's own settings (stored
 * locally, never in the source code) and is sent only to translation.googleapis.com.
 */
import { MessageError } from '@/shared/messages';

const ENDPOINT = 'https://translation.googleapis.com/language/translate/v2';

const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export async function googleTranslate(text: string, apiKey: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<string> {
  let res;
  try {
    res = await fetchImpl(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: text, source: 'en', target: 'vi', format: 'text' }),
    });
  } catch {
    // never echo the URL (it carries the key)
    throw new MessageError('Không kết nối được tới Google Cloud Translation. Kiểm tra mạng.', 'google-network');
  }
  if (!res.ok) {
    let detail = '';
    try {
      detail = String(((await res.json()) as { error?: { message?: string } })?.error?.message ?? '').replace(apiKey, '***');
    } catch {
      /* no body */
    }
    throw new MessageError(`Google Cloud Translation trả lỗi ${res.status}${detail ? `: ${detail}` : ''}`, `google-${res.status}`);
  }
  const body = (await res.json()) as { data?: { translations?: { translatedText?: string }[] } };
  const out = body?.data?.translations?.[0]?.translatedText;
  if (typeof out !== 'string') throw new MessageError('Google Cloud Translation trả về dữ liệu không hợp lệ.', 'google-bad-response');
  return decode(out);
}
