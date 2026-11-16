/** Error codes of Lingolens Smart Setup: cause, how to fix it, where to go in the Google Cloud Console. */

export type SetupErrorCode =
  | 'GOOGLE_AUTH_FAILED'
  | 'INSUFFICIENT_PERMISSIONS'
  | 'PROJECT_NOT_FOUND'
  | 'BILLING_NOT_ENABLED'
  | 'TRANSLATION_API_DISABLED'
  | 'API_KEY_GENERATION_FAILED'
  | 'INVALID_API_KEY'
  | 'API_KEY_RESTRICTED'
  | 'QUOTA_EXCEEDED'
  | 'BILLING_ACCOUNT_SUSPENDED'
  | 'NETWORK_ERROR'
  | 'OAUTH_NOT_CONFIGURED';

export interface ErrorInfo {
  title: string;
  /** Why it happened. */
  cause: string;
  /** What the user can do. */
  fix: string;
  /** The Console page that fixes it (needs the project id for most). */
  consoleUrl?: (projectId?: string) => string;
  consoleLabel?: string;
}

const C = 'https://console.cloud.google.com';
const q = (id?: string) => (id ? `?project=${encodeURIComponent(id)}` : '');

export const ERROR_INFO: Record<SetupErrorCode, ErrorInfo> = {
  GOOGLE_AUTH_FAILED: {
    title: 'Đăng nhập Google không thành công',
    cause: 'Bạn đã huỷ đăng nhập, phiên đăng nhập hết hạn hoặc quyền truy cập đã bị thu hồi.',
    fix: 'Bấm "Thử lại" để đăng nhập lại. Nếu bạn đã thu hồi quyền của Lingolens, hãy cấp lại khi Google hỏi.',
    consoleUrl: () => 'https://myaccount.google.com/permissions',
    consoleLabel: 'Mở quyền của tài khoản Google',
  },
  INSUFFICIENT_PERMISSIONS: {
    title: 'Tài khoản chưa đủ quyền',
    cause: 'Tài khoản Google này không được phép bật API hoặc tạo khoá trong dự án đã chọn (cần vai trò như Owner, hoặc Service Usage Admin + API Keys Admin).',
    fix: 'Chọn dự án do bạn sở hữu, hoặc nhờ chủ dự án cấp quyền. Có thể bấm "Tạo dự án mới" để dùng dự án riêng.',
    consoleUrl: (p) => `${C}/iam-admin/iam${q(p)}`,
    consoleLabel: 'Mở trang quyền (IAM)',
  },
  PROJECT_NOT_FOUND: {
    title: 'Không tìm thấy dự án',
    cause: 'Dự án đã bị xoá, bạn không còn quyền xem nó, hoặc mã dự án bị sai.',
    fix: 'Chọn lại dự án trong danh sách hoặc tạo dự án mới.',
    consoleUrl: () => `${C}/cloud-resource-manager`,
    consoleLabel: 'Mở danh sách dự án',
  },
  BILLING_NOT_ENABLED: {
    title: 'Dự án chưa liên kết thanh toán',
    cause: 'Cloud Translation cần một tài khoản thanh toán (Billing) gắn với dự án. Lingolens không tự liên kết hay tạo tài khoản thanh toán thay bạn.',
    fix: 'Mở trang Billing, liên kết tài khoản thanh toán của bạn với dự án, rồi quay lại bấm "Tôi đã liên kết, kiểm tra lại".',
    consoleUrl: (p) => `${C}/billing/linkedaccount${q(p)}`,
    consoleLabel: 'Mở trang liên kết Billing',
  },
  TRANSLATION_API_DISABLED: {
    title: 'Cloud Translation API chưa được bật',
    cause: 'API dịch chưa được kích hoạt trong dự án này (hoặc vừa bật và Google chưa cập nhật xong, thường mất 1–2 phút).',
    fix: 'Bấm "Thử lại" để Lingolens bật API, hoặc tự bật trong Console rồi thử lại sau ít phút.',
    consoleUrl: (p) => `${C}/apis/library/translate.googleapis.com${q(p)}`,
    consoleLabel: 'Mở trang Cloud Translation API',
  },
  API_KEY_GENERATION_FAILED: {
    title: 'Không tạo được khoá API',
    cause: 'Google từ chối tạo khoá (thiếu quyền, đạt giới hạn số khoá, hoặc API Keys API chưa bật).',
    fix: 'Thử lại; nếu vẫn lỗi, tạo khoá thủ công ở trang Credentials (nhớ giới hạn khoá cho Cloud Translation API) rồi dán vào ô nhập khoá.',
    consoleUrl: (p) => `${C}/apis/credentials${q(p)}`,
    consoleLabel: 'Mở trang Credentials',
  },
  INVALID_API_KEY: {
    title: 'Khoá API không hợp lệ',
    cause: 'Google không nhận khoá này (sai ký tự, đã bị xoá, hoặc khoá mới tạo chưa kịp có hiệu lực – có thể mất vài phút).',
    fix: 'Đợi một chút rồi "Thử lại". Nếu vẫn lỗi, tạo khoá mới hoặc dán lại khoá đúng.',
    consoleUrl: (p) => `${C}/apis/credentials${q(p)}`,
    consoleLabel: 'Mở trang Credentials',
  },
  API_KEY_RESTRICTED: {
    title: 'Khoá API bị giới hạn sai',
    cause: 'Khoá đang bị giới hạn cho API khác, hoặc bị ràng buộc theo trang web / địa chỉ IP / ứng dụng không khớp với Lingolens.',
    fix: 'Để Lingolens tạo khoá mới đã giới hạn đúng cho Cloud Translation API, hoặc sửa phần "API restrictions" của khoá trong Console.',
    consoleUrl: (p) => `${C}/apis/credentials${q(p)}`,
    consoleLabel: 'Mở trang Credentials',
  },
  QUOTA_EXCEEDED: {
    title: 'Đã vượt hạn mức của Google',
    cause: 'Dự án đã dùng hết hạn mức hoặc bị giới hạn tốc độ của Cloud Translation.',
    fix: 'Đợi một lúc rồi thử lại, hoặc xem và nâng hạn mức trong Console. Đây là hạn mức của Google, khác với hạn mức Lingolens tự đếm.',
    consoleUrl: (p) => `${C}/apis/api/translate.googleapis.com/quotas${q(p)}`,
    consoleLabel: 'Mở trang hạn mức',
  },
  BILLING_ACCOUNT_SUSPENDED: {
    title: 'Tài khoản thanh toán đang bị tạm ngưng',
    cause: 'Tài khoản thanh toán gắn với dự án đã bị đóng hoặc tạm ngưng.',
    fix: 'Giải quyết vấn đề thanh toán ở Google Cloud, hoặc liên kết một tài khoản thanh toán khác, rồi thử lại.',
    consoleUrl: (p) => `${C}/billing/linkedaccount${q(p)}`,
    consoleLabel: 'Mở trang Billing',
  },
  NETWORK_ERROR: {
    title: 'Không kết nối được tới Google',
    cause: 'Thiết bị đang offline hoặc kết nối bị chặn.',
    fix: 'Kiểm tra mạng rồi bấm "Thử lại". Các bước đã hoàn thành được giữ nguyên.',
  },
  OAUTH_NOT_CONFIGURED: {
    title: 'Smart Setup chưa được cấu hình đăng nhập Google',
    cause: 'Bản build này chưa có OAuth Client ID (nhà phát triển phải tạo trong Google Cloud và đưa vào lúc build). Client ID là mã công khai, không phải bí mật.',
    fix: 'Bạn vẫn dùng được dịch máy trên thiết bị, hoặc dán khoá API thủ công trong mục "Hạn mức dịch". Xem docs/GOOGLE-OAUTH-SETUP.md để cấu hình.',
  },
};

export class SetupError extends Error {
  constructor(
    public code: SetupErrorCode,
    public detail = '',
    public status = 0,
  ) {
    super(detail ? `${ERROR_INFO[code].title}: ${detail}` : ERROR_INFO[code].title);
    this.name = 'SetupError';
  }
}

export type GoogleService = 'resourcemanager' | 'serviceusage' | 'billing' | 'apikeys' | 'translate';

interface GoogleErrorBody {
  error?: { code?: number; message?: string; status?: string; details?: { '@type'?: string; reason?: string; metadata?: Record<string, string> }[] };
}

/** Turns a failed Google response into a SetupError (the reason codes are Google's documented ErrorInfo reasons). */
export function mapGoogleError(status: number, body: unknown, ctx: { service: GoogleService; op?: 'createKey' }): SetupError {
  const e = (body as GoogleErrorBody | null)?.error;
  const msg = String(e?.message ?? '');
  const reasons = (e?.details ?? []).map((d) => d.reason ?? '').filter(Boolean);
  const reason = reasons[0] ?? '';
  const has = (...r: string[]) => reasons.some((x) => r.includes(x));
  const detail = msg.replace(/AIza[0-9A-Za-z_\-]{20,}/g, '***').slice(0, 300);

  if (has('API_KEY_INVALID') || /API key not valid|API_KEY_INVALID/i.test(msg)) return new SetupError('INVALID_API_KEY', detail, status);
  if (has('API_KEY_SERVICE_BLOCKED', 'API_KEY_HTTP_REFERRER_BLOCKED', 'API_KEY_IP_ADDRESS_BLOCKED', 'API_KEY_ANDROID_APP_BLOCKED', 'API_KEY_IOS_APP_BLOCKED')) {
    return new SetupError('API_KEY_RESTRICTED', detail, status);
  }
  if (has('BILLING_DISABLED') || /billing (account|has not been enabled|is disabled)|requires billing/i.test(msg)) {
    return new SetupError(/suspend|closed/i.test(msg) ? 'BILLING_ACCOUNT_SUSPENDED' : 'BILLING_NOT_ENABLED', detail, status);
  }
  if (/billing account .*(closed|suspended)/i.test(msg)) return new SetupError('BILLING_ACCOUNT_SUSPENDED', detail, status);
  if (has('SERVICE_DISABLED', 'ACCESS_NOT_CONFIGURED') || /has not been used in project|is not enabled|API has not been used|accessNotConfigured/i.test(msg)) {
    // an admin API disabled in the OAuth client's own project is a developer-side problem, not "the user's translation API"
    return ctx.service === 'translate' ? new SetupError('TRANSLATION_API_DISABLED', detail, status) : new SetupError('INSUFFICIENT_PERMISSIONS', `API quản trị của Google chưa được bật cho ứng dụng (${ctx.service}). ${detail}`, status);
  }
  if (status === 401 || has('ACCESS_TOKEN_EXPIRED', 'CREDENTIALS_MISSING') || e?.status === 'UNAUTHENTICATED') return new SetupError('GOOGLE_AUTH_FAILED', detail, status);
  if (status === 429 || e?.status === 'RESOURCE_EXHAUSTED' || has('RATE_LIMIT_EXCEEDED', 'RESOURCE_EXHAUSTED', 'QUOTA_EXCEEDED')) return new SetupError('QUOTA_EXCEEDED', detail, status);
  if (status === 404 || e?.status === 'NOT_FOUND') return new SetupError(ctx.service === 'translate' ? 'INVALID_API_KEY' : 'PROJECT_NOT_FOUND', detail, status);
  if (status === 403 || e?.status === 'PERMISSION_DENIED') {
    return new SetupError(ctx.op === 'createKey' ? 'API_KEY_GENERATION_FAILED' : 'INSUFFICIENT_PERMISSIONS', detail, status);
  }
  if (ctx.op === 'createKey') return new SetupError('API_KEY_GENERATION_FAILED', detail, status);
  if (ctx.service === 'translate' && status === 400) return new SetupError('INVALID_API_KEY', detail, status);
  void reason;
  return new SetupError(status >= 500 ? 'NETWORK_ERROR' : 'API_KEY_GENERATION_FAILED', detail || `HTTP ${status}`, status);
}
