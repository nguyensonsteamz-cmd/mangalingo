import { useState } from 'react';
import { IconButton } from '@/ui/components';
import { IconCheck, IconCopy, IconX } from '@/ui/icons';
import { copyText } from '@/mobile/ios';

/** Copies `text` (a function is evaluated at click time); shows a check mark for a moment. Works in the extension, the phone apps and the Web Reader popup. */
export function CopyButton({ text, label = 'Sao chép', className }: { text: string | (() => string); label?: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'fail'>('idle');
  return (
    <IconButton
      label={state === 'done' ? 'Đã sao chép' : state === 'fail' ? 'Không chép được: hãy bôi đen rồi nhấn Ctrl+C' : label}
      className={className}
      data-ml-copy=""
      data-ml-copy-state={state}
      onClick={() =>
        // a failure is shown (red cross), never silent
        void copyText(typeof text === 'function' ? text() : text).then((ok) => {
          setState(ok ? 'done' : 'fail');
          setTimeout(() => setState('idle'), ok ? 1300 : 2500);
        })
      }
    >
      {state === 'done' ? <IconCheck size={14} /> : state === 'fail' ? <IconX size={14} /> : <IconCopy size={14} />}
    </IconButton>
  );
}
