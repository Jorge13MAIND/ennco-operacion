"use client";

import { useState } from "react";

import { DAY_PRESETS, declinationFor, hourLabel, shadowAt, shadowDay, WINTER_DECLINATION_DEG, type ShadingResult } from "@/lib/solar/engineering/shading";

/* Simulador de sombras: plano lateral con obstaculo frontal, N filas de paneles con su estructura y
   su arco de inclinacion, cotas tipo plano, sol y sombras a la hora elegida; controles de hora, dia
   del ano, distancia entre filas, distancia al obstaculo, latitud y azimut; grafica de distancia
   necesaria por hora y ventanas libres. */

const nf = (d: number) => new Intl.NumberFormat("es-MX", { minimumFractionDigits: d, maximumFractionDigits: d });
const m2 = (v: number) => (Number.isFinite(v) ? `${nf(2).format(v)} m` : "—");
const rad = (d: number) => (d * Math.PI) / 180;

export type ShadowSite = { city: string; moduleModel: string; orientation: string; modulesPerPanel: number };

export function ShadowScene({ result, site, inclinationDeg, slopeDeg, obstacleHeightM }: { result: ShadingResult; site: ShadowSite; inclinationDeg: number; slopeDeg: number; obstacleHeightM: number }) {
  const [hour, setHour] = useState(8);
  const [dayKey, setDayKey] = useState<(typeof DAY_PRESETS)[number]["key"]>("invierno");
  const [distance, setDistance] = useState<number | null>(null);
  const [gap, setGap] = useState<number | null>(null);
  const [latOverride, setLatOverride] = useState<number | null>(null);
  const [azimuth, setAzimuth] = useState(0);
  const [rowsCount, setRowsCount] = useState(2);
  const [obstacleKind, setObstacleKind] = useState<"arbol" | "muro">("arbol");

  const latitude = latOverride ?? result.latitude;
  const preset = DAY_PRESETS.find((d) => d.key === dayKey) ?? DAY_PRESETS[0];
  const declination = preset.key === "invierno" ? WINTER_DECLINATION_DEG : declinationFor(preset.dayOfYear);
  const L = result.panelLengthM;
  const sc = { latitude, panelLengthM: L, inclinationDeg, slopeDeg, obstacleHeightM, panelAzimuthDeg: azimuth, declinationDeg: declination };
  const D = distance ?? Math.round(result.rowDistanceM * 100) / 100;
  const minGap = obstacleHeightM > 0 && Number.isFinite(result.obstacleDistanceM) ? Math.round(result.obstacleDistanceM * 100) / 100 : 0;
  const G = obstacleHeightM > 0 ? (gap ?? Math.max(minGap, 0.5)) : 0;
  const now = shadowAt(sc, hour);
  const day = shadowDay(sc, D, G, 5);
  const aEff = inclinationDeg - slopeDeg;
  const rowsClearNow = now.up && now.requiredDistanceM <= D;
  const obstacleClearNow = obstacleHeightM <= 0 || (now.up && now.obstacleShadowM <= G);

  // ---- geometria (metros → px)
  const rise = L * Math.sin(rad(aEff)), run = L * Math.cos(rad(aEff));
  const rowX = Array.from({ length: Math.max(1, rowsCount) }, (_, i) => G + i * D);
  const spanM = Math.max(6, rowX[rowX.length - 1]! + run + 1.2);
  const W = 1000, H = 360, padX = obstacleHeightM > 0 ? 120 : 46, ground = 262;
  const k = (W - padX - 46) / spanM;
  const x = (m: number) => padX + m * k;
  const y = (m: number) => ground - m * k;
  const thick = Math.max(3, 0.06 * k);
  const rowShadow = Number.isFinite(now.rowShadowM) ? now.rowShadowM : spanM;
  const obsShadow = Number.isFinite(now.obstacleShadowM) ? now.obstacleShadowM : spanM;
  const sunDist = Math.max(3.2, spanM * 0.35);
  const sunX = now.up ? x(rowX[0]! + run - Math.cos(rad(now.altitudeDeg)) * sunDist) : -100;
  const sunY = now.up ? y(rise + Math.sin(rad(now.altitudeDeg)) * sunDist) : -100;

  /** Panel con cuerpo, celdas, pata trasera, pie delantero y riel base (funcion de dibujo, no componente). */
  const renderPanel = (xm: number, shaded: boolean, index: number) => {
    const nx = -Math.sin(rad(aEff)), ny = Math.cos(rad(aEff)); // normal al panel (hacia arriba)
    const p0 = [x(xm), y(0)], p1 = [x(xm + run), y(rise)];
    const q0 = [p0[0]! + nx * thick, p0[1]! - ny * thick], q1 = [p1[0]! + nx * thick, p1[1]! - ny * thick];
    const cells = Array.from({ length: 6 }, (_, i) => (i + 1) / 7);
    return (
      <g>
        <polygon fill={shaded ? "#94a3b8" : "#0e7490"} points={`${p0[0]},${p0[1]} ${p1[0]},${p1[1]} ${q1[0]},${q1[1]} ${q0[0]},${q0[1]}`} stroke="#0f172a" strokeWidth="1" />
        {cells.map((f) => <line key={f} stroke="#ffffff" strokeOpacity="0.55" strokeWidth="1" x1={p0[0]! + (p1[0]! - p0[0]!) * f} x2={q0[0]! + (q1[0]! - q0[0]!) * f} y1={p0[1]! + (p1[1]! - p0[1]!) * f} y2={q0[1]! + (q1[1]! - q0[1]!) * f} />)}
        <line stroke="#475569" strokeWidth="3" x1={p1[0]} x2={p1[0]} y1={p1[1]} y2={ground} />
        <line stroke="#475569" strokeWidth="3" x1={x(xm + run * 0.55)} x2={x(xm + run * 0.55) + 0.55 * run * k * 0.35} y1={y(rise * 0.55)} y2={ground} />
        <rect fill="#475569" height="4" width={run * k} x={p0[0]} y={ground - 2} />
        <circle cx={p0[0]} cy={ground} fill="#ef4444" r="2.5" /><circle cx={p1[0]} cy={ground} fill="#ef4444" r="2.5" />
        {index === 0 ? (<g>
          <path d={`M ${p0[0]! + 40} ${ground} A 40 40 0 0 0 ${p0[0]! + 40 * Math.cos(rad(aEff))} ${ground - 40 * Math.sin(rad(aEff))}`} fill="none" stroke="#b91c1c" strokeWidth="1.2" />
          <text fill="#b91c1c" fontSize="12" fontWeight="700" x={p0[0]! + 46} y={ground - 8}>{nf(0).format(inclinationDeg)}°</text>
        </g>) : null}
        {index === 0 ? <g>
          <line stroke="#b91c1c" strokeWidth="1" x1={q0[0]! + nx * 14} x2={q1[0]! + nx * 14} y1={q0[1]! - ny * 14} y2={q1[1]! - ny * 14} />
          <text fill="#334155" fontSize="12" fontWeight="700" textAnchor="middle" transform={`rotate(${-aEff} ${(q0[0]! + q1[0]!) / 2 + nx * 22} ${(q0[1]! + q1[1]!) / 2 - ny * 22})`} x={(q0[0]! + q1[0]!) / 2 + nx * 22} y={(q0[1]! + q1[1]!) / 2 - ny * 22}>{m2(L)}</text>
        </g> : null}
        {index > 0 ? <text fill={shaded ? "#b91c1c" : "#166534"} fontSize="12" fontWeight="700" textAnchor="middle" x={x(xm + run / 2)} y={y(rise) - 10}>{shaded ? "con sombra" : "libre"}</text> : null}
      </g>
    );
  };
  const renderDim = (a: number, b: number, yPx: number, label: string, color = "#b91c1c") => (
    <g>
      <line stroke={color} strokeWidth="1" x1={x(a)} x2={x(b)} y1={yPx} y2={yPx} />
      <line stroke={color} strokeWidth="1" x1={x(a)} x2={x(a)} y1={yPx - 5} y2={yPx + 5} /><line stroke={color} strokeWidth="1" x1={x(b)} x2={x(b)} y1={yPx - 5} y2={yPx + 5} />
      <text fill={color} fontSize="12" fontWeight="700" textAnchor="middle" x={x((a + b) / 2)} y={yPx + 15}>{label}</text>
    </g>
  );

  const firstRowShaded = obstacleHeightM > 0 && now.up && now.obstacleShadowM > G;
  return (
    <div className="shadow-scene">
      <div className="shadow-site">
        <div><span>Ciudad</span><strong>{site.city}</strong></div>
        <div><span>Latitud del sitio</span><strong><input aria-label="Latitud" className="shadow-lat" inputMode="decimal" onChange={(e) => setLatOverride(e.target.value === "" ? null : Number(e.target.value))} step={0.1} type="number" value={latitude} />°{latOverride != null && latOverride !== result.latitude ? <small> (editada; la ciudad da {nf(0).format(result.latitude)}°)</small> : null}</strong></div>
        <div><span>Módulo</span><strong>{site.moduleModel}</strong></div>
        <div><span>Panel</span><strong>{site.modulesPerPanel} módulos en {site.orientation.toLowerCase()} · {m2(L)} · {nf(0).format(inclinationDeg)}°{slopeDeg ? ` · pendiente ${nf(0).format(slopeDeg)}°` : ""}</strong></div>
      </div>
      <div className="shadow-controls">
        <label className="eng-field"><span>Hora solar · {hourLabel(hour)}</span><input max={18} min={6} onChange={(e) => setHour(Number(e.target.value))} step={0.25} type="range" value={hour} /></label>
        <label className="eng-field"><span>Día del año</span><select onChange={(e) => setDayKey(e.target.value as typeof dayKey)} value={dayKey}>{DAY_PRESETS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</select></label>
        <label className="eng-field"><span>Distancia entre filas · {m2(D)}{distance == null ? " (la mínima calculada)" : ""}</span><input max={Math.max(20, Math.ceil(result.rowDistanceM * 2))} min={Math.max(0.1, run)} onChange={(e) => setDistance(Number(e.target.value))} step={0.05} type="range" value={D} /><small><button className="cons-reset" onClick={() => setDistance(null)} type="button">volver a la mínima</button></small></label>
        <label className="eng-field"><span>Obstáculo frontal · {obstacleHeightM > 0 ? `${m2(obstacleHeightM)} de alto a ${m2(G)} de la primera fila` : "sin obstáculo (captúralo arriba)"}</span>
          <input disabled={obstacleHeightM <= 0} max={Math.max(30, Math.ceil(minGap * 2))} min={0.5} onChange={(e) => setGap(Number(e.target.value))} step={0.1} type="range" value={G} />
          <small>{obstacleHeightM > 0 ? <>mínimo calculado {m2(minGap)} · <button className="cons-reset" onClick={() => setGap(null)} type="button">volver al mínimo</button> · <select aria-label="Tipo de obstáculo" onChange={(e) => setObstacleKind(e.target.value as "arbol" | "muro")} value={obstacleKind}><option value="arbol">árbol</option><option value="muro">muro o edificio</option></select></> : "La altura del obstáculo se captura en Información de instalación."}</small></label>
        <label className="eng-field"><span>Azimut de los paneles · {azimuth === 0 ? "sur" : `${nf(0).format(Math.abs(azimuth))}° al ${azimuth < 0 ? "este" : "oeste"}`}</span><input max={90} min={-90} onChange={(e) => setAzimuth(Number(e.target.value))} step={5} type="range" value={azimuth} /></label>
        <label className="eng-field"><span>Filas dibujadas · {rowsCount} · fondo total {m2((rowsCount - 1) * D + run)}</span><input max={6} min={1} onChange={(e) => setRowsCount(Number(e.target.value))} step={1} type="range" value={rowsCount} /></label>
      </div>

      <svg className="shadow-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Plano lateral de las filas de paneles, el obstáculo frontal y sus sombras a la hora elegida">
        <defs>
          <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#dbeafe" /><stop offset="1" stopColor="#ffffff" /></linearGradient>
          <pattern height="8" id="hatch" patternTransform="rotate(45)" patternUnits="userSpaceOnUse" width="8"><line stroke="#cbd5e1" strokeWidth="1" x1="0" x2="0" y1="0" y2="8" /></pattern>
        </defs>
        <rect fill="url(#sky)" height={ground} width={W} x="0" y="0" />
        <rect fill="url(#hatch)" height={H - ground} width={W} x="0" y={ground} />
        <line stroke="#475569" strokeWidth="2" x1="0" x2={W} y1={ground} y2={ground} />
        {/* sombras en el suelo */}
        {now.up ? rowX.map((r, i) => <rect fill="#0f172a" fillOpacity="0.22" height="7" key={i} width={Math.max(0, Math.min(x(r + run + rowShadow), W) - x(r + run))} x={x(r + run)} y={ground - 3} />) : null}
        {now.up && obstacleHeightM > 0 ? <rect fill="#0f172a" fillOpacity="0.22" height="7" width={Math.max(0, Math.min(x(obsShadow), W) - x(0))} x={x(0)} y={ground - 3} /> : null}
        {/* obstaculo */}
        {obstacleHeightM > 0 ? (<g>
          {obstacleKind === "muro"
            ? <rect fill="#cbd5e1" height={ground - y(obstacleHeightM)} stroke="#475569" width={Math.max(14, 0.4 * k)} x={x(0) - Math.max(14, 0.4 * k)} y={y(obstacleHeightM)} />
            : <g><polygon fill="#86efac" points={`${x(0)},${y(obstacleHeightM)} ${x(0) - 0.9 * obstacleHeightM * k * 0.35},${y(obstacleHeightM * 0.3)} ${x(0) + 0.9 * obstacleHeightM * k * 0.35},${y(obstacleHeightM * 0.3)}`} stroke="#166534" /><rect fill="#92400e" height={ground - y(obstacleHeightM * 0.3)} width={Math.max(4, 0.12 * k)} x={x(0) - Math.max(4, 0.12 * k) / 2} y={y(obstacleHeightM * 0.3)} /></g>}
          <line stroke="#b91c1c" strokeWidth="1" x1={x(0) - 30} x2={x(0) - 30} y1={y(obstacleHeightM)} y2={ground} /><line stroke="#b91c1c" x1={x(0) - 35} x2={x(0) - 25} y1={y(obstacleHeightM)} y2={y(obstacleHeightM)} /><line stroke="#b91c1c" x1={x(0) - 35} x2={x(0) - 25} y1={ground} y2={ground} />
          <text fill="#b91c1c" fontSize="12" fontWeight="700" textAnchor="end" x={x(0) - 36} y={y(obstacleHeightM / 2) + 4}>{m2(obstacleHeightM)}</text>
          {renderDim(0, rowX[0]!, ground + 22, `${m2(G)} al obstáculo`)}
          {firstRowShaded ? <text fill="#b91c1c" fontSize="12" fontWeight="700" textAnchor="middle" x={x(G + run / 2)} y={y(rise) - 10}>sombra del obstáculo</text> : null}
        </g>) : null}
        {/* filas */}
        {rowX.map((r, i) => <g key={i}>{renderPanel(r, i === 0 ? firstRowShaded : !rowsClearNow, i)}</g>)}
        {rowX.length > 1 ? renderDim(rowX[0]!, rowX[1]!, ground + 22 + (obstacleHeightM > 0 ? 22 : 0), `${m2(D)} pie a pie`) : null}
        {rowX.length > 2 ? renderDim(rowX[0]!, rowX[rowX.length - 1]! + run, ground + 44 + (obstacleHeightM > 0 ? 22 : 0), `fondo total ${m2((rowsCount - 1) * D + run)}`, "#475569") : null}
        {/* sol y rayos */}
        {now.up ? (<g>
          <line stroke="#f59e0b" strokeDasharray="5 4" strokeWidth="1.5" x1={sunX} x2={x(rowX[0]! + run + rowShadow)} y1={sunY} y2={ground} />
          {obstacleHeightM > 0 ? <line stroke="#f59e0b" strokeDasharray="5 4" strokeWidth="1.2" x1={x(0)} x2={x(obsShadow)} y1={y(obstacleHeightM)} y2={ground} /> : null}
          <circle cx={sunX} cy={sunY} fill="#fbbf24" r="14" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <line key={a} stroke="#f59e0b" strokeWidth="1.5" x1={sunX + Math.cos(rad(a)) * 18} x2={sunX + Math.cos(rad(a)) * 24} y1={sunY + Math.sin(rad(a)) * 18} y2={sunY + Math.sin(rad(a)) * 24} />)}
          <text fill="#92400e" fontSize="12" fontWeight="700" textAnchor="middle" x={sunX} y={sunY - 30}>{nf(1).format(now.altitudeDeg)}° · {hourLabel(hour)}</text>
        </g>) : <text fill="#64748b" fontSize="13" x={padX} y="34">El sol está bajo el horizonte a esta hora.</text>}
        <text fill="#64748b" fontSize="11" textAnchor="end" x={W - padX} y={H - 8}>{preset.label.split(" (")[0]} · latitud {nf(1).format(latitude)}° · azimut solar {nf(0).format(now.azimuthDeg)}° · sombra de fila {m2(now.rowShadowM)}</text>
      </svg>

      <div className="eng-rows is-compact">
        <div className={`eng-row ${rowsClearNow ? "is-ok" : "is-bad"}`}><span>Filas a las {hourLabel(hour)}</span><strong>{now.up ? `sombra de ${m2(now.rowShadowM)} · hacen falta ${m2(now.requiredDistanceM)} pie a pie` : "sin sol"}</strong></div>
        {obstacleHeightM > 0 ? <div className={`eng-row ${obstacleClearNow ? "is-ok" : "is-bad"}`}><span>Obstáculo a las {hourLabel(hour)}</span><strong>{now.up ? `sombra de ${m2(now.obstacleShadowM)} · la primera fila está a ${m2(G)}` : "sin sol"}</strong></div> : null}
        <div className={`eng-row ${day.rows ? "is-ok" : "is-bad"}`}><span>Con {m2(D)} entre filas</span><strong>{day.rows ? `filas libres de ${hourLabel(day.rows.from)} a ${hourLabel(day.rows.to)} (${nf(2).format(day.rows.to - day.rows.from)} h)` : "las filas se hacen sombra todo el día"}</strong></div>
        {obstacleHeightM > 0 ? <div className={`eng-row ${day.clear ? "is-ok" : "is-bad"}`}><span>Con el obstáculo a {m2(G)}</span><strong>{day.clear ? `instalación libre de ${hourLabel(day.clear.from)} a ${hourLabel(day.clear.to)} (${nf(2).format(day.clear.to - day.clear.from)} h)` : "el obstáculo sombrea la primera fila todo el día"}</strong></div> : null}
        <div className="eng-row"><span>Sol ese día</span><strong>{day.sunrise != null && day.sunset != null ? `de ${hourLabel(day.sunrise)} a ${hourLabel(day.sunset)} (hora solar)` : "—"}</strong></div>
      </div>
      <DayChart day={day} distance={D} />
      <p className="projects-help">Hora solar: el mediodía solar es cuando el sol pasa por el sur, no las 12:00 del reloj (en México van desfasadas entre 20 y 50 minutos según el lugar). Los paneles miran al sur salvo que muevas el azimut. El obstáculo se toma como una pared vertical de la altura capturada, frente a la primera fila.</p>
    </div>
  );
}

function DayChart({ day, distance }: { day: ReturnType<typeof shadowDay>; distance: number }) {
  const W = 1000, H = 190, padL = 48, padB = 26, padT = 14;
  const pts = day.hours.filter((h) => h.up && Number.isFinite(h.requiredDistanceM));
  if (!pts.length) return null;
  const maxD = Math.min(Math.max(distance * 1.6, ...pts.map((p) => p.requiredDistanceM).filter((v) => v < distance * 3)), distance * 3);
  const x = (h: number) => padL + ((h - 5) / 14) * (W - padL - 12);
  const y = (d: number) => padT + (H - padT - padB) * (1 - Math.min(d, maxD) / maxD);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.hour).toFixed(1)},${y(p.requiredDistanceM).toFixed(1)}`).join(" ");
  return (
    <svg className="shadow-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Distancia necesaria entre filas a lo largo del día">
      {day.clear ? <rect fill="#dcfce7" height={H - padT - padB} width={x(day.clear.to) - x(day.clear.from)} x={x(day.clear.from)} y={padT} /> : null}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => <g key={f}><line stroke="#e2e8f0" x1={padL} x2={W - 12} y1={y(maxD * f)} y2={y(maxD * f)} /><text fill="#64748b" fontSize="10" textAnchor="end" x={padL - 6} y={y(maxD * f) + 3}>{nf(1).format(maxD * f)} m</text></g>)}
      {[6, 8, 10, 12, 14, 16, 18].map((h) => <text fill="#64748b" fontSize="10" key={h} textAnchor="middle" x={x(h)} y={H - 8}>{h}:00</text>)}
      <path d={path} fill="none" stroke="#0e7490" strokeWidth="2" />
      <line stroke="#ef4444" strokeDasharray="5 4" strokeWidth="1.5" x1={padL} x2={W - 12} y1={y(distance)} y2={y(distance)} />
      <text fill="#b91c1c" fontSize="10" textAnchor="end" x={W - 14} y={y(distance) - 4}>distancia elegida {nf(2).format(distance)} m</text>
      <text fill="#334155" fontSize="10" textAnchor="end" x={W - 14} y={padT + 10}>distancia necesaria por hora · verde: instalación libre</text>
    </svg>
  );
}
