/**
 * Lingolens Smart Setup (Settings → "Smart Setup"): set up Google Cloud Translation with the user's OWN Google
 * Cloud project, step by step. Same flow on Chrome, iPhone and Android. Lingolens never pays for translation,
 * never links billing for the user, and never sees the API key (it goes to the device's secure storage).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge, Button, Spinner, cx } from '@/ui/components';
import { getSmartSetup, openConsole } from '@/ui/smart-setup-client';
import { useUsage } from '@/ui/usage-client';
import { ERROR_INFO, SetupError, suggestProject, type ProjectInfo, type SetupState, type SetupStep } from '@/modules/smart-setup';

type Status = Awaited<ReturnType<ReturnType<typeof getSmartSetup>['status']>>;

const STEPS: { id: SetupStep; label: string }[] = [
  { id: 'connect', label: 'Google' },
  { id: 'project', label: 'Dự án' },
  { id: 'billing', label: 'Billing' },
  { id: 'api', label: 'Tự động' },
  { id: 'done', label: 'Xong' },
];
/** API, key and validation are ONE automatic stage */
const stageOf = (s: SetupStep): SetupStep => (s === 'key' || s === 'validate' ? 'api' : s);
const isAuto = (s: SetupStep) => s === 'api' || s === 'key' || s === 'validate';

const fmtTime = (t?: number) => (t ? new Date(t).toLocaleString('vi-VN') : '—');

function GlassCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('ml-glass-card relative overflow-hidden rounded-[22px] p-4', className)}>{children}</div>;
}

/** Progress of the setup: 7 steps, the current one highlighted, finished ones filled. */
function Progress({ step, busy }: { step: SetupStep; busy: boolean }) {
  const idx = Math.max(0, STEPS.findIndex((s) => s.id === stageOf(step)));
  return (
    <div data-ml-setup-progress={step}>
      <div className="mb-2 flex items-center justify-between text-[12px] text-muted">
        <span>Bước {step === 'intro' ? 0 : idx + 1} / {STEPS.length}</span>
        <span>{step === 'intro' ? 'Giới thiệu' : STEPS[idx].label}</span>
      </div>
      <div className="flex gap-1">
        {STEPS.map((s, i) => (
          <div key={s.id} className="h-1.5 flex-1 overflow-hidden rounded-full bg-text/[0.1]">
            <div className={cx('h-full rounded-full bg-gradient-to-r from-[#3451d1] to-[#8b5cf6] transition-[width] duration-500', busy && i === idx && 'ml-setup-busy')} style={{ width: i < idx || step === 'done' ? '100%' : i === idx ? '55%' : '0%' }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Error recovery: cause, what to do, retry just this step, open the right Console page, go back one step. */
function ErrorRecovery({ error, projectId, onRetry, onBack, onClose, retryLabel }: { error: SetupError; projectId?: string; onRetry: () => void; onBack?: () => void; onClose: () => void; retryLabel?: string }) {
  const info = ERROR_INFO[error.code];
  return (
    <div className="rounded-2xl border-2 border-danger/50 bg-danger/10 p-3.5" role="alert" data-ml-setup-error={error.code}>
      <div className="text-[14px] font-bold text-text">⚠️ {info.title}</div>
      <div className="mt-1.5 text-[12.5px] leading-snug text-muted">
        <b className="text-text">Nguyên nhân:</b> {info.cause}
      </div>
      <div className="mt-1 text-[12.5px] leading-snug text-muted">
        <b className="text-text">Cách xử lý:</b> {info.fix}
      </div>
      {error.detail && <div className="mt-1.5 break-words rounded-lg bg-text/[0.06] px-2 py-1 font-mono text-[11px] text-subtle">{error.detail}</div>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={onRetry} data-ml-setup-retry="">
          {retryLabel ?? 'Thử lại'}
        </Button>
        {info.consoleUrl && (
          <Button size="sm" onClick={() => openConsole(info.consoleUrl!(projectId))} data-ml-setup-console="">
            {info.consoleLabel ?? 'Mở Google Cloud Console'} ↗
          </Button>
        )}
        {onBack && (
          <Button size="sm" onClick={onBack}>
            ‹ Bước trước
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onClose}>
          Đóng
        </Button>
      </div>
    </div>
  );
}

function Notes({ items }: { items: string[] }) {
  return (
    <ul className="mt-2 space-y-1 text-[12.5px] leading-snug text-muted">
      {items.map((t) => (
        <li key={t} className="flex gap-2">
          <span className="text-ok">✓</span>
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

export function SmartSetupSection() {
  const flow = getSmartSetup();
  const { snap } = useUsage();
  const [state, setState] = useState<SetupState | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<SetupError | null>(null);
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null);
  const [picked, setPicked] = useState('');
  const [newName, setNewName] = useState('Lingolens Translation');
  const [phase, setPhase] = useState<'api' | 'key' | 'validate' | 'activate'>('api');
  const [deleteRemote, setDeleteRemote] = useState(false);
  const [health, setHealth] = useState<{ ok: boolean; at: number } | null>(null);
  const retry = useRef<() => Promise<void>>(async () => {});
  const billingAuto = useRef('');

  const reload = useCallback(async () => {
    setState(await flow.state());
    setStatus(await flow.status());
  }, [flow]);

  useEffect(() => {
    void reload();
    void flow.configured().then(setConfigured);
  }, [flow, reload]);

  // the status follows the usage data (key saved / removed elsewhere)
  useEffect(() => {
    void reload();
  }, [snap?.hasKey, snap?.keyHint, reload]);

  /** Runs one action; a failure shows the recovery card and remembers how to retry just that action. */
  const act = useCallback(
    (label: string, fn: () => Promise<unknown>) => {
      const run = async () => {
        setBusy(label);
        setError(null);
        try {
          await fn();
        } catch (e) {
          setError(e instanceof SetupError ? e : new SetupError('NETWORK_ERROR', String((e as Error)?.message ?? e)));
        } finally {
          setBusy('');
          await reload();
        }
      };
      retry.current = run;
      return run();
    },
    [reload],
  );

  const step: SetupStep = state?.step ?? 'intro';
  const managing = !!status?.connected && (step === 'done' || step === 'intro');
  const needsSession = !flow.hasSession && (['project', 'billing'].includes(step) || isAuto(step));

  // entering the billing step: check it once, automatically
  useEffect(() => {
    if (step === 'billing' && flow.hasSession && billingAuto.current !== state?.project?.id) {
      billingAuto.current = state?.project?.id ?? '';
      void act('billing', () => flow.checkBilling());
    }
  }, [step, state?.project?.id, flow, act]);

  // entering the project step: load the project list
  useEffect(() => {
    if (step === 'project' && flow.hasSession && projects === null) void act('projects', async () => {
        const list = await flow.listProjects();
        setProjects(list);
        const suggested = suggestProject(list); // a previous Lingolens project, or the only one
        if (suggested) setPicked((cur) => cur || suggested.projectId);
      });
  }, [step, flow, projects, act]);

  if (!state || configured === null) return <div className="py-6 text-[13px] text-muted">Đang tải…</div>;

  const projectId = state.project?.id;
  const back = step !== 'intro' && step !== 'done' ? () => void act('back', () => flow.back()) : undefined;
  const disclaimer = (
    <div className="mt-4 rounded-xl bg-text/[0.05] px-3 py-2 text-[11.5px] leading-snug text-subtle">
      Dịch bằng Google Cloud được tính phí <b>vào tài khoản Google Cloud của chính bạn</b>, không phải Lingolens. Lingolens không trả tiền thay bạn và không dùng khoá chung. Mức dùng hiển thị trong app là ước tính cục bộ, không phải số liệu thanh toán chính thức của Google.
    </div>
  );

  // ----------------------------------------------------------------------------------- the screens
  let body: ReactNode;

  if (managing) {
    // 9. Credential management
    body = (
      <GlassCard>
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#3451d1] to-[#8b5cf6] text-[22px] text-white">✓</div>
          <div className="min-w-0">
            <div className="text-[16px] font-bold">Đã kết nối Google Cloud Translation</div>
            <div className="text-[12.5px] text-muted">Dịch bằng API của tài khoản Google Cloud của bạn.</div>
          </div>
        </div>
        <dl className="mt-3 divide-y divide-border/60 text-[13px]" data-ml-setup-credentials="">
          <div className="flex justify-between gap-3 py-2"><dt className="text-muted">Tài khoản</dt><dd className="min-w-0 truncate font-medium">{status?.account ?? '—'}</dd></div>
          <div className="flex justify-between gap-3 py-2"><dt className="shrink-0 whitespace-nowrap text-muted">Dự án</dt><dd className="min-w-0 truncate font-medium">{status?.project ? `${status.project.name} (${status.project.id})` : '—'}</dd></div>
          <div className="flex justify-between gap-3 py-2"><dt className="text-muted">Khoá API</dt><dd className="font-mono font-medium" data-ml-setup-keyhint="">••••{status?.keyHint ?? '----'}</dd></div>
          <div className="flex justify-between gap-3 py-2"><dt className="text-muted">Kiểm tra gần nhất</dt><dd className="font-medium">{fmtTime(health?.at ?? status?.validatedAt)}</dd></div>
          <div className="flex justify-between gap-3 py-2"><dt className="text-muted">Chế độ dịch</dt><dd><Badge tone={snap?.settings.provider === 'google' ? 'accent' : 'neutral'}>{snap?.settings.provider === 'google' ? 'Google API' : 'Dịch máy trên thiết bị'}</Badge></dd></div>
        </dl>
        {health && <div className={cx('mt-2 text-[12.5px]', health.ok ? 'text-ok' : 'text-danger')}>{health.ok ? '✓ Kết nối hoạt động' : 'Kết nối có vấn đề'}</div>}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="primary"
            disabled={!!busy}
            onClick={() =>
              void act('health', async () => {
                const r = await flow.checkHealth();
                setHealth({ ok: r.ok, at: Date.now() });
                if (!r.ok && r.error) throw r.error;
              })
            }
            data-ml-setup-health=""
          >
            {busy === 'health' ? 'Đang kiểm tra…' : 'Kiểm tra kết nối'}
          </Button>
          <Button size="sm" disabled={!!busy} onClick={() => void act('replace', async () => { if (!flow.hasSession) await flow.connect(); await flow.goTo('project'); })}>
            Thay khoá / dự án
          </Button>
          <Button size="sm" disabled={!!busy} onClick={() => void act('reconnect', () => flow.reconnect())}>
            Kết nối lại Google
          </Button>
        </div>
        <div className="mt-4 rounded-xl border border-danger/30 bg-danger/[0.06] p-3">
          <div className="text-[13px] font-semibold">Ngắt kết nối</div>
          <div className="mt-0.5 text-[12px] text-muted">Xoá khoá khỏi thiết bị này và quay về dịch máy miễn phí trên thiết bị.</div>
          <label className="mt-2 flex items-center gap-2 text-[12.5px]">
            <input type="checkbox" checked={deleteRemote} onChange={(e) => setDeleteRemote(e.target.checked)} />
            Xoá luôn khoá này trên Google Cloud (cần đăng nhập lại)
          </label>
          <Button
            size="sm"
            variant="danger"
            className="mt-2"
            disabled={!!busy}
            onClick={() =>
              void act('disconnect', async () => {
                if (deleteRemote && !flow.hasSession) await flow.connect();
                await flow.disconnect({ deleteRemoteKey: deleteRemote });
                setHealth(null);
                setProjects(null);
              })
            }
            data-ml-setup-disconnect=""
          >
            Ngắt kết nối
          </Button>
        </div>
      </GlassCard>
    );
  } else if (step === 'intro') {
    // 1. Introduction
    body = (
      <GlassCard>
        <div className="bg-gradient-to-r from-[#3451d1] to-[#8b5cf6] bg-clip-text text-[20px] font-extrabold text-transparent">Lingolens Smart Setup</div>
        <p className="mt-1 text-[13px] leading-snug text-muted">Thiết lập Google Cloud Translation bằng tài khoản Google Cloud của bạn, hầu như không cần thao tác thủ công. Bạn không phải tự tìm hiểu project, API hay khoá.</p>
        <Notes items={['Lingolens tạo/chọn dự án, bật Translation API và tạo khoá API đã giới hạn đúng API.', 'Khoá chỉ nằm trong kho bảo mật của thiết bị này, không gửi cho Lingolens.', 'Bạn tự liên kết thanh toán (Billing) trên Google. Lingolens không làm việc đó thay bạn.', 'Dịch máy miễn phí trên thiết bị vẫn dùng bình thường, không cần Google.']} />
        {disclaimer}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void act('start', () => flow.goTo('connect'))} data-ml-setup-start="">
            Bắt đầu
          </Button>
        </div>
      </GlassCard>
    );
  } else if (step === 'connect') {
    // 2. Connect Google account
    body = (
      <GlassCard>
        <div className="text-[16px] font-bold">Kết nối tài khoản Google</div>
        <p className="mt-1 text-[12.5px] leading-snug text-muted">Đăng nhập để Lingolens làm giúp các bước trên Google Cloud. Phiên đăng nhập chỉ dùng trong lúc thiết lập, sau đó được thu hồi.</p>
        <div className="mt-3 rounded-xl bg-text/[0.05] p-3 text-[12.5px]">
          <div className="font-semibold">Lingolens sẽ xin quyền:</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted">
            <li>Quản lý tài nguyên Google Cloud (dự án, API, khoá API, xem trạng thái Billing) – phạm vi <span className="font-mono text-[11px]">cloud-platform</span>.</li>
            <li>Địa chỉ email, chỉ để hiển thị bạn đang dùng tài khoản nào.</li>
          </ul>
          <div className="mt-1 text-subtle">Không truy cập Gmail, Drive hay dữ liệu cá nhân khác.</div>
        </div>
        {!configured && (
          <div className="mt-3">
            <ErrorRecovery error={new SetupError('OAUTH_NOT_CONFIGURED')} onRetry={() => void flow.configured().then(setConfigured)} retryLabel="Kiểm tra lại" onClose={() => void act('back', () => flow.goTo('intro'))} />
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" disabled={!!busy || !configured} onClick={() => void act('connect', () => flow.connect())} data-ml-setup-connect="">
            {busy === 'connect' ? 'Đang chờ Google…' : 'Kết nối Google'}
          </Button>
          <Button onClick={() => void act('back', () => flow.goTo('intro'))}>‹ Quay lại</Button>
        </div>
      </GlassCard>
    );
  } else if (needsSession) {
    // the OAuth session is memory-only: after a restart sign in again, the progress is kept
    body = (
      <GlassCard>
        <div className="text-[16px] font-bold">Cần đăng nhập lại</div>
        <p className="mt-1 text-[12.5px] text-muted">Phiên đăng nhập Google chỉ giữ trong lúc thiết lập nên đã kết thúc. Tiến trình của bạn được giữ nguyên (dự án: {state.project?.name ?? 'chưa chọn'}).</p>
        <div className="mt-3 flex gap-2">
          <Button variant="primary" disabled={!!busy} onClick={() => void act('connect', () => flow.reconnect())} data-ml-setup-reconnect="">
            Đăng nhập Google
          </Button>
          {back && <Button onClick={back}>‹ Quay lại</Button>}
        </div>
      </GlassCard>
    );
  } else if (step === 'project') {
    // 3. Select or create a project
    body = (
      <GlassCard>
        <div className="text-[16px] font-bold">Chọn hoặc tạo dự án</div>
        <p className="mt-1 text-[12.5px] text-muted">Dự án Google Cloud là nơi API dịch và khoá được tạo. Tài khoản: <b className="text-text">{state.account ?? '—'}</b></p>
        <div className="mt-3 space-y-1.5" data-ml-setup-projects="">
          {projects === null && busy === 'projects' && <div className="flex items-center gap-2 text-[13px] text-muted"><Spinner /> Đang tải danh sách dự án…</div>}
          {projects?.length === 0 && <div className="text-[12.5px] text-muted">Tài khoản này chưa có dự án nào. Hãy tạo dự án mới bên dưới.</div>}
          {projects?.map((p) => (
            <label key={p.projectId} className={cx('flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-[13px]', picked === p.projectId ? 'border-accent bg-accent/10' : 'border-border/70')}>
              <input type="radio" name="proj" checked={picked === p.projectId} onChange={() => setPicked(p.projectId)} />
              <span className="min-w-0">
                <span className="block truncate font-semibold">
                  {p.displayName} {suggestProject(projects ?? [])?.projectId === p.projectId && <Badge tone="accent">Gợi ý</Badge>}
                </span>
                <span className="block truncate font-mono text-[11px] text-subtle">{p.projectId}</span>
              </span>
            </label>
          ))}
        </div>
        <Button className="mt-3" variant="primary" disabled={!picked || !!busy} onClick={() => void act('select', () => flow.selectProject(picked))} data-ml-setup-select="">
          {busy === 'select' ? 'Đang kiểm tra quyền…' : 'Dùng dự án này'}
        </Button>
        <div className="mt-4 border-t border-border/60 pt-3">
          <div className="text-[13px] font-semibold">Hoặc tạo dự án mới</div>
          <div className="mt-1.5 flex gap-2">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} className="ml-focus ml-glass-field h-9 min-w-0 flex-1 rounded-xl px-2.5 text-[13px] text-text" aria-label="Tên dự án" />
            <Button disabled={!!busy || !newName.trim()} onClick={() => void act('create', () => flow.createProject(newName))} data-ml-setup-create="">
              {busy === 'create' ? 'Đang tạo…' : 'Tạo dự án'}
            </Button>
          </div>
        </div>
        {back && <Button className="mt-3" onClick={back}>‹ Quay lại</Button>}
      </GlassCard>
    );
  } else if (step === 'billing') {
    // 4. Billing verification (read only)
    const info = state.billing;
    body = (
      <GlassCard>
        <div className="text-[16px] font-bold">Xác minh thanh toán (Billing)</div>
        <p className="mt-1 text-[12.5px] leading-snug text-muted">Cloud Translation cần một tài khoản thanh toán gắn với dự án <b className="text-text">{state.project?.name}</b>. Lingolens chỉ <b>kiểm tra</b> trạng thái, không tự liên kết hay tạo thanh toán thay bạn. Có hạn mức dịch miễn phí mỗi tháng; vượt quá mới bị tính phí.</p>
        <div className={cx('mt-3 rounded-xl px-3 py-2 text-[13px]', info?.enabled ? 'bg-ok/10 text-ok' : 'bg-warn/10 text-warn')} data-ml-setup-billing={info?.enabled ? 'on' : 'off'}>
          {busy === 'billing' ? <span className="flex items-center gap-2"><Spinner /> Đang kiểm tra Billing…</span> : info?.enabled ? '✓ Dự án đã liên kết thanh toán' : 'Dự án chưa liên kết thanh toán'}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {!info?.enabled && (
            <Button onClick={() => openConsole(ERROR_INFO.BILLING_NOT_ENABLED.consoleUrl!(projectId))} data-ml-setup-open-billing="">
              Mở trang liên kết Billing ↗
            </Button>
          )}
          <Button variant="primary" disabled={!!busy} onClick={() => void act('billing', () => flow.checkBilling())} data-ml-setup-recheck="">
            {info?.enabled ? 'Tiếp tục' : 'Tôi đã liên kết, kiểm tra lại'}
          </Button>
          {back && <Button onClick={back}>‹ Quay lại</Button>}
        </div>
      </GlassCard>
    );
  } else {
    // 4-7. One automatic stage: enable the APIs, create (or reuse) the key, test it, save and activate – one tap
    const ph = ['api', 'key', 'validate', 'activate'] as const;
    const labels: Record<(typeof ph)[number], string> = { api: 'Bật Cloud Translation API và API Keys API', key: 'Tạo khoá Lingolens-Translation (hoặc dùng lại khoá cũ)', validate: 'Dịch thử bằng khoá mới', activate: 'Lưu khoá an toàn và bật Google API' };
    const doneIdx = step === 'api' ? 0 : step === 'key' ? 1 : 2; // what the persisted step says is already finished
    const running = busy === 'auto' ? ph.indexOf(phase) : -1;
    body = (
      <GlassCard>
        <div className="text-[16px] font-bold">Thiết lập tự động</div>
        <p className="mt-1 text-[12.5px] leading-snug text-muted">Lingolens làm liền các bước còn lại trong dự án <b className="text-text">{state.project?.name}</b>. Bạn chỉ cần bấm một lần. Nếu có lỗi, bấm thử lại sẽ chạy tiếp từ bước đó.</p>
        <ul className="mt-3 space-y-1.5 text-[13px]" data-ml-setup-auto="">
          {ph.map((p, i) => {
            const finished = i < doneIdx && running < 0 ? true : running > i;
            const now = running === i;
            return (
              <li key={p} className={cx('flex items-center gap-2', finished ? 'text-ok' : now ? 'text-text' : 'text-muted')} data-ml-setup-phase={p} data-state={finished ? 'done' : now ? 'running' : 'todo'}>
                <span className="w-5 text-center">{finished ? '✓' : now ? <Spinner /> : '○'}</span>
                {labels[p]}
              </li>
            );
          })}
        </ul>
        {busy === 'auto' && (
          <div className="mt-3" data-ml-setup-busy="auto">
            <div className="h-2 overflow-hidden rounded-full bg-text/[0.1]"><div className="ml-setup-busy h-full w-full" /></div>
            <div className="mt-1 text-[12px] text-muted">Đang cấu hình Google Cloud… có thể mất tới một hai phút.</div>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" disabled={!!busy} onClick={() => void act('auto', () => flow.autoSetup(setPhase))} data-ml-setup-auto-start="">
            {busy === 'auto' ? 'Đang thiết lập…' : step === 'api' ? 'Thiết lập tự động' : 'Tiếp tục thiết lập'}
          </Button>
          {back && <Button onClick={back}>‹ Quay lại</Button>}
        </div>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-4" data-ml-setup-section="" data-ml-setup-step={step}>
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight text-text">Lingolens Smart Setup</h1>
        <p className="mt-1 text-[13px] text-muted">Dùng Google Translate API bằng tài khoản Google Cloud của bạn, thiết lập nhanh trong vài bước.</p>
      </div>
      {!managing && <Progress step={step} busy={!!busy} />}
      {error && (
        <ErrorRecovery
          error={error}
          projectId={projectId}
          onRetry={() => void (error.code === 'GOOGLE_AUTH_FAILED' ? act('connect', () => flow.reconnect()) : retry.current())}
          onBack={back}
          onClose={() => setError(null)}
          retryLabel={error.code === 'GOOGLE_AUTH_FAILED' ? 'Đăng nhập lại' : 'Thử lại'}
        />
      )}
      <div key={step + (managing ? 'm' : '')} className="animate-ml-in">
        {body}
      </div>
    </div>
  );
}
