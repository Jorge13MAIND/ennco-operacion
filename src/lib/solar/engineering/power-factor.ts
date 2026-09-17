/* Corrección de factor de potencia (hoja Cal_Fac_Pot del libro).
   Con doce meses de demanda, energía activa y reactiva se calcula el banco de capacitores
   necesario para llegar al factor deseado, mes a mes y en promedio, y se simula un banco fijo. */
import { excelRound } from "@/lib/solar/math";

export type PowerFactorMonth = { month: string; demandKw: number; activeKwh: number; reactiveKvarh: number };
export type PowerFactorInput = {
  months: PowerFactorMonth[];
  /** W9: factor de potencia deseado (0.97). */
  targetPf: number;
  /** AE9: factor normado por CFE (0.95), informativo. */
  requiredPf: number;
  /** AE12: banco fijo a instalar (kVAr). */
  fixedBankKvar: number;
};
export type PowerFactorRow = {
  month: string; demandKw: number; activeKwh: number; reactiveKvarh: number;
  /** O: factor de potencia medido (redondeado a 4 como el libro). */
  pf: number;
  /** Con capacitor automático: reactiva y banco necesario para llegar al deseado. */
  autoReactiveKvarh: number; autoBankKvar: number;
  /** Con banco fijo: reactiva que queda y factor resultante. */
  fixedReactiveKvarh: number; fixedPf: number;
  /** El factor resultante con banco fijo queda por debajo del normado. */
  fixedBelowRequired: boolean;
};
export type PowerFactorResult = {
  rows: PowerFactorRow[];
  /** W12 / W15 / W18: banco promedio, mínimo y máximo necesarios (kVAr). */
  averageBankKvar: number; minBankKvar: number; maxBankKvar: number;
  warnings: string[];
};

const tanAcos = (pf: number) => Math.tan(Math.acos(Math.max(-1, Math.min(1, pf))));

export function computePowerFactor(input: PowerFactorInput): PowerFactorResult {
  const warnings: string[] = [];
  const target = input.targetPf;
  if (!(target > 0 && target <= 1)) warnings.push("El factor de potencia deseado debe estar entre 0 y 1.");
  const rows = input.months.map((m) => {
    const denom = Math.sqrt(m.activeKwh ** 2 + m.reactiveKvarh ** 2);
    const pf = denom === 0 ? 0 : excelRound(m.activeKwh / denom, 4);              // O9
    const autoReactiveKvarh = m.activeKwh * tanAcos(target);                        // L26
    const autoBankKvar = pf === 0 ? 0 : m.demandKw * (tanAcos(pf) - tanAcos(target)); // R26
    const fixedReactiveKvarh = pf === 0 || m.demandKw === 0 ? 0 : m.activeKwh * tanAcos(pf) - input.fixedBankKvar * (m.activeKwh / m.demandKw); // AE26
    const fd = Math.sqrt(m.activeKwh ** 2 + fixedReactiveKvarh ** 2);
    const fixedPf = fd === 0 ? 0 : m.activeKwh / fd;                                // AH26
    return { month: m.month, demandKw: m.demandKw, activeKwh: m.activeKwh, reactiveKvarh: m.reactiveKvarh, pf, autoReactiveKvarh, autoBankKvar, fixedReactiveKvarh, fixedPf, fixedBelowRequired: fixedPf < input.requiredPf };
  });
  const valid = rows.filter((r) => r.pf > 0);
  const avgDemand = rows.length ? rows.reduce((a, r) => a + r.demandKw, 0) / rows.length : 0;
  const avgPf = rows.length ? rows.reduce((a, r) => a + r.pf, 0) / rows.length : 0;
  const averageBankKvar = avgPf > 0 ? avgDemand * (tanAcos(avgPf) - tanAcos(target)) : 0; // W12
  const banks = valid.map((r) => r.autoBankKvar);
  const minBankKvar = banks.length ? Math.min(...banks) : 0;
  const maxBankKvar = banks.length ? Math.max(...banks) : 0;
  if (rows.some((r) => r.pf === 0)) warnings.push("Hay meses sin energía capturada: no cuentan para el banco mínimo ni máximo.");
  if (rows.some((r) => r.fixedBelowRequired)) warnings.push(`Con el banco fijo de ${input.fixedBankKvar} kVAr hay meses por debajo del factor normado (${(input.requiredPf * 100).toFixed(0)} %).`);
  return { rows, averageBankKvar, minBankKvar, maxBankKvar, warnings };
}

export function defaultPowerFactorInput(): PowerFactorInput {
  const names = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const demand = [213, 231, 224, 219.5, 224, 209, 199, 241, 243, 230, 218, 220];
  const active = [101317, 96216, 95574, 95418, 107730, 89116, 98649, 101492, 100925, 108685, 80261, 97247];
  const reactive = [57175, 56684, 55518, 52922, 77156, 58842, 67294, 68916, 71836, 77360, 74945, 59553];
  return { months: names.map((month, i) => ({ month, demandKw: demand[i]!, activeKwh: active[i]!, reactiveKvarh: reactive[i]! })), targetPf: 0.97, requiredPf: 0.95, fixedBankKvar: 90 };
}
