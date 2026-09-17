"use client";

import { useState } from "react";

import { hourLabel, shadowAt, shadowDay, type ShadingResult } from "@/lib/solar/engineering/shading";

/* Simulador de sombras: vista lateral con el obstaculo, la primera fila y la segunda, el sol a la
   hora elegida del solsticio de invierno y la sombra proyectada. Un control de hora y otro de
   distancia entre filas; abajo, la distancia necesaria a lo largo del dia. */

const nf = (d: number) => new Intl.NumberFormat("es-MX", { minimumFractionDigits: d, maximumFractionDigits: d });
const m2 = (v: number) => (Number.isFinite(v) ? `${nf(2).format(v)} m` : "—");

export function ShadowScene({ result, inclinationDeg, slopeDeg, obstacleHeightM }: { result: ShadingResult; inclinationDeg: number; slopeDeg: number; obstacleHeightM: number }) {
  const [hour, setHour] = useState(8);
  const [distance, setDistance] = useState<number | null>(null);
  const L = result.panelLengthM;
  const D = distance ?? Math.round(result.rowDistanceM * 100) / 100;
  const now = shadowAt(result.latitude, hour, L, inclinationDeg, slopeDeg, obstacleHeightM);
  const day = shadowDay(result.latitude, L, inclinationDeg, slopeDeg, obstacleHeightM, D, 5);
  const aEff = inclinationDeg - slopeDeg;
  const clearNow = now.up && now.requiredDistanceM <= D;

  // ---- escena lateral (metros → px)
  const obstacleGap = obstacleHeightM > 0 && Number.isFinite(result.obstacleDistanceM) ? Math.max(result.obstacleDistanceM, 0.5) : 0;
  const W = 900, H = 300, padX = 40, ground = 235;
  const spanM = Math.max(4, obstacleGap + D + L * Math.cos((aEff * Math.PI) / 180) + 1);
  const k = (W - 2 * padX) / spanM;
  const x = (m: number) => padX + m * k;
  const y = (m: number) => ground - m * k;
  const rise = L * Math.sin((aEff * Math.PI) / 180), run = L * Math.cos((aEff * Math.PI) / 180);
  const rows = [obstacleGap, obstacleGap + D];
  const shadowLen = Number.isFinite(now.rowShadowM) ? Math.min(now.rowShadowM, spanM) : spanM;
  const obsShadow = Number.isFinite(now.obstacleShadowM) ? Math.min(now.obstacleShadowM, spanM) : spanM;
  const sunX = now.up ? x(rows[0]! + run - Math.cos((now.altitudeDeg * Math.PI) / 180) * 3.2) : -100;
  const sunY = now.up ? y(rise + Math.sin((now.altitudeDeg * Math.PI) / 180) * 3.2) : -100;

  return (
    <div className="shadow-scene">
      <div className="shadow-controls">
        <label className="eng-field"><span>Hora solar del 21 de diciembre · {hourLabel(hour)}</span><input max={18} min={6} onChange={(e) => setHour(Number(e.target.value))} step={0.25} type="range" value={hour} /></label>
        <label className="eng-field"><span>Distancia entre filas · {m2(D)}{distance == null ? " (la mínima calculada)" : ""}</span><input max={Math.max(20, Math.ceil(result.rowDistanceM * 2))} min={run} onChange={(e) => setDistance(Number(e.target.value))} step={0.05} type="range" value={D} /><small><button className="cons-reset" onClick={() => setDistance(null)} type="button">volver a la mínima</button></small></label>
      </div>
      <svg className="shadow-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Vista lateral de las filas de paneles y su sombra a la hora elegida">
        <defs><linearGradient id="sky" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#f0f9ff" /><stop offset="1" stopColor="#ffffff" /></linearGradient></defs>
        <rect fill="url(#sky)" height={ground} width={W} x="0" y="0" />
        <rect fill="#f1f5f9" height={H - ground} width={W} x="0" y={ground} />
        <line stroke="#94a3b8" strokeWidth="1.5" x1="0" x2={W} y1={ground} y2={ground} />
        {/* sombra en el suelo */}
        {now.up ? <rect fill="#0f172a" fillOpacity="0.16" height="6" width={Math.max(0, x(rows[0]! + run + shadowLen) - x(rows[0]! + run))} x={x(rows[0]! + run)} y={ground - 3} /> : null}
        {now.up && obstacleHeightM > 0 ? <rect fill="#0f172a" fillOpacity="0.16" height="6" width={Math.max(0, x(obsShadow) - x(0))} x={x(0)} y={ground - 3} /> : null}
        {/* obstaculo */}
        {obstacleHeightM > 0 ? (<g>
          <rect fill="#cbd5e1" height={ground - y(obstacleHeightM)} stroke="#64748b" width="10" x={x(0) - 5} y={y(obstacleHeightM)} />
          <text fill="#334155" fontSize="11" textAnchor="middle" x={x(0)} y={y(obstacleHeightM) - 6}>{m2(obstacleHeightM)}</text>
          <line stroke="#ef4444" strokeDasharray="3 3" x1={x(0)} x2={x(rows[0]!)} y1={ground + 22} y2={ground + 22} />
          <text fill="#b91c1c" fontSize="11" textAnchor="middle" x={x(rows[0]! / 2)} y={ground + 36}>{m2(rows[0]!)} al obstáculo</text>
        </g>) : null}
        {/* filas */}
        {rows.map((r, i) => (
          <g key={i}>
            <line stroke="#0e7490" strokeLinecap="round" strokeWidth="6" x1={x(r)} x2={x(r + run)} y1={ground} y2={y(rise)} />
            <line stroke="#334155" strokeWidth="2" x1={x(r + run)} x2={x(r + run)} y1={y(rise)} y2={ground} />
            {i === 1 ? <text fill={clearNow ? "#166534" : "#b91c1c"} fontSize="12" fontWeight="700" textAnchor="middle" x={x(r + run / 2)} y={y(rise) - 8}>{clearNow ? "libre" : "con sombra"}</text> : null}
          </g>
        ))}
        {/* cotas */}
        <line stroke="#ef4444" strokeDasharray="3 3" x1={x(rows[0]!)} x2={x(rows[1]!)} y1={ground + 22} y2={ground + 22} />
        <text fill="#b91c1c" fontSize="11" textAnchor="middle" x={x(rows[0]! + D / 2)} y={ground + 36}>{m2(D)} pie a pie</text>
        <text fill="#334155" fontSize="11" textAnchor="middle" x={x(rows[0]! + run / 2) - 10} y={y(rise / 2) - 8}>{m2(L)}</text>
        <text fill="#334155" fontSize="11" x={x(rows[0]!) + 34} y={ground - 14}>{nf(0).format(inclinationDeg)}°</text>
        {/* rayo de sol y sol */}
        {now.up ? <line stroke="#f59e0b" strokeDasharray="4 4" strokeWidth="1.5" x1={sunX} x2={x(rows[0]! + run + shadowLen)} y1={sunY} y2={ground} /> : null}
        {now.up ? <g><circle cx={sunX} cy={sunY} fill="#fbbf24" r="12" /><text fill="#92400e" fontSize="11" textAnchor="middle" x={sunX} y={sunY - 18}>{nf(1).format(now.altitudeDeg)}°</text></g> : <text fill="#64748b" fontSize="12" x={padX} y="30">El sol está bajo el horizonte a esta hora.</text>}
        <text fill="#64748b" fontSize="11" x={W - padX} y={H - 8} textAnchor="end">Solsticio de invierno · latitud {nf(0).format(result.latitude)}° · sombra de la fila {m2(now.rowShadowM)}</text>
      </svg>
      <div className="eng-rows is-compact">
        <div className={`eng-row ${clearNow ? "is-ok" : "is-bad"}`}><span>A las {hourLabel(hour)}</span><strong>{now.up ? `sombra de ${m2(now.rowShadowM)} · hace falta ${m2(now.requiredDistanceM)} pie a pie` : "sin sol"}</strong></div>
        <div className={`eng-row ${day.clearFrom != null ? "is-ok" : "is-bad"}`}><span>Con {m2(D)} entre filas</span><strong>{day.clearFrom != null && day.clearTo != null ? `libres de ${hourLabel(day.clearFrom)} a ${hourLabel(day.clearTo)} (${nf(2).format(day.clearTo - day.clearFrom)} h)` : "las filas se hacen sombra todo el día"}</strong></div>
      </div>
      <DayChart day={day} distance={D} />
    </div>
  );
}

function DayChart({ day, distance }: { day: ReturnType<typeof shadowDay>; distance: number }) {
  const W = 900, H = 170, padL = 44, padB = 26, padT = 12;
  const pts = day.hours.filter((h) => h.up && Number.isFinite(h.requiredDistanceM));
  if (!pts.length) return null;
  const maxD = Math.min(Math.max(distance * 1.6, ...pts.map((p) => p.requiredDistanceM).filter((v) => v < distance * 3)), distance * 3);
  const x = (h: number) => padL + ((h - 5) / 14) * (W - padL - 10);
  const y = (d: number) => padT + (H - padT - padB) * (1 - Math.min(d, maxD) / maxD);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.hour).toFixed(1)},${y(p.requiredDistanceM).toFixed(1)}`).join(" ");
  return (
    <svg className="shadow-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Distancia necesaria entre filas a lo largo del día">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => <g key={f}><line stroke="#e2e8f0" x1={padL} x2={W - 10} y1={y(maxD * f)} y2={y(maxD * f)} /><text fill="#64748b" fontSize="10" textAnchor="end" x={padL - 6} y={y(maxD * f) + 3}>{nf(1).format(maxD * f)} m</text></g>)}
      {[6, 8, 10, 12, 14, 16, 18].map((h) => <text fill="#64748b" fontSize="10" key={h} textAnchor="middle" x={x(h)} y={H - 8}>{h}:00</text>)}
      {day.clearFrom != null && day.clearTo != null ? <rect fill="#dcfce7" height={H - padT - padB} width={x(day.clearTo) - x(day.clearFrom)} x={x(day.clearFrom)} y={padT} /> : null}
      <path d={path} fill="none" stroke="#0e7490" strokeWidth="2" />
      <line stroke="#ef4444" strokeDasharray="5 4" strokeWidth="1.5" x1={padL} x2={W - 10} y1={y(distance)} y2={y(distance)} />
      <text fill="#b91c1c" fontSize="10" x={W - 12} y={y(distance) - 4} textAnchor="end">distancia elegida {nf(2).format(distance)} m</text>
      <text fill="#334155" fontSize="10" x={W - 12} y={padT + 10} textAnchor="end">distancia necesaria por hora</text>
    </svg>
  );
}
