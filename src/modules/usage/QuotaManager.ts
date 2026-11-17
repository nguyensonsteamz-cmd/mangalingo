import type { BlockedDecision, MonthlyUsage, UsageSettings, UsageState } from './types';
import { UsageMeter, effectiveChars } from './UsageMeter';

export type QuotaDecision = { action: 'allow'; billableChars: number; estimatedCostUsd: number } | { action: 'block'; decision: BlockedDecision };

const money = (n: number) => `$${n.toFixed(n < 0.1 ? 4 : 2)}`;

/**
 * Decides whether a request of `chars` characters may be sent: free quota, hard stop, explicit paid
 * authorisation and the configured limits (per request, paid characters / cost per month, paid requests per day).
 * `pending` = characters of requests that are in flight right now (reserved, not yet counted): they are part of the check so
 * simultaneous chunks cannot overshoot the quota.
 */
export class QuotaManager {
  constructor(private meter = new UsageMeter()) {}

  decide(state: UsageState, ledger: MonthlyUsage | undefined, s: UsageSettings, chars: number, pending = 0): QuotaDecision {
    const block = (reason: BlockedDecision['reason'], message: string, additional: number, needsConsent = false): QuotaDecision => ({
      action: 'block',
      decision: { reason, message, additionalChars: additional, estimatedCostUsd: this.meter.costOf(additional, s), needsConsent },
    });

    if (chars > s.maxCharsPerRequest) {
      return block('request-too-long', `Văn bản dài ${chars.toLocaleString('en-US')} ký tự, vượt giới hạn ${s.maxCharsPerRequest.toLocaleString('en-US')} ký tự cho mỗi yêu cầu.`, 0);
    }

    const used = (ledger ? effectiveChars(ledger) : 0) + pending;
    const after = used + chars;
    const free = s.freeQuotaChars;
    const hardLimit = Math.round(free * s.hardStopRatio);
    // characters of THIS request that fall beyond the free quota
    const additional = Math.max(0, Math.min(chars, after - free));

    if (after <= hardLimit) return { action: 'allow', billableChars: 0, estimatedCostUsd: 0 };

    // beyond the hard stop: never automatic. The user can authorise paid translation, use on-device translation, or change the key.
    if (!s.paidEnabled) {
      return block(
        'consent-needed',
        'Bạn đã đạt hạn mức dịch miễn phí đã cấu hình. Tiếp tục có thể phát sinh phí Google Cloud. Bạn có thể dùng dịch máy trên thiết bị (miễn phí) hoặc đổi sang khoá API khác.',
        additional,
        true,
      );
    }
    if (additional === 0) return { action: 'allow', billableChars: 0, estimatedCostUsd: 0 };

    // authorised, but never unlimited
    const paidAfter = (ledger?.paidChars ?? 0) + additional;
    if (paidAfter > s.maxPaidCharsPerMonth) {
      return block('limit-chars', `Đã chạm giới hạn ${s.maxPaidCharsPerMonth.toLocaleString('en-US')} ký tự trả phí mỗi tháng. Yêu cầu này đã bị chặn.`, additional);
    }
    const billableAfter = Math.max(0, after - free);
    const costAfter = this.meter.costOf(billableAfter, s);
    if (costAfter > s.maxMonthlyCostUsd) {
      return block('limit-cost', `Chi phí ước tính tháng này (${money(costAfter)}) sẽ vượt giới hạn ${money(s.maxMonthlyCostUsd)}. Yêu cầu này đã bị chặn.`, additional);
    }
    if (state.day.paidRequests >= s.maxPaidRequestsPerDay) {
      return block('limit-requests', `Đã chạm giới hạn ${s.maxPaidRequestsPerDay} yêu cầu trả phí mỗi ngày. Yêu cầu này đã bị chặn.`, additional);
    }
    return { action: 'allow', billableChars: additional, estimatedCostUsd: this.meter.costOf(additional, s) };
  }
}
