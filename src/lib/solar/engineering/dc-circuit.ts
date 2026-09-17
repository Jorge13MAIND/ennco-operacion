/* Circuito eléctrico en corriente directa (hoja Cal_Cir_Ele_DC, construida en la reconstrucción
   ENNCO 2026 conforme a NOM-001-SEDE-2012: 690-7, 690-8, 690-9, 690-31, 310-15, 240-6, Cap. 10). */
import { CONDUITS, FUSES, firstAtLeast, GROUPING_FACTORS, lastAtMost, PV_WIRES, ROOFTOP_ADDERS, TEMP_FACTORS } from "@/lib/solar/engineering/nom-tables";

export type DcCircuitInput = {
  /** Del arreglo (MPPT 1 de Cal_Inv_St): módulos en serie, cadenas, Isc e Imp en STC, Voc frío, Vmp caliente. */
  modulesInSeries: number; strings: number;
  iscStcA: number; impStcA: number; vocColdV: number; vmpHotV: number;
  /** D38 del inversor: tensión máxima de entrada. */
  inverterMaxV: number;
  /** F19 / F20 / J19 / J20 */
  installation: "Tubería" | "Aire libre"; awg: 14 | 12 | 10 | 8 | 6 | 4; circuitsInRaceway: number; insulationC: number;
  /** F21 / J21 / F22 (vienen de la hoja AC) */
  ambientC: number; onRooftop: boolean; roofSeparationMm: number;
  /** J22 (m) */
  lengthM: number;
  /** F23: las cadenas se combinan en un solo conductor. */
  combinedStrings: boolean;
  /** J38: fusible máximo de serie de la ficha del módulo (A); null si no se capturó. */
  moduleMaxFuseA?: number | null;
};

export type DcCircuitResult = {
  /** J25 / J26 / J27 */
  stringMaxA: number; circuitMaxA: number; fuseCurrentA: number;
  /** J28 / J29 / J30 */
  designTempC: number; tempFactor: number; groupingFactor: number;
  /** J31 / J32 / J33 / J34 */
  baseAmpacityA: number; correctedAmpacityA: number; complies: boolean; requiredBaseA: number;
  /** J35: calibre mínimo que cumple; null si ninguno hasta 4 AWG. */
  minimumAwg: number | null;
  /** J36 / J37 / J39 */
  fuseA: number | null; fuseRequired: boolean; fuseCheck: "ok" | "exceeds" | "unknown" | "na";
  /** J40 / J41 */
  arrayMaxV: number; voltageOk: boolean;
  /** J42 .. J46 */
  resistanceOhmKm90: number; operatingA: number; voltageDropV: number; voltageDropFraction: number; dropOk: boolean;
  /** J47 / J48 */
  cableAreaMm2: number; conduit: string | null;
  warnings: string[];
};

export function computeDcCircuit(input: DcCircuitInput): DcCircuitResult {
  const warnings: string[] = [];
  const strings = Math.max(input.strings, 1);
  const wire = PV_WIRES.find((w) => w.awg === input.awg) ?? PV_WIRES[2]!;
  const freeAir = input.installation === "Aire libre";

  const stringMaxA = 1.25 * input.iscStcA;                                   // J25 (690-8(a)(1))
  const circuitMaxA = input.combinedStrings ? stringMaxA * strings : stringMaxA; // J26
  const fuseCurrentA = 1.25 * stringMaxA;                                    // J27 (690-8(b)(1))
  const adder = input.onRooftop ? (ROOFTOP_ADDERS[lastAtMost(ROOFTOP_ADDERS.map((a) => a.fromMm), input.roofSeparationMm)]?.addC ?? 0) : 0;
  const designTempC = input.ambientC + adder;                               // J28
  const tempFactor = TEMP_FACTORS[Math.max(0, lastAtMost(TEMP_FACTORS.map((t) => t.from), designTempC))]?.f[2] ?? 0; // J29 (columna 90 °C)
  const groupingFactor = GROUPING_FACTORS[Math.max(0, lastAtMost(GROUPING_FACTORS.map((g) => g.from), 2 * input.circuitsInRaceway))]?.f ?? 1; // J30
  const baseAmpacityA = freeAir ? wire.airA : wire.conduitA;                // J31
  const correctedAmpacityA = baseAmpacityA * tempFactor * groupingFactor;   // J32
  const complies = baseAmpacityA >= 1.25 * circuitMaxA && correctedAmpacityA >= circuitMaxA; // J33 (690-8(b)(2))
  const requiredBaseA = Math.max(1.25 * circuitMaxA, tempFactor * groupingFactor > 0 ? circuitMaxA / (tempFactor * groupingFactor) : Infinity); // J34
  if (tempFactor === 0) warnings.push("La temperatura de diseño supera lo permitido para el cable PV a 90 °C.");

  const iFuse = firstAtLeast(FUSES, fuseCurrentA);                          // J36
  const fuseA = iFuse >= 0 ? FUSES[iFuse]! : null;
  if (fuseA == null) warnings.push("La corriente de fusible supera 100 A: revisar con ingeniería.");
  // J35: primer calibre que cumple con terminales a 75 °C, ampacidad corregida y protección 240-4(d).
  const okRow = PV_WIRES.find((w) => w.terminalA75 >= 1.25 * circuitMaxA && (freeAir ? w.airA : w.conduitA) * tempFactor * groupingFactor >= circuitMaxA && (fuseA == null || w.maxOcpdA >= fuseA));
  const minimumAwg = okRow?.awg ?? null;
  if (minimumAwg == null) warnings.push("Ningún cable PV hasta 4 AWG cumple: usar conductor en canalización de mayor calibre.");
  else if (input.awg > minimumAwg) warnings.push(`El calibre capturado (${input.awg} AWG) es menor que el mínimo que cumple (${minimumAwg} AWG).`);
  const fuseRequired = strings > 2;                                          // J37 (690-9 excepción)
  const fuseCheck: DcCircuitResult["fuseCheck"] = fuseA == null ? "na" : input.moduleMaxFuseA == null ? "unknown" : fuseA <= input.moduleMaxFuseA ? "ok" : "exceeds"; // J39
  if (fuseCheck === "exceeds") warnings.push("El fusible requerido supera el máximo de serie que permite el módulo.");
  if (fuseCheck === "unknown" && fuseRequired) warnings.push("Captura el fusible máximo de serie de la ficha del módulo para validar la protección.");

  const arrayMaxV = input.vocColdV * input.modulesInSeries;                 // J40 (690-7)
  const voltageOk = arrayMaxV <= 1000 && arrayMaxV <= input.inverterMaxV;   // J41
  if (!voltageOk) warnings.push("La tensión máxima del arreglo supera 1000 V o la máxima del inversor.");

  const resistanceOhmKm90 = wire.ohmKm75 * (1 + 0.00323 * (90 - 75));      // J42 (Tabla 8, nota 2)
  const operatingA = input.impStcA * strings;                               // J43
  const voltageDropV = (2 * operatingA * input.lengthM * resistanceOhmKm90) / 1000; // J44
  const vmpString = input.vmpHotV * input.modulesInSeries;
  const voltageDropFraction = vmpString > 0 ? voltageDropV / vmpString : 0; // J45
  const dropOk = voltageDropFraction <= 0.03;                               // J46
  if (!dropOk) warnings.push("La caída de tensión supera el 3 %: aumenta el calibre o acorta la trayectoria.");

  const conductors = 2 * input.circuitsInRaceway;
  const cableAreaMm2 = freeAir ? 0 : conductors * (Math.PI / 4) * wire.diameterMm ** 2; // J47
  let conduit: string | null = null;
  if (!freeAir) {
    // Con dos conductores el llenado permitido es 31 % (Tabla 1); la tabla trae el área al 40 %.
    const needed = cableAreaMm2 * (conductors <= 2 ? 0.4 / 0.31 : 1);
    const i = firstAtLeast(CONDUITS.map((c) => c.area40Mm2), needed);       // J48
    conduit = i >= 0 ? CONDUITS[i]!.inches : null;
    if (conduit == null) warnings.push("Los cables no caben en una tubería de 4 pulgadas: dividir en más canalizaciones.");
  }

  return { stringMaxA, circuitMaxA, fuseCurrentA, designTempC, tempFactor, groupingFactor, baseAmpacityA, correctedAmpacityA, complies, requiredBaseA, minimumAwg, fuseA, fuseRequired, fuseCheck, arrayMaxV, voltageOk, resistanceOhmKm90, operatingA, voltageDropV, voltageDropFraction, dropOk, cableAreaMm2, conduit, warnings };
}
