/**
 * "Cho phép dịch có phí": before paid translation is authorised, check that the project has billing. If it does the
 * request goes on; if it clearly does not, the user is sent to the Billing page (Settings → Billing) instead.
 * Kept free of UI so it can be tested.
 */
export interface GateDeps {
  /** One real translation with the saved key (what the Billing page uses too). */
  validateSaved(): Promise<{ ok: boolean; code?: string }>;
  authorize(): Promise<unknown>;
  openBilling(): void;
}

export const isBillingCode = (code?: string) => code === 'BILLING_NOT_ENABLED' || code === 'BILLING_ACCOUNT_SUSPENDED';

export async function authorizePaidWithBillingCheck(d: GateDeps): Promise<{ authorized: boolean; needsBilling: boolean }> {
  const r = await d.validateSaved().catch(() => ({ ok: false, code: 'NETWORK_ERROR' as string | undefined }));
  if (!r.ok && isBillingCode(r.code)) {
    d.openBilling();
    return { authorized: false, needsBilling: true };
  }
  // billing works, or the check was inconclusive (offline…): the paid request itself reports a real problem
  await d.authorize();
  return { authorized: true, needsBilling: false };
}
