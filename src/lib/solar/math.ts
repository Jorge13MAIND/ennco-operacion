/** Funciones de Excel que el libro usa y JavaScript no trae igual. */

/** ROUND de Excel: mitad se aleja de cero. */
export function excelRound(value: number, digits = 0): number {
  const factor = 10 ** digits;
  const scaled = Math.abs(value) * factor;
  const rounded = Math.round(scaled + 1e-9);
  const out = (Math.sign(value) || 1) * rounded / factor;
  return out === 0 ? 0 : out;
}
/** ROUNDUP de Excel: se aleja de cero. */
export function excelRoundUp(value: number, digits = 0): number {
  const factor = 10 ** digits;
  const scaled = Math.abs(value) * factor;
  const rounded = Math.ceil(scaled - 1e-9);
  const out = (Math.sign(value) || 1) * rounded / factor;
  return out === 0 ? 0 : out;
}
/** INT de Excel: hacia menos infinito. */
export function excelInt(value: number): number {
  const out = Math.floor(value + 1e-9);
  return out === 0 ? 0 : out;
}
export function safeDiv(numerator: number, denominator: number, fallback = 0): number {
  return Number.isFinite(numerator / denominator) && denominator !== 0 ? numerator / denominator : fallback;
}
export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
/** IRR de Excel (Newton con respaldo por bisección). Devuelve 0 si no converge, como IFERROR(IRR(...),0). */
export function irr(cashFlows: number[], guess = 0.1): number {
  const npv = (rate: number) => cashFlows.reduce((acc, cf, t) => acc + cf / (1 + rate) ** t, 0);
  if (cashFlows.every((cf) => cf === 0) || !cashFlows.some((cf) => cf > 0) || !cashFlows.some((cf) => cf < 0)) return 0;
  let rate = guess;
  for (let i = 0; i < 100; i += 1) {
    const value = npv(rate);
    const derivative = cashFlows.reduce((acc, cf, t) => acc - (t * cf) / (1 + rate) ** (t + 1), 0);
    if (derivative === 0) break;
    const next = rate - value / derivative;
    if (!Number.isFinite(next) || next <= -0.999999) break;
    if (Math.abs(next - rate) < 1e-12) return next;
    rate = next;
  }
  let low = -0.99;
  let high = 10;
  let fLow = npv(low);
  if (fLow * npv(high) >= 0) return 0;
  for (let i = 0; i < 300; i += 1) {
    const mid = (low + high) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-10) return mid;
    if (fLow * fMid < 0) high = mid; else { low = mid; fLow = fMid; }
  }
  return (low + high) / 2;
}
