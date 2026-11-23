import { useEffect, useState } from 'react';
import { getTranslator, googleActive, mtAvailability, type MtAvailability } from '@/translation/chrome-mt';
import { Button, Progress } from './components';

/** Live status of the translation source. With Google Translate (web), the default, there is no model to download: it says so. */
export function MtStatus() {
  const [a, setA] = useState<MtAvailability | 'checking'>('checking');
  const [p, setP] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const [google, setGoogle] = useState(false);
  useEffect(() => {
    void googleActive().then(setGoogle);
    void mtAvailability().then(setA);
  }, []);
  if (google) {
    return (
      <div className="space-y-1 py-2.5 text-[12.5px]" data-ml-mt-status="google-web">
        <div className="text-muted">Đang dùng Google Dịch (web): không cần tải mô hình.</div>
        <div className="text-subtle">Muốn dịch trên máy (không gửi văn bản đi), chọn “Trên máy” trong Cài đặt → Nguồn dịch.</div>
      </div>
    );
  }
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
