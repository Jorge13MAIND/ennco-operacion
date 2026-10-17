"use client";

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { localParts } from "@/lib/medidores/alerts";
import { fmt, fmtDay, type DailyPoint, type HarmonicBar, type HeatCell, type SeriesPoint } from "@/lib/medidores/model";

/*
 * Gráficas de la pestaña Medidores en SVG, sin librería. La política de seguridad del hub no deja estilos
 * en línea, así que colores y posiciones van como atributos del SVG y el tooltip se dibuja dentro del SVG.
 * Paleta validada (dataviz, 16-oct): azul = tomada de la red, ámbar = enviada a la red, aqua = solar;
 * fases L1/L2/L3 = azul, naranja, aqua (los tres primeros colores, válidos por pares). El ámbar y el
 * aqua tienen poco contraste con el fondo: por eso siempre hay leyenda, tooltip y tabla.
 */
export const COLORS = {
  imp: "#2a78d6", exp: "#eda100", pv: "#1baf7a",
  l1: "#2a78d6", l2: "#eb6834", l3: "#1baf7a",
  grid: "#e9e8e2", axis: "#c3c2b7", muted: "#6f6e69", ink: "#1b1b1a", ref: "#8a8984", critical: "#d03b3b",
  neutral: "#f0efec",
} as const;

export function useWidth(): [(el: HTMLDivElement | null) => void, number] {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(Math.round(entries[0]?.contentRect.width ?? 0)));
    ro.observe(el);
    observer.current = ro;
  }, []);
  return [ref, width];
}

export function Legend({ items }: { items: Array<{ color: string; label: string; dashed?: boolean }> }) {
  return (
    <ul className="med-legend" aria-label="Leyenda">
      {items.map((item) => (
        <li key={item.label}>
          <svg width="18" height="10" aria-hidden="true">
            {item.dashed ? <line x1="1" x2="17" y1="5" y2="5" stroke={item.color} strokeWidth="2" strokeDasharray="4 3" />
              : <rect x="1" y="1" width="16" height="8" rx="2" fill={item.color} />}
          </svg>
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => raw <= s) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

/** Tooltip dentro del SVG: caja con líneas de texto, se voltea si no cabe a la derecha. */
function SvgTooltip({ x, y, width, lines }: { x: number; y: number; width: number; lines: Array<{ text: string; color?: string; strong?: boolean }> }) {
  const boxW = Math.min(240, Math.max(...lines.map((l) => l.text.length)) * 6.6 + 28);
  const boxH = lines.length * 17 + 12;
  // A la derecha del cursor; si no cabe, a la izquierda; y siempre dentro de la gráfica.
  const preferred = x + 12 + boxW > width ? x - 12 - boxW : x + 12;
  const left = Math.max(4, Math.min(preferred, width - boxW - 4));
  return (
    <g transform={`translate(${left}, ${y})`} pointerEvents="none">
      <rect width={boxW} height={boxH} rx="8" fill="#ffffff" stroke={COLORS.axis} />
      {lines.map((line, i) => (
        <g key={i} transform={`translate(10, ${18 + i * 17})`}>
          {line.color ? <rect x="0" y="-8" width="8" height="8" rx="2" fill={line.color} /> : null}
          <text x={line.color ? 13 : 0} y="0" fontSize="11.5" fill={COLORS.ink} fontWeight={line.strong ? 700 : 400}>{line.text}</text>
        </g>
      ))}
    </g>
  );
}

type TimeFrameProps = {
  points: SeriesPoint[]; tz: string; height: number; width: number; yMin: number; yMax: number; unit: string; label: string;
  children: (scale: { x: (t: number) => number; y: (v: number) => number; times: number[] }) => ReactNode;
  tooltip: (p: SeriesPoint) => Array<{ text: string; color?: string; strong?: boolean }>;
  refs?: Array<{ value: number; label: string; color?: string }>;
};

function when(iso: string, tz: string) {
  return new Intl.DateTimeFormat("es-MX", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

/** Marco común de las gráficas de tiempo: ejes, días, líneas de referencia, cruceta y tooltip. */
function TimeFrame({ points, tz, height, width, yMin, yMax, unit, label, children, tooltip, refs = [] }: TimeFrameProps) {
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 46, r: 12, t: 10, b: 26 };
  const plotW = Math.max(10, width - pad.l - pad.r), plotH = height - pad.t - pad.b;
  const times = points.map((p) => Date.parse(p.t));
  const t0 = times[0] ?? 0, t1 = times.at(-1) ?? 1;
  const x = (t: number) => pad.l + (t1 > t0 ? ((t - t0) / (t1 - t0)) * plotW : plotW / 2);
  const y = (v: number) => pad.t + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH;
  const ticks = niceTicks(yMin, yMax);
  const days: Array<{ x: number; label: string }> = [];
  let lastDate = "";
  for (let i = 0; i < points.length; i += 1) {
    const l = localParts(points[i]!.t, tz);
    if (l.date !== lastDate) { days.push({ x: x(times[i]!), label: fmtDay(l.date) }); lastDate = l.date; }
  }
  // Un día que empieza casi al final del anterior (el periodo arranca de noche) no se rotula encima.
  const labeled: typeof days = [];
  for (const d of days) if (!labeled.length || d.x - labeled.at(-1)!.x >= 84) labeled.push(d);
  const step = Math.max(1, Math.ceil(labeled.length / Math.max(1, Math.floor(plotW / 84))));
  const onMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    if (!times.length) return;
    const target = t0 + ((px - pad.l) / plotW) * (t1 - t0);
    let lo = 0, hi = times.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid]! < target) lo = mid; else hi = mid; }
    setHover(Math.abs(times[lo]! - target) <= Math.abs(times[hi]! - target) ? lo : hi);
  };
  if (!width) return <div className="med-chart-empty" />;
  return (
    <svg width={width} height={height} role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => setHover(null)} className="med-svg">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={pad.l + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? COLORS.axis : COLORS.grid} strokeWidth={t === 0 ? 1.2 : 1} />
          <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill={COLORS.muted}>{fmt(t, Math.abs(t) < 10 && t % 1 !== 0 ? 2 : 0)}</text>
        </g>
      ))}
      <text x={pad.l - 6} y={pad.t - 1} textAnchor="end" fontSize="10" fill={COLORS.muted}>{unit}</text>
      {labeled.map((d, i) => (i % step === 0 ? (
        <g key={d.label + i}>
          <line x1={d.x} x2={d.x} y1={pad.t} y2={pad.t + plotH} stroke={COLORS.grid} />
          <text x={d.x + 3} y={height - 8} fontSize="11" fill={COLORS.muted}>{d.label}</text>
        </g>
      ) : null))}
      {refs.map((r) => (
        <g key={r.label}>
          <line x1={pad.l} x2={pad.l + plotW} y1={y(r.value)} y2={y(r.value)} stroke={r.color ?? COLORS.ref} strokeDasharray="5 4" />
          <text x={pad.l + plotW - 4} y={y(r.value) - 4} textAnchor="end" fontSize="10.5" fill={COLORS.muted}>{r.label}</text>
        </g>
      ))}
      {children({ x, y, times })}
      {hover !== null && points[hover] ? (
        <g>
          <line x1={x(times[hover]!)} x2={x(times[hover]!)} y1={pad.t} y2={pad.t + plotH} stroke={COLORS.ink} strokeOpacity="0.35" />
          <SvgTooltip x={x(times[hover]!)} y={pad.t + 4} width={width} lines={[{ text: when(points[hover]!.t, tz), strong: true }, ...tooltip(points[hover]!)]} />
        </g>
      ) : null}
    </svg>
  );
}

function linePath(points: SeriesPoint[], times: number[], value: (p: SeriesPoint) => number | null, x: (t: number) => number, y: (v: number) => number): string {
  let d = "", open = false;
  points.forEach((p, i) => {
    const v = value(p);
    if (v === null || !Number.isFinite(v)) { open = false; return; }
    d += `${open ? "L" : "M"}${x(times[i]!).toFixed(1)},${y(v).toFixed(1)}`;
    open = true;
  });
  return d;
}
function areaPath(points: SeriesPoint[], times: number[], value: (p: SeriesPoint) => number | null, x: (t: number) => number, y: (v: number) => number): string {
  const segments: string[] = [];
  let current: Array<[number, number]> = [];
  const flush = () => {
    if (current.length > 1) segments.push(`M${current[0]![0].toFixed(1)},${y(0).toFixed(1)}${current.map(([cx, cy]) => `L${cx.toFixed(1)},${cy.toFixed(1)}`).join("")}L${current.at(-1)![0].toFixed(1)},${y(0).toFixed(1)}Z`);
    current = [];
  };
  points.forEach((p, i) => {
    const v = value(p);
    if (v === null || !Number.isFinite(v)) { flush(); return; }
    current.push([x(times[i]!), y(v)]);
  });
  flush();
  return segments.join("");
}

/** Potencia: lo que toma de la red hacia arriba y lo que envía hacia abajo, con la línea solar. */
export function PowerChart({ points, tz, contracted, showSolar }: { points: SeriesPoint[]; tz: string; contracted: number | null; showSolar: boolean }) {
  const [ref, width] = useWidth();
  const top = Math.max(1, ...points.map((p) => Math.max(p.imp_max ?? p.imp ?? 0, p.pv ?? 0)), contracted ?? 0) * 1.08;
  const bottom = Math.max(0, ...points.map((p) => p.exp_max ?? p.exp ?? 0));
  const hasExport = bottom > 0.05;
  const items: Array<{ color: string; label: string; dashed?: boolean }> = [{ color: COLORS.imp, label: "Tomada de la red (promedio)" }, { color: COLORS.imp, label: "Pico del intervalo", dashed: true }];
  if (hasExport) items.push({ color: COLORS.exp, label: "Enviada a la red" });
  if (showSolar) items.push({ color: COLORS.pv, label: "Solar" });
  return (
    <div className="med-chart">
      <Legend items={items} />
      <div ref={ref} className="med-chart-body">
        <TimeFrame points={points} tz={tz} width={width} height={280} yMin={hasExport ? -bottom * 1.08 : 0} yMax={top} unit="kW" label="Potencia en el tiempo"
          refs={contracted ? [{ value: contracted, label: `Contratada ${fmt(contracted)} kW`, color: COLORS.critical }] : []}
          tooltip={(p) => [
            { text: `De la red: ${fmt(p.imp, 1)} kW (pico ${fmt(p.imp_max, 1)})`, color: COLORS.imp },
            ...(hasExport ? [{ text: `A la red: ${fmt(p.exp, 1)} kW`, color: COLORS.exp }] : []),
            ...(showSolar && p.pv !== null ? [{ text: `Solar: ${fmt(p.pv, 1)} kW`, color: COLORS.pv }] : []),
          ]}>
          {({ x, y, times }) => (
            <g>
              <path d={areaPath(points, times, (p) => p.imp, x, y)} fill={COLORS.imp} fillOpacity="0.16" />
              <path d={linePath(points, times, (p) => p.imp, x, y)} fill="none" stroke={COLORS.imp} strokeWidth="2" strokeLinejoin="round" />
              <path d={linePath(points, times, (p) => p.imp_max, x, y)} fill="none" stroke={COLORS.imp} strokeWidth="1" strokeOpacity="0.55" strokeDasharray="3 3" />
              {hasExport ? (
                <>
                  <path d={areaPath(points, times, (p) => (p.exp === null ? null : -p.exp), x, y)} fill={COLORS.exp} fillOpacity="0.28" />
                  <path d={linePath(points, times, (p) => (p.exp === null ? null : -p.exp), x, y)} fill="none" stroke={COLORS.exp} strokeWidth="2" strokeLinejoin="round" />
                </>
              ) : null}
              {showSolar ? <path d={linePath(points, times, (p) => p.pv, x, y)} fill="none" stroke={COLORS.pv} strokeWidth="2" strokeLinejoin="round" /> : null}
            </g>
          )}
        </TimeFrame>
      </div>
    </div>
  );
}

/** Líneas por fase (o una sola) con referencias opcionales. */
export function LineChart({ points, tz, lines, unit, label, refs = [], domain, height = 200 }: {
  points: SeriesPoint[]; tz: string; lines: Array<{ key: keyof SeriesPoint; label: string; color: string }>; unit: string; label: string;
  refs?: Array<{ value: number; label: string; color?: string }>; domain?: [number | null, number | null]; height?: number;
}) {
  const [ref, width] = useWidth();
  const values = points.flatMap((p) => lines.map((l) => p[l.key] as number | null)).filter((v): v is number => v !== null && Number.isFinite(v));
  const refValues = refs.map((r) => r.value);
  let lo = Math.min(...values, ...refValues), hi = Math.max(...values, ...refValues);
  if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
  const padV = (hi - lo) * 0.08 || 1;
  const yMin = domain?.[0] ?? lo - padV, yMax = domain?.[1] ?? hi + padV;
  const digits = unit === "" ? 2 : 1;
  return (
    <div className="med-chart">
      {lines.length > 1 ? <Legend items={lines.map((l) => ({ color: l.color, label: l.label }))} /> : null}
      <div ref={ref} className="med-chart-body">
        <TimeFrame points={points} tz={tz} width={width} height={height} yMin={yMin} yMax={yMax} unit={unit} label={label} refs={refs}
          tooltip={(p) => lines.map((l) => ({ text: `${l.label}: ${fmt(p[l.key] as number | null, digits)}${unit ? ` ${unit}` : ""}`, color: l.color }))}>
          {({ x, y, times }) => (
            <g>{lines.map((l) => <path key={String(l.key)} d={linePath(points, times, (p) => p[l.key] as number | null, x, y)} fill="none" stroke={l.color} strokeWidth="2" strokeLinejoin="round" />)}</g>
          )}
        </TimeFrame>
      </div>
    </div>
  );
}

function barPath(x: number, yTop: number, w: number, yBase: number, up: boolean): string {
  const h = Math.abs(yBase - yTop);
  const r = Math.min(4, w / 2, h);
  if (h < 0.5) return "";
  return up
    ? `M${x},${yBase}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + w - r}Q${x + w},${yTop} ${x + w},${yTop + r}V${yBase}Z`
    : `M${x},${yBase}V${yTop - r}Q${x},${yTop} ${x + r},${yTop}H${x + w - r}Q${x + w},${yTop} ${x + w},${yTop - r}V${yBase}Z`;
}

/** Energía por día: barras de lo tomado, lo enviado y lo generado. */
export function DailyBars({ daily, showSolar }: { daily: DailyPoint[]; showSolar: boolean }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const hasExport = daily.some((d) => (d.exp ?? 0) > 0.5);
  const keys: Array<{ key: "imp" | "exp" | "pv"; color: string; label: string }> = [{ key: "imp", color: COLORS.imp, label: "Tomada de la red" }];
  if (hasExport) keys.push({ key: "exp", color: COLORS.exp, label: "Enviada a la red" });
  if (showSolar) keys.push({ key: "pv", color: COLORS.pv, label: "Solar" });
  const height = 220, pad = { l: 46, r: 12, t: 12, b: 28 };
  const plotW = Math.max(10, width - pad.l - pad.r), plotH = height - pad.t - pad.b;
  const top = Math.max(1, ...daily.flatMap((d) => keys.map((k) => d[k.key] ?? 0))) * 1.08;
  const y = (v: number) => pad.t + (1 - v / top) * plotH;
  const colW = plotW / Math.max(1, daily.length);
  const barW = Math.max(3, Math.min(26, (colW - 10) / keys.length - 2));
  return (
    <div className="med-chart">
      <Legend items={keys} />
      <div ref={ref} className="med-chart-body">
        {width ? (
          <svg width={width} height={height} role="img" aria-label="Energía por día" className="med-svg" onPointerLeave={() => setHover(null)}>
            {niceTicks(0, top).map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={pad.l + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? COLORS.axis : COLORS.grid} />
                <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill={COLORS.muted}>{fmt(t)}</text>
              </g>
            ))}
            <text x={pad.l - 6} y={pad.t - 2} textAnchor="end" fontSize="10" fill={COLORS.muted}>kWh</text>
            {daily.map((d, i) => {
              const cx = pad.l + colW * i + colW / 2;
              const start = cx - (keys.length * (barW + 2) - 2) / 2;
              const every = Math.max(1, Math.ceil(daily.length / Math.max(1, Math.floor(plotW / 64))));
              return (
                <g key={d.d}>
                  <rect x={pad.l + colW * i} y={pad.t} width={colW} height={plotH} fill={hover === i ? "#f3f2ee" : "transparent"} onPointerEnter={() => setHover(i)} />
                  {keys.map((k, j) => <path key={k.key} d={barPath(start + j * (barW + 2), y(d[k.key] ?? 0), barW, y(0), true)} fill={k.color} pointerEvents="none" />)}
                  {i % every === 0 ? <text x={cx} y={height - 9} textAnchor="middle" fontSize="11" fill={COLORS.muted}>{fmtDay(d.d)}</text> : null}
                </g>
              );
            })}
            {hover !== null && daily[hover] ? (
              <SvgTooltip x={pad.l + colW * hover + colW / 2} y={pad.t} width={width} lines={[
                { text: fmtDay(daily[hover]!.d), strong: true },
                ...keys.map((k) => ({ text: `${k.label}: ${fmt(daily[hover]![k.key], 0)} kWh`, color: k.color })),
                { text: `Demanda máxima: ${fmt(daily[hover]!.peak, 1)} kW` },
                ...(daily[hover]!.pf !== null ? [{ text: `Factor de potencia: ${fmt(daily[hover]!.pf, 2)}` }] : []),
              ]} />
            ) : null}
          </svg>
        ) : <div className="med-chart-empty" />}
      </div>
    </div>
  );
}

function hexToRgb(hex: string): [number, number, number] {
  const v = Number.parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function mix(a: string, b: string, t: number): string {
  const lin = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const gam = (c: number) => Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055));
  const [ar, ag, ab] = hexToRgb(a).map(lin) as [number, number, number];
  const [br, bg, bb] = hexToRgb(b).map(lin) as [number, number, number];
  const k = Math.max(0, Math.min(1, t));
  return `#${[ar + (br - ar) * k, ag + (bg - ag) * k, ab + (bb - ab) * k].map((c) => gam(c).toString(16).padStart(2, "0")).join("")}`;
}
const IMPORT_DEEP = "#184f95";
const EXPORT_DEEP = "#9a6a00";

/** Mapa de calor día × hora con escala divergente: azul = tomó de la red, ámbar = envió a la red. */
export function Heatmap({ cells }: { cells: HeatCell[] }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<HeatCell | null>(null);
  const days = [...new Set(cells.map((c) => c.d))].sort();
  const byKey = new Map(cells.map((c) => [`${c.d}|${c.h}`, c]));
  const net = (c: HeatCell) => (c.imp ?? 0) - (c.exp ?? 0);
  const maxAbs = Math.max(0.01, ...cells.map((c) => Math.abs(net(c))));
  const color = (c: HeatCell | undefined) => {
    if (!c) return "#ffffff";
    const v = net(c);
    const t = Math.sqrt(Math.abs(v) / maxAbs);
    return v >= 0 ? mix(COLORS.neutral, IMPORT_DEEP, t) : mix(COLORS.neutral, EXPORT_DEEP, t);
  };
  const pad = { l: 78, r: 8, t: 22, b: 8 };
  const cellH = 20;
  const height = pad.t + days.length * cellH + pad.b + 34;
  const cellW = Math.max(8, (width - pad.l - pad.r) / 24);
  const legendW = Math.min(260, width - pad.l - 20);
  return (
    <div className="med-chart">
      <div ref={ref} className="med-chart-body">
        {width ? (
          <svg width={width} height={height} role="img" aria-label="Energía por hora de cada día" className="med-svg" onPointerLeave={() => setHover(null)}>
            {Array.from({ length: 24 }, (_, h) => (h % 3 === 0 ? <text key={h} x={pad.l + h * cellW + 2} y={pad.t - 7} fontSize="10.5" fill={COLORS.muted}>{`${h}:00`}</text> : null))}
            {days.map((d, r) => (
              <g key={d}>
                <text x={pad.l - 8} y={pad.t + r * cellH + 14} textAnchor="end" fontSize="11" fill={COLORS.muted}>{fmtDay(d)}</text>
                {Array.from({ length: 24 }, (_, h) => {
                  const c = byKey.get(`${d}|${h}`);
                  return <rect key={h} x={pad.l + h * cellW + 1} y={pad.t + r * cellH + 1} width={cellW - 2} height={cellH - 2} rx="3" fill={color(c)}
                    stroke={hover && c && hover.d === d && hover.h === h ? COLORS.ink : "none"} onPointerEnter={() => setHover(c ?? null)} />;
                })}
              </g>
            ))}
            <defs>
              <linearGradient id="med-heat-legend" x1="0" x2="1" y1="0" y2="0">
                {[0, 0.25, 0.5, 0.75, 1].map((s) => <stop key={s} offset={s} stopColor={s < 0.5 ? mix(COLORS.neutral, EXPORT_DEEP, Math.sqrt((0.5 - s) * 2)) : mix(COLORS.neutral, IMPORT_DEEP, Math.sqrt((s - 0.5) * 2))} />)}
              </linearGradient>
            </defs>
            <g transform={`translate(${pad.l}, ${height - 28})`}>
              <rect width={legendW} height="8" rx="4" fill="url(#med-heat-legend)" />
              <text x="0" y="22" fontSize="10.5" fill={COLORS.muted}>{`Envió ${fmt(maxAbs, 0)} kWh`}</text>
              <text x={legendW / 2} y="22" textAnchor="middle" fontSize="10.5" fill={COLORS.muted}>0</text>
              <text x={legendW} y="22" textAnchor="end" fontSize="10.5" fill={COLORS.muted}>{`Tomó ${fmt(maxAbs, 0)} kWh`}</text>
            </g>
            {hover ? (
              <SvgTooltip x={pad.l + hover.h * cellW + cellW / 2} y={pad.t + days.indexOf(hover.d) * cellH + cellH} width={width} lines={[
                { text: `${fmtDay(hover.d)}, ${hover.h}:00 a ${(hover.h + 1) % 24}:00`, strong: true },
                { text: `Tomó de la red: ${fmt(hover.imp, 1)} kWh`, color: COLORS.imp },
                ...((hover.exp ?? 0) > 0 ? [{ text: `Envió a la red: ${fmt(hover.exp, 1)} kWh`, color: COLORS.exp }] : []),
                ...((hover.pv ?? 0) > 0 ? [{ text: `Solar: ${fmt(hover.pv, 1)} kWh`, color: COLORS.pv }] : []),
              ]} />
            ) : null}
          </svg>
        ) : <div className="med-chart-empty" />}
      </div>
    </div>
  );
}

/** Armónicos del 2 al 15 (percentil 95), por fase. */
export function HarmonicsBars({ bars, label }: { bars: HarmonicBar[]; label: string }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const phases = [{ key: "l1" as const, color: COLORS.l1, label: "L1" }, { key: "l2" as const, color: COLORS.l2, label: "L2" }, { key: "l3" as const, color: COLORS.l3, label: "L3" }];
  const height = 190, pad = { l: 40, r: 8, t: 10, b: 24 };
  const plotW = Math.max(10, width - pad.l - pad.r), plotH = height - pad.t - pad.b;
  const top = Math.max(0.5, ...bars.flatMap((b) => [b.l1 ?? 0, b.l2 ?? 0, b.l3 ?? 0])) * 1.1;
  const y = (v: number) => pad.t + (1 - v / top) * plotH;
  const colW = plotW / Math.max(1, bars.length);
  const barW = Math.max(2, Math.min(10, (colW - 6) / 3 - 2));
  return (
    <div className="med-chart">
      <Legend items={phases} />
      <div ref={ref} className="med-chart-body">
        {width && bars.length ? (
          <svg width={width} height={height} role="img" aria-label={label} className="med-svg" onPointerLeave={() => setHover(null)}>
            {niceTicks(0, top).map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={pad.l + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? COLORS.axis : COLORS.grid} />
                <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill={COLORS.muted}>{fmt(t, top < 5 ? 1 : 0)}</text>
              </g>
            ))}
            <text x={pad.l - 6} y={pad.t - 1} textAnchor="end" fontSize="10" fill={COLORS.muted}>%</text>
            {bars.map((b, i) => {
              const cx = pad.l + colW * i + colW / 2;
              const start = cx - (3 * (barW + 2) - 2) / 2;
              return (
                <g key={b.order}>
                  <rect x={pad.l + colW * i} y={pad.t} width={colW} height={plotH} fill={hover === i ? "#f3f2ee" : "transparent"} onPointerEnter={() => setHover(i)} />
                  {phases.map((p, j) => <path key={p.key} d={barPath(start + j * (barW + 2), y(b[p.key] ?? 0), barW, y(0), true)} fill={p.color} pointerEvents="none" />)}
                  <text x={cx} y={height - 8} textAnchor="middle" fontSize="11" fill={COLORS.muted}>{b.order}</text>
                </g>
              );
            })}
            {hover !== null && bars[hover] ? (
              <SvgTooltip x={pad.l + colW * hover + colW / 2} y={pad.t} width={width} lines={[
                { text: `Armónico ${bars[hover]!.order}`, strong: true },
                ...phases.map((p) => ({ text: `${p.label}: ${fmt(bars[hover]![p.key], 2)} %`, color: p.color })),
              ]} />
            ) : null}
          </svg>
        ) : <div className="med-chart-empty">{bars.length ? null : "Este periodo no trae armónicos."}</div>}
      </div>
    </div>
  );
}
