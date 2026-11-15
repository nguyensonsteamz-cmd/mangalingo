import { useEffect, useState } from 'react';
import { getTranslator, mtAvailability, type MtAvailability } from '@/translation/chrome-mt';
import { Button, Progress } from './components';

/** Live status of Chrome's EN→VI model, with the one-time download button. */
export function MtStatus() {
  const [a, setA] = useState<MtAvailability | 'checking'>('checking');
  const [p, setP] = useState<number | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    void mtAvailability().then(setA);
  }, []);
  const label: Record<string, string> = {
    checking: 'Đang kiểm tra…',
    available: 'Sẵn sàng — mô hình Anh → Việt đã có trên máy.',
    downloadable: 'Chưa tải mô hình Anh → Việt.',
    downloading: 'Chrome đang tải mô hình…',
    unavailable: 'Chrome trên máy này không hỗ trợ dịch Anh → Việt.',
    unsupported: 'Trình duyệt không có Translator API (cần Chrome 138+).',
  };
  return (
    <div className="space-y-1.5 py-2.5 text-[12.5px]" data-ml-mt-status={a}>
      <div className="text-muted">{label[a]}</div>
      {(a === 'downloadable' || a === 'downloading') && p === null && (
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            setP(0);
            getTranslator((x) => setP(x)).then(
              () => {
                setP(null);
                setA('available');
              },
              (e: Error) => {
                setP(null);
                setErr(e.message);
              },
            );
          }}
        >
          Tải mô hình dịch
        </Button>
      )}
      {p !== null && <Progress value={p} />}
      {err && <div className="text-danger">{err}</div>}
    </div>
  );
}
