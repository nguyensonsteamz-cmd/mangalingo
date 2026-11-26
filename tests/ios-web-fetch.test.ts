import { afterEach, describe, expect, it } from 'vitest';
import { iosWebFetch } from '@/mobile/ios';
import { googleWebTranslate } from '@/modules/usage/google-web';

type Msg = { cmd: string; url: string };
function install(reply: (m: Msg) => unknown) {
  const sent: Msg[] = [];
  (globalThis as { webkit?: unknown }).webkit = { messageHandlers: { ml: { postMessage: async (m: Msg) => (sent.push(m), reply(m)) } } };
  return sent;
}
afterEach(() => {
  delete (globalThis as { webkit?: unknown }).webkit;
});

describe('iPhone: Google Translate (web) through the app shell', () => {
  it('is only used inside the iPhone app', () => {
    expect(iosWebFetch()).toBeUndefined();
  });
  it('the shell reply is read like a normal response: the translation comes back', async () => {
    const sent = install(() => ({ status: 200, url: 'https://translate.googleapis.com/translate_a/single', body: '[[["Xin chào","hello",null,null,10]],null,"en"]' }));
    const out = await googleWebTranslate('hello', 'en>vi', { fetchImpl: iosWebFetch() });
    expect(out).toBe('Xin chào');
    expect(sent[0].cmd).toBe('googleWebGet');
    expect(sent[0].url).toMatch(/^https:\/\/translate\.googleapis\.com\/translate_a\/single\?/);
  });
  it('Google limiting requests is now seen as such (status readable), not as "no network"', async () => {
    install(() => ({ status: 429, url: 'https://www.google.com/sorry/index', body: '<html>Sorry...</html>' }));
    const err = await googleWebTranslate('hello', 'en>vi', { fetchImpl: iosWebFetch() }).catch((e) => e);
    expect(err.code).toBe('CAPTCHA_REQUIRED');
  });
  it('a real network failure stays NETWORK_ERROR (no extra probe request)', async () => {
    const sent = install(() => ({ error: 'network' }));
    const err = await googleWebTranslate('hello', 'en>vi', { fetchImpl: iosWebFetch() }).catch((e) => e);
    expect(err.code).toBe('NETWORK_ERROR');
    expect(sent).toHaveLength(1);
  });
});
