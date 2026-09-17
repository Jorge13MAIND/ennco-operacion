/* Tableros de distribución (hoja Cal_Cir_Ele_Tab, construida en la reconstrucción ENNCO 2026).
   Interconexión del sistema al tablero existente: interruptor FV, regla del 120 % de barras
   (NEC 705.12(D)(2)), alimentador, tierras (250-122 y 250-66) y caída de tensión acumulada. */
import { BREAKERS, EGC, firstAtLeast, GEC } from "@/lib/solar/engineering/nom-tables";

export type PanelBoardInput = {
  /** De la hoja AC. */
  config: string; lineToLineV: number; inverterModel: string; invertersCount: number; inverterOutputA: number;
  feederMm2: number | null; feederAwg: string | null; feederCorrectedA: number | null; acDropFraction: number;
  /** De la hoja DC. */
  dcDropFraction: number; dcStringCurrentA: number; dcMinimumAwg: number | null; dcFuseA: number | null;
  /** Coherencia entre el inversor de AC y el del arreglo. */
  arrayInverterModel: string;
  /** F15 / J15 / F16 */
  busbarA: number; mainBreakerA: number; interconnection: "Barras" | "Lado de línea";
};

export type PanelBoardResult = {
  /** J14 / J19 / J20 */
  totalPvA: number; designA: number; pvBreakerA: number | null;
  /** J21 */
  busbarRule: "ok" | "fail" | "na";
  /** F24/J24 (250-122 por el interruptor FV) y J25 (250-66 por la sección del alimentador). */
  egc: { mm2: number; awg: string } | null; gec: string | null;
  /** J26 / J27 */
  totalDropFraction: number; dropOk: boolean;
  sameInverter: boolean;
  summary: Array<{ circuit: string; designA: number; conductor: string; protectionA: number | null; ground: string }>;
  warnings: string[];
};

export function computePanelBoard(input: PanelBoardInput): PanelBoardResult {
  const warnings: string[] = [];
  const totalPvA = input.inverterOutputA * input.invertersCount; // J14
  const designA = 1.25 * totalPvA;                               // J19 (690-8)
  const iB = firstAtLeast(BREAKERS, designA);                    // J20 (240-6)
  const pvBreakerA = iB >= 0 ? BREAKERS[iB]! : null;
  if (pvBreakerA == null) warnings.push("La corriente FV supera el interruptor más grande de la tabla.");
  let busbarRule: PanelBoardResult["busbarRule"] = "na";
  if (input.interconnection === "Barras" && pvBreakerA != null) {
    busbarRule = input.mainBreakerA + pvBreakerA <= 1.2 * input.busbarA ? "ok" : "fail"; // J21
    if (busbarRule === "fail") warnings.push("No cumple la regla del 120 %: tablero nuevo o interconexión en lado de línea.");
  }
  const iE = pvBreakerA != null ? firstAtLeast(EGC.map((e) => e.upToA), pvBreakerA) : -1;
  const egc = iE >= 0 ? { mm2: EGC[iE]!.cuMm2, awg: EGC[iE]!.cuAwg } : null;   // F24/J24 (cobre)
  const iG = input.feederMm2 != null ? firstAtLeast(GEC.map((g) => g.upToMm2), input.feederMm2) : -1;
  const gec = iG >= 0 ? GEC[iG]!.awg : null;                                      // J25
  const totalDropFraction = input.dcDropFraction + input.acDropFraction;          // J26
  const dropOk = totalDropFraction <= 0.05;                                       // J27
  if (!dropOk) warnings.push("La caída de tensión acumulada DC + AC supera el 5 %.");
  const sameInverter = input.inverterModel === input.arrayInverterModel;          // J28
  if (!sameInverter) warnings.push("Corriente alterna y Arreglos usan inversores distintos: revisa cuál es el del proyecto.");
  const feeder = input.feederAwg ?? "—";
  const summary = [
    { circuit: "DC: cadenas de módulos", designA: input.dcStringCurrentA, conductor: input.dcMinimumAwg != null ? `PV ${input.dcMinimumAwg} AWG` : "—", protectionA: input.dcFuseA, ground: "-" },
    { circuit: "AC: salida del inversor", designA, conductor: feeder, protectionA: pvBreakerA, ground: egc?.awg ?? "—" },
    { circuit: "Alimentador al tablero", designA, conductor: feeder, protectionA: pvBreakerA, ground: egc?.awg ?? "—" },
  ];
  return { totalPvA, designA, pvBreakerA, busbarRule, egc, gec, totalDropFraction, dropOk, sameInverter, summary, warnings };
}
