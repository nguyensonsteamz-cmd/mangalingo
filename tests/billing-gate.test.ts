import { describe, expect, it, vi } from 'vitest';
import { authorizePaidWithBillingCheck, isBillingCode } from '@/ui/billing-gate';

const deps = (check: () => Promise<{ ok: boolean; code?: string }>) => ({ validateSaved: vi.fn(check), authorize: vi.fn(async () => undefined), openBilling: vi.fn() });

describe('"Cho phép dịch có phí" checks billing first', () => {
  it('billing works → paid translation is authorised, no jump to the Billing page', async () => {
    const d = deps(async () => ({ ok: true }));
    expect(await authorizePaidWithBillingCheck(d)).toEqual({ authorized: true, needsBilling: false });
    expect(d.authorize).toHaveBeenCalledOnce();
    expect(d.openBilling).not.toHaveBeenCalled();
  });
  it.each(['BILLING_NOT_ENABLED', 'BILLING_ACCOUNT_SUSPENDED'])('%s → NOT authorised, the Billing page opens', async (code) => {
    const d = deps(async () => ({ ok: false, code }));
    expect(await authorizePaidWithBillingCheck(d)).toEqual({ authorized: false, needsBilling: true });
    expect(d.authorize).not.toHaveBeenCalled();
    expect(d.openBilling).toHaveBeenCalledOnce();
  });
  it('an inconclusive check (offline, other error) does not block: the paid request reports a real problem itself', async () => {
    for (const r of [async () => ({ ok: false, code: 'NETWORK_ERROR' }), async () => Promise.reject(new Error('boom'))]) {
      const d = deps(r as never);
      expect((await authorizePaidWithBillingCheck(d)).authorized).toBe(true);
      expect(d.openBilling).not.toHaveBeenCalled();
    }
  });
  it('only billing codes count as "no billing"', () => {
    expect(isBillingCode('BILLING_NOT_ENABLED')).toBe(true);
    expect(isBillingCode('INVALID_API_KEY')).toBe(false);
    expect(isBillingCode(undefined)).toBe(false);
  });
});
