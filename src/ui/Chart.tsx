// Single-axis time chart: dots, line and/or bars, optional baseline band and target line.
// Tap/drag to read values; "Table" shows the numbers (identity is never color-only).
import { useMemo, useRef, useState } from 'react';
import { diffDays, shortDate } from '../core/dates';
import { cx } from './kit';

export interface Point {
  date: string;
  value: number;
}

export interface Series {
  name: string;
  kind: 'dots' | 'line' | 'bars';
  data: Point[];
  tone?: 'accent' | 'muted';
}

interface Props {
  series: Series[];
  band?: { lo: number; hi: number; label: string };
  target?: { value: number; label: string };
  format?: (v: number) => string;
  height?: number;
  /** force y-axis to include 0 (bars) */
  zero?: boolean;
  empty?: string;
}

const W = 340;
const PAD = { l: 38, r: 10, t: 10, b: 20 };
const COLORS = { accent: '#c6f432', muted: '#6b7383' };

export function TimeChart({ series, band, target, format = (v) => v.toFixed(1), height = 170, zero, empty = 'No data yet.' }: Props) {
  const [hover, setHover] = useState<string | null>(null);
  const [table, setTable] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const all = series.flatMap((s) => s.data);

  const geo = useMemo(() => {
    if (all.length === 0) return null;
    const dates = [...new Set(all.map((p) => p.date))].sort();
    const first = dates[0];
    const last = dates[dates.length - 1];
    const span = Math.max(1, diffDays(last, first));
    let lo = Math.min(...all.map((p) => p.value), ...(band ? [band.lo] : []), ...(target ? [target.value] : []));
    let hi = Math.max(...all.map((p) => p.value), ...(band ? [band.hi] : []), ...(target ? [target.value] : []));
    if (zero) lo = Math.min(0, lo);
    if (hi === lo) {
      hi += 1;
      lo -= 1;
    }
    const pad = (hi - lo) * 0.1;
    if (!zero) lo -= pad;
    hi += pad;
    const H = height;
    const x = (d: string) => PAD.l + (diffDays(d, first) / span) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
    const ticks = niceTicks(lo, hi, 4);
    return { dates, first, last, x, y, ticks, H, span };
  }, [all, band, target, height, zero]);

  if (!geo) return <div className="flex h-24 items-center justify-center text-sm text-muted">{empty}</div>;
  const { x, y, ticks, H, dates } = geo;
  const barW = Math.max(3, Math.min(14, ((W - PAD.l - PAD.r) / Math.max(1, geo.span + 1)) * 0.7));

  function pick(clientX: number) {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    let best = dates[0];
    for (const d of dates) if (Math.abs(x(d) - px) < Math.abs(x(best) - px)) best = d;
    setHover(best);
  }

  const hoverVals = hover ? series.map((s) => ({ s, p: s.data.find((p) => p.date === hover) })).filter((v) => v.p) : [];

  return (
    <div>
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full touch-pan-y select-none"
          onPointerDown={(e) => pick(e.clientX)}
          onPointerMove={(e) => (e.buttons || e.pointerType === 'mouse') && pick(e.clientX)}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="#232831" strokeWidth={1} />
              <text x={PAD.l - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill="#8d95a3" className="tnum">
                {format(t)}
              </text>
            </g>
          ))}
          <text x={PAD.l} y={H - 4} fontSize={10} fill="#8d95a3">
            {shortDate(geo.first)}
          </text>
          <text x={W - PAD.r} y={H - 4} fontSize={10} fill="#8d95a3" textAnchor="end">
            {shortDate(geo.last)}
          </text>
          {band && <rect x={PAD.l} width={W - PAD.l - PAD.r} y={y(band.hi)} height={Math.max(1, y(band.lo) - y(band.hi))} fill="#c6f432" opacity={0.08} />}
          {target && (
            <g>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(target.value)} y2={y(target.value)} stroke="#8d95a3" strokeWidth={1} />
              <text x={W - PAD.r} y={y(target.value) - 4} fontSize={10} fill="#8d95a3" textAnchor="end">
                {target.label}
              </text>
            </g>
          )}
          {series.map((s) => {
            const c = COLORS[s.tone ?? 'accent'];
            const pts = [...s.data].sort((a, b) => a.date.localeCompare(b.date));
            if (s.kind === 'bars') {
              const base = y(Math.max(0, geo.ticks[0]));
              return pts.map((p) => {
                const top = y(p.value);
                const h = Math.max(1, base - top);
                const r = Math.min(4, barW / 2, h);
                const left = x(p.date) - barW / 2;
                return (
                  <path
                    key={s.name + p.date}
                    d={`M${left},${base} V${top + r} Q${left},${top} ${left + r},${top} H${left + barW - r} Q${left + barW},${top} ${left + barW},${top + r} V${base} Z`}
                    fill={c}
                    opacity={hover && hover !== p.date ? 0.5 : 1}
                  />
                );
              });
            }
            if (s.kind === 'line') {
              const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
              const end = pts[pts.length - 1];
              return (
                <g key={s.name}>
                  <path d={d} fill="none" stroke={c} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {end && <circle cx={x(end.date)} cy={y(end.value)} r={4} fill={c} stroke="#14171c" strokeWidth={2} />}
                </g>
              );
            }
            return pts.map((p) => <circle key={s.name + p.date} cx={x(p.date)} cy={y(p.value)} r={3.5} fill={c} stroke="#14171c" strokeWidth={2} />);
          })}
          {hover && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="#8d95a3" strokeWidth={1} />}
        </svg>
        {hover && hoverVals.length > 0 && (
          <div
            className="pointer-events-none absolute top-1 rounded-lg border border-line bg-surface-2 px-2 py-1 text-xs shadow-lg"
            style={{ left: `${Math.min(70, (x(hover) / W) * 100)}%` }}
          >
            <div className="text-muted">{shortDate(hover)}</div>
            {hoverVals.map(({ s, p }) => (
              <div key={s.name} className="flex items-center gap-1.5 tnum">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: COLORS[s.tone ?? 'accent'] }} />
                <span className="text-muted">{s.name}</span> <span className="font-medium text-ink">{format(p!.value)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between gap-3 text-xs text-muted">
        <div className="flex flex-wrap gap-3">
          {series.length > 1 &&
            series.map((s) => (
              <span key={s.name} className="flex items-center gap-1.5">
                <span className={cx('inline-block', s.kind === 'line' ? 'h-0.5 w-3' : 'h-2 w-2 rounded-full')} style={{ background: COLORS[s.tone ?? 'accent'] }} />
                {s.name}
              </span>
            ))}
          {band && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-3 bg-accent/20" />
              {band.label}
            </span>
          )}
        </div>
        <button className="underline-offset-2 hover:underline" onClick={() => setTable(!table)}>
          {table ? 'Hide table' : 'Table'}
        </button>
      </div>
      {table && (
        <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-line">
          <table className="w-full text-xs tnum">
            <thead className="sticky top-0 bg-surface-2 text-muted">
              <tr>
                <th className="px-2 py-1 text-left font-normal">Date</th>
                {series.map((s) => (
                  <th key={s.name} className="px-2 py-1 text-right font-normal">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...dates].reverse().map((d) => (
                <tr key={d} className="border-t border-line">
                  <td className="px-2 py-1">{shortDate(d)}</td>
                  {series.map((s) => {
                    const p = s.data.find((q) => q.date === d);
                    return (
                      <td key={s.name} className="px-2 py-1 text-right">
                        {p ? format(p.value) : '–'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function niceTicks(lo: number, hi: number, count: number): number[] {
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}
