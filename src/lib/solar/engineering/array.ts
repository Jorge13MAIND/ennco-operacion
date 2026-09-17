/* Arreglos de módulos en inversor (hoja Cal_Inv_St del libro).
   Con el módulo, la ciudad y el inversor calcula los valores eléctricos del módulo a la
   temperatura máxima y mínima de celda, los límites de módulos en serie y cadenas en paralelo
   por MPPT, la tabla de tamaños permitidos y la revisión del arreglo capturado contra el
   inversor (corriente, tensión máxima en frío y tensión mínima en caliente). */
import { cellTemperatures, findCity, findInverter, findModule } from "@/lib/solar/catalog";
import { excelInt, excelRound, excelRoundUp } from "@/lib/solar/math";
import type { SolarCatalog } from "@/lib/solar/types";

export const MAX_MPPT = 10;
/** Columnas de cadenas en paralelo que muestra la tabla del libro. */
export const MAX_PARALLEL_COLUMNS = 6;

export type MpptArrangement = { strings: number; modules: number };
export type ArrayInput = {
  projectName: string;
  city: string;
  moduleModel: string;
  inverterModel: string;
  /** D10 */
  modulesToInstall: number;
  /** D39, informativo. */
  invertersCount: number;
  /** D42: tensión máxima de diseño; por defecto la máxima de entrada del inversor. */
  designMaxV?: number | null;
  /** D46/P36 … por MPPT: cadenas y módulos totales en ese MPPT. */
  mppts: MpptArrangement[];
};

export type ElectricalPoint = { voc: number; isc: number; vmp: number; imp: number; pmp: number };
export type MpptCheck = {
  index: number; strings: number; modules: number;
  /** K48 */
  modulesPerString: number;
  /** S36 */
  powerKw: number;
  /** P49..P55 y sus referencias (Q). */
  impAtSrc: number; iscAtSrc: number; maxIsc: number; refMaxA: number;
  maxVoc: number; refMaxV: number;
  vmpAtSrc: number; refVmpMaxV: number;
  vmpAtMin: number; refMinV: number;
  /** Tabla de tamaños permitidos: módulos en serie × cadenas en paralelo. */
  seriesOptions: number[]; parallelOptions: number[];
  issues: string[];
};
export type ArrayResult = {
  cellTempMaxC: number; cellTempMinC: number;
  stc: ElectricalPoint; hot: ElectricalPoint; cold: ElectricalPoint;
  inverter: { mpptMinV: number; maxDcInputV: number; mpptCount: number; totalStrings: number; pmaxFvW: number; nominalW: number };
  /** T8 / T9 / Z8 / Z9 */
  maxModulesByPower: number; minModulesByVoltage: number; maxSeries: number; minSeries: number;
  designMaxV: number;
  totalModules: number; pvKw: number; dcAcRatio: number;
  /** F10: total acomodado menos los que hay que instalar (negativo = faltan). */
  placementDelta: number;
  mppts: MpptCheck[];
  warnings: string[];
};

const at = (v: number, coef: number, t: number) => v * (1 + coef * (t - 25));

export function computeArray(input: ArrayInput, catalog: SolarCatalog): ArrayResult {
  const city = findCity(catalog, input.city);
  const panel = findModule(catalog, input.moduleModel);
  const inv = findInverter(catalog, input.inverterModel);
  if (!city) throw new Error(`SOLAR_CITY_NOT_FOUND: ${input.city}`);
  if (!panel) throw new Error(`SOLAR_MODULE_NOT_FOUND: ${input.moduleModel}`);
  if (!inv) throw new Error(`SOLAR_INVERTER_NOT_FOUND: ${input.inverterModel}`);
  const warnings: string[] = [];

  const { max: tMax, min: tMin } = cellTemperatures(city, panel.toncC);
  const stc = { voc: panel.vocV, isc: panel.iscA, vmp: panel.vmpV, imp: panel.impA, pmp: panel.pmaxW };
  const hot = { voc: at(panel.vocV, panel.coefV, tMax), isc: at(panel.iscA, panel.coefI, tMax), vmp: at(panel.vmpV, panel.coefV, tMax), imp: at(panel.impA, panel.coefI, tMax), pmp: at(panel.pmaxW, panel.coefP, tMax) };
  const cold = { voc: at(panel.vocV, panel.coefV, tMin), isc: at(panel.iscA, panel.coefI, tMin), vmp: at(panel.vmpV, panel.coefV, tMin), imp: at(panel.impA, panel.coefI, tMin), pmp: at(panel.pmaxW, panel.coefP, tMin) };

  const inverter = { mpptMinV: inv.mpptMinV ?? 0, maxDcInputV: inv.maxDcInputV ?? 0, mpptCount: inv.mpptCount ?? 0, totalStrings: inv.totalStrings ?? 0, pmaxFvW: inv.pmaxFvW, nominalW: inv.nominalW };
  const designMaxV = input.designMaxV && input.designMaxV > 0 ? input.designMaxV : inverter.maxDcInputV;
  const maxModulesByPower = hot.pmp > 0 ? excelInt(inverter.pmaxFvW / hot.pmp) : 0;                 // T8
  const minModulesByVoltage = hot.vmp > 0 ? excelRoundUp(inverter.mpptMinV / hot.vmp) : 0;            // T9
  const maxSeries = Math.min(maxModulesByPower, cold.voc > 0 ? excelInt(designMaxV / cold.voc) : 0); // Z8
  const minSeries = Math.max(minModulesByVoltage, hot.vmp > 0 ? excelRoundUp(inverter.mpptMinV / hot.vmp) : 0); // Z9
  if (inverter.mpptCount === 0) warnings.push("El inversor no tiene MPPT en el catálogo.");
  if (maxSeries < minSeries) warnings.push(`Con este módulo y este inversor no hay un número de módulos en serie válido (mínimo ${minSeries}, máximo ${maxSeries}).`);

  const seriesOptions = inverter.mpptCount >= 1 && maxSeries >= minSeries ? Array.from({ length: maxSeries - minSeries + 1 }, (_, i) => minSeries + i) : [];
  const mppts: MpptCheck[] = [];
  for (let k = 0; k < MAX_MPPT; k += 1) {
    const arr = input.mppts[k] ?? { strings: 0, modules: 0 };
    const exists = k < inverter.mpptCount;
    const maxA = inv.mppt[k]?.maxA ?? 0;
    const maxV = inv.mppt[k]?.maxV ?? null;
    const stringsAllowed = inv.stringsPerMppt[k] ?? 0;
    const parallelMax = exists ? Math.min(stringsAllowed, hot.isc > 0 ? excelInt(maxA / hot.isc) : 0) : 0;
    const parallelOptions = Array.from({ length: Math.min(MAX_PARALLEL_COLUMNS, Math.max(0, parallelMax)) }, (_, i) => i + 1);
    const modulesPerString = arr.strings > 0 ? arr.modules / arr.strings : 0;       // K48
    const refVmpMaxV = maxV ?? excelRound(0.8 * inverter.maxDcInputV, 0);            // Q54: el libro usaba 0.8×Vmax
    const check: MpptCheck = {
      index: k, strings: arr.strings, modules: arr.modules, modulesPerString,
      powerKw: (arr.modules * panel.pmaxW) / 1000,
      impAtSrc: arr.strings * hot.imp, iscAtSrc: arr.strings * hot.isc, maxIsc: arr.strings * hot.isc * 1.25, refMaxA: maxA,
      maxVoc: modulesPerString * cold.voc, refMaxV: designMaxV,
      vmpAtSrc: modulesPerString * stc.vmp, refVmpMaxV,
      vmpAtMin: modulesPerString * hot.vmp, refMinV: inverter.mpptMinV,
      seriesOptions: exists ? seriesOptions : [], parallelOptions, issues: [],
    };
    if (arr.strings > 0 || arr.modules > 0) {
      if (!exists) check.issues.push("El inversor no tiene este MPPT.");
      if (arr.strings === 0 && arr.modules > 0) check.issues.push("Hay módulos sin cadenas: captura cuántas cadenas van en el MPPT.");
      if (arr.strings > 0 && !Number.isInteger(modulesPerString)) check.issues.push("Los módulos no se reparten en cadenas iguales.");
      if (exists && arr.strings > stringsAllowed) check.issues.push(`El MPPT admite ${stringsAllowed} cadena(s) y se capturaron ${arr.strings}.`);
      if (exists && parallelMax === 0 && arr.strings > 0) check.issues.push(`La corriente del módulo a temperatura máxima (${hot.isc.toFixed(2)} A) supera la del MPPT (${maxA} A).`);
      if (check.impAtSrc > maxA && maxA > 0) check.issues.push("La corriente de las cadenas supera la del MPPT.");
      if (modulesPerString > 0 && check.maxVoc > designMaxV) check.issues.push("La tensión en frío supera la tensión máxima de diseño.");
      if (modulesPerString > 0 && check.vmpAtMin < inverter.mpptMinV) check.issues.push("La tensión en caliente queda por debajo de la mínima del MPPT.");
      if (modulesPerString > 0 && check.vmpAtSrc > refVmpMaxV) check.issues.push("La tensión de operación supera la máxima del MPPT.");
      if (modulesPerString > 0 && (modulesPerString < minSeries || modulesPerString > maxSeries)) check.issues.push(`Módulos en serie fuera del rango permitido (${minSeries} a ${maxSeries}).`);
    }
    mppts.push(check);
  }

  const totalModules = mppts.reduce((a, m) => a + m.modules, 0);          // AK8
  const pvKw = (totalModules * panel.pmaxW) / 1000;                        // AK9
  const dcAcRatio = inverter.nominalW > 0 ? (pvKw * 1000) / inverter.nominalW : 0; // AF9
  const placementDelta = totalModules - input.modulesToInstall;            // F10
  if (placementDelta < 0) warnings.push(`Falta por acomodar ${Math.abs(placementDelta)} módulos ${panel.model}.`);
  if (placementDelta > 0) warnings.push(`Se acomodaron ${placementDelta} módulos de más respecto a los ${input.modulesToInstall} a instalar.`);
  const totalStringsUsed = mppts.reduce((a, m) => a + m.strings, 0);
  if (inverter.totalStrings > 0 && totalStringsUsed > inverter.totalStrings) warnings.push(`El inversor admite ${inverter.totalStrings} cadenas en total y se capturaron ${totalStringsUsed}.`);

  return { cellTempMaxC: tMax, cellTempMinC: tMin, stc, hot, cold, inverter, maxModulesByPower, minModulesByVoltage, maxSeries, minSeries, designMaxV, totalModules, pvKw, dcAcRatio, placementDelta, mppts, warnings };
}
