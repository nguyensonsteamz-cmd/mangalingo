import { useState } from 'react';
import { IconButton } from '@/ui/components';
import { IconCheck, IconCopy } from '@/ui/icons';
import { copyText } from '@/mobile/ios';

/** Copies `text` (a function is evaluated at click time); shows a check mark for a moment. Works in the extension, the phone apps and the Web Reader popup. */
export function CopyButton({ text, label = 'Sao chép', className }: { text: string | (() => string); label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <IconButton
      label={done ? 'Đã sao chép' : label}
      className={className}
      data-ml-copy=""
      onClick={() =>
        void copyText(typeof text === 'function' ? text() : text).then((ok) => {
          if (!ok) return;
          setDone(true);
          setTimeout(() => setDone(false), 1300);
        })
      }
    >
      {done ? <IconCheck size={14} /> : <IconCopy size={14} />}
    </IconButton>
  );
}
