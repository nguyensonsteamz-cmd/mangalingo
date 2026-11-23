import type { UsageSettings } from './types';

export const DEFAULT_USAGE_SETTINGS: UsageSettings = { provider: 'device' };

/** Validates settings read from storage. Anything unknown (e.g. the retired Google Cloud provider) becomes the default: on-device. */
export function sanitizeUsageSettings(raw: Partial<UsageSettings> | undefined, base: UsageSettings = DEFAULT_USAGE_SETTINGS): UsageSettings {
  return { provider: raw?.provider === 'google-web' || raw?.provider === 'device' ? raw.provider : base.provider };
}
