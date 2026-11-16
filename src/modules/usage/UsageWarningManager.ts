import type { UsageSnapshot, WarningLevel } from './types';

export interface UsageWarning {
  level: WarningLevel;
  severity: 'none' | 'info' | 'warn' | 'danger';
  message: string;
}

const MESSAGES: Record<WarningLevel, UsageWarning> = {
  ok: { level: 'ok', severity: 'none', message: '' },
  notice: { level: 'notice', severity: 'info', message: 'Lượng dịch đang gần hạn mức miễn phí hằng tháng.' },
  critical: { level: 'critical', severity: 'warn', message: 'Chỉ còn rất ít hạn mức dịch miễn phí.' },
  blocked: { level: 'blocked', severity: 'danger', message: 'Bạn đã đạt hạn mức dịch miễn phí đã cấu hình. Tiếp tục có thể phát sinh phí Google Cloud.' },
};

/** Maps the usage level to the warning to show, and tells listeners when the level changes. */
export class UsageWarningManager {
  private last: WarningLevel = 'ok';
  private listeners = new Set<(w: UsageWarning) => void>();

  warningFor(level: WarningLevel): UsageWarning {
    return MESSAGES[level];
  }

  /** Re-evaluates; listeners fire only when the level actually changed (so a warning is not repeated). */
  evaluate(snap: Pick<UsageSnapshot, 'level'>): UsageWarning {
    const w = this.warningFor(snap.level);
    if (snap.level !== this.last) {
      this.last = snap.level;
      this.listeners.forEach((l) => l(w));
    }
    return w;
  }

  onChange(cb: (w: UsageWarning) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}
