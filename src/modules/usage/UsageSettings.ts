import type { UsageSettings } from './types';

/** Product decision (2026-11-23): Google Translate (web) is the default source on every platform. Text is sent to Google; the user can switch to on-device at any time. */
export const DEFAULT_USAGE_SETTINGS: UsageSettings = { provider: 'google-web' };

/**
 * Validates settings read from storage. The retired Google Cloud provider ('google') maps to Google Translate (web): those
 * users had chosen Google. Anything else unknown becomes the default.
 */
export function sanitizeUsageSettings(raw: Partial<UsageSettings> | undefined, base: UsageSettings = DEFAULT_USAGE_SETTINGS): UsageSettings {
  const p = raw?.provider as string | undefined;
  if (p === 'google-web' || p === 'device') return { provider: p };
  if (p === 'google') return { provider: 'google-web' };
  return { provider: base.provider };
}
