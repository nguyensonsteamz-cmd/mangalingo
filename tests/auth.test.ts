import { describe, expect, it } from 'vitest';
import { isUnlocked } from '@/ui/auth';

describe('first-use sign-in gate', () => {
  it('locks a fresh install', () => expect(isUnlocked({}, false)).toBe(false));
  it('opens after Google sign-in', () => expect(isUnlocked({ signedIn: true }, false)).toBe(true));
  it('opens when sign-in cannot be offered yet and the user continued', () => expect(isUnlocked({ skipped: true }, false)).toBe(true));
  it('does not lock people who already had a Google key before this feature', () => expect(isUnlocked({}, true)).toBe(true));
});
