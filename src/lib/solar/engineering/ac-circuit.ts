/* Circuito eléctrico en corriente alterna (hoja Cal_Cir_Ele_AC del libro).
   Del inversor toma corriente y tensión de salida; con el material, la temperatura de
   operación, el ambiente, el agrupamiento y la techumbre corrige la ampacidad de cada calibre
   (310-15), elige el conductor, el interruptor (240-6), el conductor de tierra (250-122) y
   estima la caída de tensión con la impedancia de la Tabla 9. */
import { findInverter } from "@/lib/solar/catalog";
import { excelRoundUp } from "@/lib/solar/math";
import type { SolarCatalog } from "@/lib/solar/types";
import { ampacityColumn, BREAKERS, EGC, ELECTRICAL_CONFIG, firstAtLeast, GROUPING_FACTORS, lastAtMost, ROOFTOP_ADDERS, TEMP_FACTORS, WIRES } from "@/lib/solar/engineering/nom-tables";

export type AcCircuitInput = {
  projectName: string; city: string;
  inverterModel: string;
  /** F19 */
  invertersCount: number;
  /** F17: tensión L-L; por defecto la del inversor. */
  gridV?: number | null;
  /** F22 */
  material: "Cobre" | "Aluminio";
  /** F21/F24: el libro decide la tabla por "Aéreo"; aquí es explícito. */
  installation: "Tubería" | "Aire libre";
  /** F23 (°C) */
  ambientC: number;
  /** J21 */
  conductorsPerRaceway: number;
  /** J22, informativo */
  insulation: string;
  /** J23 */
  tempRating: 60 | 75 | 90;
  /** J24 / I25 */
  onRooftop: boolean; roofSeparationMm: number;
  /** F32: calibre elegido (mm²); por defecto el recomendado. */
  selectedMm2?: number | null;
  /** F39 (m) */
  lengthM: number;
};

export type AcCircuitResult = {
  config: string; lineToLineV: number; lineToNeutralV: number; maxOutputA: number; maxOutputW: number;
  /** S78 / S85 / R90 */
  designTempC: number; tempFactor: number; groupingFactor: number;
  /** F27 / F28 */
  maxCurrentA: number; compensatedA: number;
  /** F29 */
  conductorsPerPhase: number;
  /** Tabla corregida (E13:E38) para mostrar. */
  table: Array<{ mm2: number; awg: string; correctedA: number }>;
  /** F30 / I30 / J28: recomendado. */
  recommended: { mm2: number; awg: string; correctedA: number } | null;
  /** F32 / G32 / J27: elegido. */
  selected: { mm2: number; awg: string; correctedA: number } | null;
  /** J33 / J35 */
  breakerA: number | null; egcMaxA: number | null;
  /** F36 / G35 */
  egc: { mm2: number; awg: string | null } | null;
  /** J38 / G39 / I40 */
  impedanceOhmKm: number | null; voltageDropFraction: number; finalV: number;
  warnings: string[];
};

export function computeAcCircuit(input: AcCircuitInput, catalog: SolarCatalog): AcCircuitResult {
  const inv = findInverter(catalog, input.inverterModel);
  if (!inv) throw new Error(`SOLAR_INVERTER_NOT_FOUND: ${input.inverterModel}`);
  const warnings: string[] = [];
  const aluminum = input.material === "Aluminio";
  const freeAir = input.installation === "Aire libre";

  const lineToLineV = input.gridV && input.gridV > 0 ? input.gridV : (inv.gridV ?? 0);
  const lineToNeutralV = lineToLineV / Math.SQRT2 / Math.sqrt(1.5); // = V / √3 como el libro
  const config = ELECTRICAL_CONFIG[inv.phases ?? 0] ?? "";
  const maxOutputA = inv.maxOutputA ?? 0;
  const maxOutputW = input.invertersCount * inv.pmaxFvW;

  // Temperatura de diseño = ambiente + sumador por techumbre (310-15(b)(3)(c)).
  const adder = input.onRooftop ? (ROOFTOP_ADDERS[lastAtMost(ROOFTOP_ADDERS.map((a) => a.fromMm), input.roofSeparationMm)]?.addC ?? 0) : 0;
  const designTempC = input.ambientC + adder;
  const tRow = TEMP_FACTORS[Math.max(0, lastAtMost(TEMP_FACTORS.map((t) => t.from), designTempC))];
  const tempFactor = tRow?.f[[60, 75, 90].indexOf(input.tempRating)] ?? 0;
  const groupingFactor = GROUPING_FACTORS[Math.max(0, lastAtMost(GROUPING_FACTORS.map((g) => g.from), input.conductorsPerRaceway))]?.f ?? 1;
  if (tempFactor === 0) warnings.push("No es viable esta instalación: la temperatura de exposición supera lo permitido por el aislamiento. Propón otro método de cableado o un aislamiento de mayor temperatura.");

  const col = ampacityColumn(input.tempRating, aluminum, freeAir);
  const table = WIRES.map((w) => ({ mm2: w.mm2, awg: w.awg, correctedA: (w.amps[col] ?? 0) * tempFactor * groupingFactor }));
  const maxCurrentA = maxOutputA * input.invertersCount;      // F27
  const compensatedA = maxCurrentA * 1.25;                    // F28 (690-8)
  const biggest = table[table.length - 1]!.correctedA;
  const conductorsPerPhase = biggest > 0 ? Math.max(1, excelRoundUp(compensatedA / biggest)) : 1; // F29
  const perConductor = compensatedA / Math.max(conductorsPerPhase, 1);
  const iRec = firstAtLeast(table.map((t) => t.correctedA), perConductor);
  const recommended = iRec >= 0 ? table[iRec]! : null;
  if (!recommended && compensatedA > 0) warnings.push("Ningún calibre de la tabla alcanza la corriente compensada con las correcciones aplicadas.");
  const selMm2 = input.selectedMm2 && input.selectedMm2 > 0 ? input.selectedMm2 : recommended?.mm2 ?? null;
  const selected = selMm2 != null ? table.find((t) => t.mm2 === selMm2) ?? null : null;
  if (selMm2 != null && !selected) warnings.push("El calibre elegido no está en la tabla.");
  if (recommended && selected && selected.correctedA < compensatedA / Math.max(conductorsPerPhase, 1)) warnings.push("La ampacidad del conductor elegido es inferior a la corriente del circuito. Sube un calibre.");

  const iBrk = firstAtLeast(BREAKERS, compensatedA);          // J33
  const breakerA = iBrk >= 0 ? BREAKERS[iBrk]! : null;
  if (breakerA == null && compensatedA > 0) warnings.push("La corriente supera el interruptor más grande de la tabla (2500 A).");
  if (selected && breakerA != null && selected.correctedA < breakerA) warnings.push("La ampacidad del conductor es inferior al interruptor. El ITM debe ser menor o igual a la ampacidad del cable.");
  const iEgc = breakerA != null ? firstAtLeast(EGC.map((e) => e.upToA), breakerA) : -1; // G35/F36
  const egcRow = iEgc >= 0 ? EGC[iEgc]! : null;
  const egc = egcRow ? (aluminum ? { mm2: egcRow.alMm2, awg: egcRow.alAwg } : { mm2: egcRow.cuMm2, awg: egcRow.cuAwg }) : null;
  const egcMaxA = egcRow?.upToA ?? null;

  const wire = selected ? WIRES.find((w) => w.mm2 === selected.mm2) ?? null : null;
  const impedanceOhmKm = wire ? (aluminum ? wire.ohmKmAl : wire.ohmKmCu) : null; // J38
  const voltageDropFraction = impedanceOhmKm != null && lineToNeutralV > 0 ? (maxCurrentA * input.lengthM * impedanceOhmKm) / 1000 / lineToNeutralV : 0; // G39
  const finalV = lineToLineV / (1 + voltageDropFraction);   // I40
  if (voltageDropFraction > 0.03) warnings.push("La caída de tensión supera el 3 % recomendado para el circuito del inversor.");

  return { config, lineToLineV, lineToNeutralV, maxOutputA, maxOutputW, designTempC, tempFactor, groupingFactor, maxCurrentA, compensatedA, conductorsPerPhase, table, recommended, selected, breakerA, egcMaxA, egc, impedanceOhmKm, voltageDropFraction, finalV, warnings };
}
