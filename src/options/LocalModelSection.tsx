/**
 * Settings → "Hạn mức dịch" → "Mô hình dịch tải về": the optional local translation model (OPUS-MT).
 * Nothing is downloaded until the user presses a download button (the size is on the button); the model runs only on this device.
 */
import { useEffect, useState } from 'react';
import { Badge, Button, Notice, Progress, Toggle } from '@/ui/components';
import { send } from '@/shared/messages';
import { LOCAL_MODELS, type LocalModelSpec } from '@/modules/mt';
import { isLocalModelEnabled, currentPlatform, getMtPrefs, setMtPrefs, messageBackend } from '@/translation/mt-providers';

type St = { state: 'checking' | 'idle' | 'downloading' | 'ready' | 'error'; p: number; error?: string };
const mb = (b: number) => Math.round(b / 2 ** 20);

function ModelRow({ m, onChange }: { m: LocalModelSpec; onChange: () => void }) {
  const [st, setSt] = useState<St>({ state: 'checking', p: 0 });
  const refresh = () => messageBackend.cached(m).then((c) => setSt({ state: c ? 'ready' : 'idle', p: 0 }));
  useEffect(() => void refresh(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const download = () => {
    setSt({ state: 'downloading', p: 0 });
    messageBackend.prepare(m, (l, t) => setSt({ state: 'downloading', p: t ? l / t : 0 })).then(
      () => {
        setSt({ state: 'ready', p: 1 });
        onChange();
      },
      (e: Error) => setSt({ state: 'error', p: 0, error: e.message }),
    );
  };
  const remove = async () => {
    await send({ type: 'mtlocal:remove', modelId: m.id }).catch(() => {});
    await refresh();
    onChange();
  };
  return (
    <div className="flex flex-wrap items-center gap-2 py-3" data-ml-local-model={m.id}>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium text-text">{m.label}</div>
        <div className="text-[12px] text-muted">
          {m.upstream.repo} · giấy phép {m.upstream.license} · tải ≈ {mb(m.downloadBytes)} MB · RAM khi dịch ≈ {mb(m.peakRamBytes)} MB
        </div>
        {st.state === 'downloading' && (
          <div className="mt-1.5 space-y-1">
            <Progress value={st.p} />
            <div className="flex items-center gap-2 text-[12px] text-muted">
              <span>Đang tải… {Math.round(st.p * 100)}%</span>
              <Button size="sm" onClick={() => void messageBackend.cancel?.(m).then(refresh)} data-ml-local-cancel="">
                Huỷ
              </Button>
            </div>
          </div>
        )}
        {st.state === 'error' && <div className="mt-1 text-[12px] text-danger">Không tải được: {st.error}</div>}
      </div>
      {st.state === 'ready' ? (
        <>
          <Badge tone="ok">Đã tải</Badge>
          <Button size="sm" onClick={remove} data-ml-local-remove="">
            Gỡ
          </Button>
        </>
      ) : st.state === 'checking' || st.state === 'downloading' ? null : (
        <Button size="sm" variant="primary" onClick={download} data-ml-local-download="">
          Tải về (~{mb(m.downloadBytes)} MB)
        </Button>
      )}
    </div>
  );
}

/** iPhone: the downloaded model is not offered (the app page runs from a custom URL scheme where it is not verified); Apple Translation handles both directions there. */
export function LocalModelSection() {
  return currentPlatform() === 'ios' || !isLocalModelEnabled() ? null : <LocalModelCard />;
}

function LocalModelCard() {
  const [prefer, setPrefer] = useState(false);
  const [anyReady, setAnyReady] = useState(false);
  const refresh = () => {
    void getMtPrefs().then((p) => setPrefer(p.preferred === 'local'));
    void Promise.all(LOCAL_MODELS.map((m) => messageBackend.cached(m))).then((r) => setAnyReady(r.some(Boolean)));
  };
  useEffect(refresh, []);
  return (
    <section data-ml-local-section="">
      <div className="mb-2">
        <h2 className="text-[15px] font-semibold tracking-tight text-text">Mô hình dịch tải về (tuỳ chọn)</h2>
        <p className="mt-0.5 text-[12.5px] text-muted">
          OPUS-MT chạy hoàn toàn trên máy này (không gửi văn bản đi đâu, không tính phí). Dùng khi bộ dịch có sẵn của thiết bị không hỗ trợ cặp ngôn ngữ (ví dụ Việt → Anh trên iPhone). Mô hình chỉ được tải khi bạn bấm “Tải về”.
        </p>
      </div>
      <div className="ml-glass-card divide-y divide-border/60 rounded-[20px] px-4">
        {LOCAL_MODELS.map((m) => (
          <ModelRow key={m.id} m={m} onChange={refresh} />
        ))}
        <Toggle
          checked={prefer && anyReady}
          disabled={!anyReady}
          onChange={(v) => {
            setPrefer(v);
            void setMtPrefs({ preferred: v ? 'local' : 'auto' });
          }}
          label="Ưu tiên dùng mô hình này"
          description="Thay cho bộ dịch có sẵn của thiết bị. Mặc định tắt: trong thử nghiệm của LingoLens, bộ dịch có sẵn của Chrome cho chất lượng cao hơn."
        />
      </div>
      <div className="mt-2"><Notice tone="info">
        Chất lượng đo được (EN→VI chrF++ ≈ 44, VI→EN ≈ 54 trên bộ IWSLT/ALT) thấp hơn Chrome Translator (≈ 56). Câu kỹ thuật và thành ngữ có thể dịch sai; hãy kiểm tra lại các nội dung quan trọng.
      </Notice></div>
    </section>
  );
}
