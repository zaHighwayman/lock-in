// Small shared components. Big tap targets: this is used between sets with sweaty hands.
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { Flag } from '../core/model';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

export function Page({ title, right, children, back }: { title: string; right?: ReactNode; children: ReactNode; back?: () => void }) {
  return (
    <div className="mx-auto max-w-xl px-4 pb-28 safe-top">
      <header className="flex items-center gap-2 py-3">
        {back && (
          <button onClick={back} className="-ml-2 rounded-lg px-2 py-1 text-2xl text-muted" aria-label="Back">
            ‹
          </button>
        )}
        <h1 className="flex-1 truncate text-xl font-semibold">{title}</h1>
        {right}
      </header>
      {children}
    </div>
  );
}

export function Card({ children, className, title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cx('mb-3 rounded-2xl border border-line bg-surface p-4', className)}>
      {(title || action) && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({ variant = 'secondary', className, size = 'md', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <button
      {...p}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-xl font-medium transition active:scale-[0.97] disabled:opacity-40',
        size === 'sm' && 'px-3 py-1.5 text-sm',
        size === 'md' && 'px-4 py-2.5',
        size === 'lg' && 'px-5 py-3.5 text-lg',
        variant === 'primary' && 'bg-accent text-accent-ink',
        variant === 'secondary' && 'bg-surface-2 text-ink border border-line',
        variant === 'ghost' && 'text-muted',
        variant === 'danger' && 'bg-bad/15 text-bad border border-bad/30',
        className,
      )}
    />
  );
}

export function Segmented<T extends string>({ value, options, onChange, className }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cx('flex rounded-xl border border-line bg-surface p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx('flex-1 rounded-lg px-2 py-1.5 text-sm font-medium', value === o.value ? 'bg-surface-2 text-ink' : 'text-muted')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-sm text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-faint">{hint}</span>}
    </label>
  );
}

export const inputCls = 'w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-ink placeholder:text-faint outline-none focus:border-accent/60';

export function NumInput({ value, onChange, step = 'any', placeholder, className }: { value: number | null | undefined; onChange: (v: number | null) => void; step?: string; placeholder?: string; className?: string }) {
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value));
  useEffect(() => {
    const parsed = text === '' ? null : Number(text.replace(',', '.'));
    if (parsed !== (value ?? null)) setText(value === null || value === undefined ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      inputMode="decimal"
      step={step}
      placeholder={placeholder}
      className={cx(inputCls, 'tnum', className)}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const t = e.target.value.replace(',', '.').trim();
        if (t === '') onChange(null);
        else if (Number.isFinite(Number(t))) onChange(Number(t));
      }}
    />
  );
}

/** ± buttons around a typeable value. Keeps its own state so rapid taps never read a stale value. */
export function Stepper({ value, step, onChange, unit, min = 0, decimals = 2 }: { value: number; step: number; onChange: (v: number) => void; unit?: string; min?: number; decimals?: number }) {
  const fix = (v: number) => Math.round(v * 10 ** decimals) / 10 ** decimals;
  const [v, setV] = useState(value);
  const [text, setText] = useState(String(fix(value)));
  const commit = (n: number) => {
    const c = Math.max(min, fix(n));
    setV(c);
    setText(String(c));
    onChange(c);
  };
  return (
    <div className="flex items-center gap-2">
      <button className="h-11 w-11 rounded-xl border border-line bg-surface-2 text-xl" onClick={() => commit(v - step)}>
        −
      </button>
      <div className="flex w-20 items-baseline justify-center rounded-lg bg-surface-2/60">
        <input
          inputMode="decimal"
          className="w-14 bg-transparent py-1.5 text-center text-lg font-semibold tnum outline-none"
          value={text}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            setText(e.target.value);
            const n = Number(e.target.value.replace(',', '.'));
            if (e.target.value.trim() !== '' && Number.isFinite(n)) {
              setV(n);
              onChange(Math.max(min, fix(n)));
            }
          }}
          onBlur={() => setText(String(fix(v)))}
        />
        {unit && <span className="text-sm text-muted">{unit}</span>}
      </div>
      <button className="h-11 w-11 rounded-xl border border-line bg-surface-2 text-xl" onClick={() => commit(v + step)}>
        +
      </button>
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl border-t border-line bg-surface px-4 pt-3 safe-bottom"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-line" />
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="px-2 text-muted">
            Close
          </button>
        </div>
        <div className="pb-6">{children}</div>
      </div>
    </div>
  );
}

const flagColor = { good: 'border-good/30 bg-good/10', info: 'border-info/30 bg-info/10', warn: 'border-warn/35 bg-warn/10' };
const flagDot = { good: 'bg-good', info: 'bg-info', warn: 'bg-warn' };

export function FlagList({ flags, empty }: { flags: Flag[]; empty?: string }) {
  if (flags.length === 0) return empty ? <p className="text-sm text-muted">{empty}</p> : null;
  return (
    <ul className="space-y-2">
      {flags.map((f, i) => (
        <li key={i} className={cx('rounded-xl border px-3 py-2.5', flagColor[f.level])}>
          <div className="flex items-start gap-2">
            <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', flagDot[f.level])} />
            <div>
              <div className="text-sm font-medium">{f.title}</div>
              {f.detail && <div className="mt-0.5 text-sm text-muted">{f.detail}</div>}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'warn' | 'bad' }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted">{label}</div>
      <div className={cx('text-lg font-semibold tnum', tone === 'good' && 'text-good', tone === 'warn' && 'text-warn', tone === 'bad' && 'text-bad')}>{value}</div>
      {sub && <div className="text-xs text-faint">{sub}</div>}
    </div>
  );
}

export function Bar({ value, max, tone = 'accent' }: { value: number; max: number; tone?: 'accent' | 'warn' | 'bad' | 'good' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-2 overflow-hidden rounded-full bg-surface-2">
      <div className={cx('h-full rounded-full', tone === 'accent' && 'bg-accent', tone === 'warn' && 'bg-warn', tone === 'bad' && 'bg-bad', tone === 'good' && 'bg-good')} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-muted">{children}</div>;
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="my-2 rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>;
}

/** Tiny Markdown renderer for coach text: headings, lists, bold, paragraphs. */
export function Markdown({ text }: { text: string }) {
  const html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .split(/\n{2,}|\n(?=#)|\n(?=\d+\.\s)|\n(?=[-*]\s)/)
    .map((block) => {
      const b = block.trim();
      if (/^#{1,3}\s/.test(b)) return `<h2>${b.replace(/^#{1,3}\s*/, '')}</h2>`;
      if (/^\d+\.\s/.test(b)) return `<ol><li>${b.replace(/^\d+\.\s*/, '')}</li></ol>`;
      if (/^[-*]\s/.test(b)) return `<ul><li>${b.replace(/^[-*]\s*/, '')}</li></ul>`;
      return b ? `<p>${b.replace(/\n/g, '<br/>')}</p>` : '';
    })
    .join('')
    .replace(/<\/ol><ol>/g, '')
    .replace(/<\/ul><ul>/g, '');
  return <div className="md text-sm" dangerouslySetInnerHTML={{ __html: html }} />;
}
