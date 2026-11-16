/**
 * Notes drawer: slides in from the right edge (right → left) over the scan page. Lists the reader's
 * notes (search, copy, save to the notebook, delete, copy all) and lets them write new ones as
 * phrase / meaning pairs – two differently tinted fields per numbered, colour-striped pair.
 */
import { useEffect, useState } from 'react';
import { cx } from '@/ui/components';
import { NotesPanel } from './NotesPanel';
import { useNotes } from './notes';

export function NotesDrawer({ open, onClose, context }: { open: boolean; onClose: () => void; context?: string }) {
  const notes = useNotes();
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
    else {
      const t = setTimeout(() => setMounted(false), 320);
      return () => clearTimeout(t);
    }
  }, [open]);
  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-[45]" data-ml-notes-drawer="">
      <div className={cx('absolute inset-0 bg-black/35 transition-opacity duration-300', open ? 'opacity-100' : 'opacity-0')} onClick={onClose} />
      <aside
        className={cx(
          'ml-glass absolute bottom-0 right-0 top-0 flex w-[88vw] max-w-[400px] flex-col rounded-l-[28px] pt-[calc(env(safe-area-inset-top)+12px)] transition-transform duration-[340ms] ease-[cubic-bezier(.22,1,.36,1)]',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        style={{ animation: open ? 'ml-drawer-in 340ms cubic-bezier(.22,1,.36,1)' : undefined }}
      >
        <div className="flex items-center gap-2 px-4 pb-2">
          <div className="min-w-0 flex-1">
            <div className="text-[18px] font-bold">✏️ Ghi chú</div>
            <div className="text-[12px] text-subtle">{notes.length} ghi chú</div>
          </div>
          <button type="button" onClick={onClose} className="ml-press rounded-full bg-text/[0.08] px-3 py-1.5 text-[13px] font-semibold text-muted">
            Đóng
          </button>
        </div>

        <div className="ml-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
          <NotesPanel context={context} />
        </div>
      </aside>
    </div>
  );
}
