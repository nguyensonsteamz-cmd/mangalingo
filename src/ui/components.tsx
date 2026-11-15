/**
 * Reusable UI primitives shared by the floating popup, the side panel, the settings page and the
 * phone app – styled with the Liquid Glass material (classes in ui/styles.css: ml-glass*, ml-press,
 * ml-sheen, ml-btn-primary).
 */
import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { IconAlert, IconInfo } from './icons';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'subtle' | 'danger'; size?: 'sm' | 'md' };

export function Button({ variant = 'subtle', size = 'md', className, ...p }: BtnProps) {
  return (
    <button
      type="button"
      {...p}
      className={cx(
        'ml-focus ml-press inline-flex select-none items-center justify-center gap-1.5 rounded-[10px] font-medium disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[13px]',
        variant === 'primary' && 'ml-btn-primary ml-sheen',
        variant === 'subtle' && 'ml-glass-card text-text hover:border-accent/40 hover:bg-surface/80',
        variant === 'ghost' && 'text-muted hover:bg-text/[0.06] hover:text-text',
        variant === 'danger' && 'border border-danger/40 bg-danger/[0.06] text-danger hover:bg-danger/[0.12]',
        className,
      )}
    />
  );
}

export function IconButton({ label, active, className, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...p}
      className={cx(
        'ml-focus ml-press inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full disabled:opacity-40',
        active ? 'ml-glass-select border border-transparent' : 'border border-transparent text-muted hover:bg-text/[0.07] hover:text-text',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cx('flex gap-1 border-b border-border/70 pb-1.5 pt-1', className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            'ml-focus ml-press whitespace-nowrap rounded-full border px-3 py-1 text-[12.5px] font-medium',
            value === t.id ? 'ml-glass-select font-semibold' : 'border-transparent text-muted hover:bg-text/[0.06] hover:text-text',
          )}
        >
          {t.label}
          {t.count ? <span className="ml-1 text-[11px] text-subtle">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Badge({ children, tone = 'neutral', title }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'; title?: string }) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-px text-[11px] font-medium',
        tone === 'neutral' && 'bg-text/[0.06] text-muted ring-1 ring-inset ring-border/80',
        tone === 'accent' && 'bg-accent/15 text-accent',
        tone === 'ok' && 'bg-ok/15 text-ok',
        tone === 'warn' && 'bg-warn/15 text-warn',
        tone === 'danger' && 'bg-danger/15 text-danger',
      )}
    >
      {children}
    </span>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      role="status"
      aria-label="Đang tải"
      className="inline-block animate-ml-spin rounded-full border-2 border-border border-t-accent"
      style={{ width: size, height: size }}
    />
  );
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="ml-glass-field h-1.5 w-full overflow-hidden rounded-full" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="ml-btn-primary h-full rounded-full transition-[width] duration-200" style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-8 text-center">
      {icon && <div className="mb-1 text-subtle">{icon}</div>}
      <div className="text-[13px] font-medium text-text">{title}</div>
      {children && <div className="max-w-[300px] text-[12.5px] text-muted">{children}</div>}
    </div>
  );
}

export function Notice({ tone = 'info', children, title }: { tone?: 'info' | 'warn' | 'error'; children: ReactNode; title?: string }) {
  return (
    <div
      className={cx(
        'flex gap-2 rounded-xl border px-2.5 py-2 text-[12.5px]',
        tone === 'info' && 'ml-glass-card text-muted',
        tone === 'warn' && 'border-warn/30 bg-warn/10 text-text',
        tone === 'error' && 'border-danger/30 bg-danger/10 text-text',
      )}
    >
      <span className={cx('mt-px shrink-0', tone === 'warn' ? 'text-warn' : tone === 'error' ? 'text-danger' : 'text-subtle')}>
        {tone === 'info' ? <IconInfo size={14} /> : <IconAlert size={14} />}
      </span>
      <div className="min-w-0">
        {title && <div className="font-medium text-text">{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <div className={cx('flex items-start justify-between gap-4 py-2.5', disabled && 'opacity-50')}>
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <div className="text-[13px] font-medium text-text">{label}</div>
        {description && <div className="mt-0.5 text-[12px] text-muted">{description}</div>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'ml-focus relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors duration-200',
          checked ? 'ml-btn-primary border-transparent' : 'ml-glass-field',
        )}
      >
        <span
          className={cx(
            'absolute left-0 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow-[0_2px_6px_rgb(0_0_0/0.25),inset_0_-1px_1px_rgb(0_0_0/0.06)] transition-transform duration-300 [transition-timing-function:var(--ml-ease-spring)]',
            checked ? 'translate-x-[21px]' : 'translate-x-[1px]',
          )}
        />
      </button>
    </div>
  );
}

export function Field({ label, description, children, stacked }: { label: string; description?: string; children: ReactNode; stacked?: boolean }) {
  return (
    <div className={cx('flex flex-col gap-2 py-2.5', !stacked && 'sm:flex-row sm:items-center sm:justify-between sm:gap-6')}>
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-text">{label}</div>
        {description && <div className="mt-0.5 text-[12px] text-muted">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function Slider({ value, min, max, step = 1, onChange, format }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="ml-focus h-1.5 w-40 cursor-pointer accent-[rgb(var(--ml-accent))]"
      />
      <span className="w-14 text-right font-mono text-[12px] tabular-nums text-muted">{format ? format(value) : value}</span>
    </div>
  );
}

export function Select<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="ml-focus ml-glass-field ml-press h-9 min-w-[170px] cursor-pointer appearance-none rounded-[10px] pl-3 pr-8 text-[13px] text-text hover:border-accent/40"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="ml-glass-field inline-flex rounded-full p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cx(
            'ml-focus ml-press rounded-full px-3 py-1 text-[12.5px] font-medium',
            value === o.value ? 'ml-glass-select border font-semibold' : 'border border-transparent text-muted hover:text-text',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-1.5 mt-3 flex items-center justify-between first:mt-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{children}</h3>
      {action}
    </div>
  );
}
