import { DEFAULT_SETTINGS, mergeSettings, sanitizeSettings, type DeepPartial, type Settings } from '@/shared/settings';
import type { KV } from './kv';

export const SETTINGS_KEY = 'settings:v1';

export class SettingsStore {
  constructor(private kv: KV) {}

  async load(): Promise<Settings> {
    return sanitizeSettings(await this.kv.get(SETTINGS_KEY));
  }

  async update(patch: DeepPartial<Settings>): Promise<Settings> {
    const next = mergeSettings(await this.load(), patch);
    await this.kv.set({ [SETTINGS_KEY]: next });
    return next;
  }

  async replace(value: unknown): Promise<Settings> {
    const next = sanitizeSettings(value);
    await this.kv.set({ [SETTINGS_KEY]: next });
    return next;
  }

  async reset(): Promise<Settings> {
    await this.kv.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
    return sanitizeSettings(DEFAULT_SETTINGS);
  }

  /** Calls `cb` with the sanitised settings whenever they change in any context. */
  subscribe(cb: (s: Settings) => void): () => void {
    return this.kv.onChange((changes) => {
      if (SETTINGS_KEY in changes) cb(sanitizeSettings(changes[SETTINGS_KEY].newValue));
    });
  }
}
