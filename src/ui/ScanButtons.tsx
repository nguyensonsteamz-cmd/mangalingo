import { useState } from 'react';
import { send, type ScanStartResult } from '@/shared/messages';
import { cx } from '@/ui/components';
import { IconCrop, IconScan } from '@/ui/icons';

const REASONS: Record<'site-off' | 'no-page' | 'unsupported', string> = {
  'site-off': 'Hãy bật LingoLens cho trang này trước (công tắc ở biểu tượng LingoLens).',
  'no-page': 'Không tìm thấy trang đang mở.',
  unsupported: 'Không quét được trên trang này (trang đặc biệt của trình duyệt).',
};

/**
 * "Quét ảnh (OCR)" = the main image of the page; "Chọn vùng quét" = drag a region. They start the same scan as the keyboard shortcut and
 * the right-click menu, in the active tab. Shown in the toolbar popup and in the sidebar.
 */
export function ScanButtons({ onStarted, className }: { onStarted?: (mode: 'image' | 'region') => void; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');
  const start = async (mode: 'image' | 'region') => {
    setBusy(true);
    setHint('');
    let r: ScanStartResult;
    try {
      r = await send({ type: 'scan:start', mode });
    } catch {
      r = { ok: false, reason: 'unsupported' };
    }
    setBusy(false);
    if (!r.ok) return setHint(REASONS[r.reason]);
    setHint(mode === 'region' ? 'Kéo chuột trên trang để chọn vùng cần quét.' : 'Đang quét ảnh chính của trang…');
    onStarted?.(mode);
  };
  const btn = 'ml-focus ml-press ml-sheen ml-ripple ml-glass-card flex items-center justify-center gap-1.5 rounded-2xl px-2 py-2.5 text-[12.5px] font-medium hover:border-accent/50 hover:text-accent disabled:opacity-50';
  return (
    <div className={className} data-ml-scan-buttons="">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" data-ml-magnetic="" disabled={busy} className={cx(btn)} onClick={() => void start('image')} data-ml-scan-image-btn="">
          <IconScan size={16} /> Quét ảnh (OCR)
        </button>
        <button type="button" data-ml-magnetic="" disabled={busy} className={cx(btn)} onClick={() => void start('region')} data-ml-scan-region-btn="">
          <IconCrop size={16} /> Chọn vùng quét
        </button>
      </div>
      {hint && (
        <div className="mt-1.5 text-[12px] text-muted" role="status" data-ml-scan-hint="">
          {hint}
        </div>
      )}
    </div>
  );
}
