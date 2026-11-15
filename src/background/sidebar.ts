/**
 * Side panel state: the current payload lives in chrome.storage.session so it survives panel
 * reloads and service-worker restarts, and is pushed live to open panels.
 */
import type { PageEvent, SidebarPayload } from '@/shared/messages';

export const SIDEBAR_KEY = 'sidebar:current';
export const SIDEBAR_HISTORY_KEY = 'sidebar:history';

export interface SessionArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export class SidebarState {
  /** windowId → number of connected side panel ports */
  private open = new Map<number, number>();

  constructor(
    private session: SessionArea,
    private broadcast: (e: PageEvent) => Promise<void>,
  ) {}

  async push(payload: SidebarPayload): Promise<void> {
    const prev = ((await this.session.get(SIDEBAR_HISTORY_KEY))[SIDEBAR_HISTORY_KEY] as SidebarPayload[] | undefined) ?? [];
    const history = [payload, ...prev.filter((p) => !(p.type === 'lookup' && payload.type === 'lookup' && p.text === payload.text))].slice(0, 15);
    await this.session.set({ [SIDEBAR_KEY]: payload, [SIDEBAR_HISTORY_KEY]: history });
    await this.broadcast({ type: 'sidebar:update', payload }).catch(() => {});
  }

  async current(): Promise<SidebarPayload | null> {
    return ((await this.session.get(SIDEBAR_KEY))[SIDEBAR_KEY] as SidebarPayload | undefined) ?? null;
  }

  connected(windowId: number) {
    this.open.set(windowId, (this.open.get(windowId) ?? 0) + 1);
  }
  disconnected(windowId: number) {
    const n = (this.open.get(windowId) ?? 1) - 1;
    if (n <= 0) this.open.delete(windowId);
    else this.open.set(windowId, n);
  }
  isOpen(windowId: number): boolean {
    return (this.open.get(windowId) ?? 0) > 0;
  }
}
