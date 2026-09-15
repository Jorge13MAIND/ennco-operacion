import { irr } from "@/lib/solar/math";
import type { ProjectionResult, ProjectionYear } from "@/lib/solar/types";

/**
 * Inf_Apoyo: proyección a 30 años. El pago sin FV y con FV crecen con el incremento anual de tarifa;
 * la producción baja con la degradación; la deducción fiscal (ISR sobre el costo sin IVA) entra en el
 * flujo del año 1 si el usuario la pidió. Retorno: años completos en que el ahorro acumulado sigue
 * por debajo de (costo − deducción), más la fracción del año siguiente.
 */
export function computeProjection(params: {
  cost: number; deduction: number; annualConsumption: number; annualGeneration: number;
  paymentWithout: number; paymentWith: number; annualIncrease: number; degradation: number;
}): ProjectionResult {
  const years: ProjectionYear[] = [];
  let payment = params.paymentWithout;
  let production = params.annualGeneration;
  let paymentWithPv = params.paymentWith;
  let cumulative = 0;
  for (let y = 1; y <= 30; y += 1) {
    if (y > 1) {
      payment *= 1 + params.annualIncrease;
      production *= 1 - params.degradation;
      paymentWithPv *= 1 + params.annualIncrease;
    }
    const savings = payment - paymentWithPv;
    cumulative += savings;
    years.push({ year: y, consumption: params.annualConsumption, payment, production, consumptionWithPv: Math.max(params.annualConsumption - production, 0), paymentWithPv, savings, cumulative, cashFlow: y === 1 ? savings + params.deduction : savings });
  }
  const cashFlows = [-params.cost, ...years.map((y) => y.cashFlow)];
  const threshold = params.cost - params.deduction;
  const n = Math.min(years.filter((y) => y.cumulative < threshold).length, 29);
  const cum = n === 0 ? 0 : (years[n - 1]?.cumulative ?? 0);
  const remaining = params.cost - cum;
  const nextSavings = years[n]?.savings ?? 0;
  const fraction = nextSavings !== 0 ? Math.max(remaining, 0) / nextSavings : 0;
  const recovers = nextSavings > 0 && !(n >= 29 && cum < threshold);
  return { cost: params.cost, deduction: params.deduction, irr: irr(cashFlows), years, paybackYears: n, paybackFraction: fraction, paybackTotal: n + fraction, paybackMonths: fraction * 12, recovers };
}
