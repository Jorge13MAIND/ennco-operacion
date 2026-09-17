import { describe, expect, it } from "vitest";

import { computeArray } from "@/lib/solar/engineering/array";
import { computePowerFactor, defaultPowerFactorInput } from "@/lib/solar/engineering/power-factor";
import { computeShading, declinationFor, shadowAt, shadowDay, sunAt } from "@/lib/solar/engineering/shading";
import { workbookCatalog } from "@/lib/solar/workbook";

const catalog = workbookCatalog();

/* Casos del libro v1.0.1 tal como quedaron capturados en cada hoja. */
describe("sombras (Cal_Sombra)", () => {
  const base = { city: "Puebla", moduleModel: "Best Solar - MGL630N-144BM10 (635W)", obstacleHeightM: 0, inclinationDeg: 20, slopedSurface: true, slopeDeg: 2, modulesPerPanel: 2, orientation: "VERTICAL" as const };
  it("reproduce longitud del panel y distancia pie a pie con pendiente", () => {
    const r = computeShading(base, catalog);
    expect(r.latitude).toBe(19);
    expect(r.modulesLengthM).toBeCloseTo(4.764, 9);
    expect(r.panelLengthM).toBeCloseTo(4.8040000000000003, 9);
    expect(r.solarAltitudeDeg).toBeCloseTo(10.145558653600476, 9);
    expect(r.solarAzimuthDeg).toBeCloseTo(60.73697014266839, 9);
    expect(r.rowDistanceFlatM).toBeCloseTo(9.002537058593985, 9);
    expect(r.rowDistanceSlopedM).toBeCloseTo(7.9407002285529042, 9);
    expect(r.rowDistanceM).toBeCloseTo(7.9407002285529042, 9);
    expect(r.collectorCheckM).toBeCloseTo(6.0198748185952331, 9);
    expect(r.obstacleDistanceM).toBe(0);
  });
  it("sin pendiente usa la distancia plana y un obstáculo de 2 m da su distancia", () => {
    const r = computeShading({ ...base, slopedSurface: false, obstacleHeightM: 2 }, catalog);
    expect(r.rowDistanceM).toBeCloseTo(9.002537058593985, 9);
    // H37 = altura × cos(Ψ) / tan(h)
    expect(r.obstacleDistanceM).toBeCloseTo(2 * 0.48881964658994914 / 0.17894762454900073, 9);
  });
  it("horizontal usa el ancho del módulo", () => {
    const r = computeShading({ ...base, orientation: "HORIZONTAL" }, catalog);
    expect(r.modulesLengthM).toBeCloseTo(2 * 1.134, 9);
  });
  it("cero módulos o ventana absurda no revientan", () => {
    expect(computeShading({ ...base, modulesPerPanel: 0 }, catalog).rowDistanceM).toBe(0);
    const r = computeShading({ ...base, hoursWithoutShade: 20 }, catalog);
    expect(Number.isFinite(r.rowDistanceM)).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe("factor de potencia (Cal_Fac_Pot)", () => {
  const r = computePowerFactor(defaultPowerFactorInput());
  it("reproduce los bancos promedio, mínimo y máximo del libro", () => {
    expect(r.averageBankKvar).toBeCloseTo(92.568611422775177, 9);
    expect(r.minBankKvar).toBeCloseTo(66.729795983304342, 9);
    expect(r.maxBankKvar).toBeCloseTo(148.92354713189462, 9);
  });
  it("reproduce enero: factor medido, reactiva y banco con capacitor automático y fijo", () => {
    const e = r.rows[0]!;
    expect(e.pf).toBeCloseTo(0.8709, 12);
    expect(e.autoReactiveKvarh).toBeCloseTo(25392.433748620359, 6);
    expect(e.autoBankKvar).toBeCloseTo(66.815854423998317, 9);
    expect(e.fixedReactiveKvarh).toBeCloseTo(14364.508502968889, 6);
    expect(e.fixedPf).toBeCloseTo(0.9900985418067676, 12);
  });
  it("marca los meses que con banco fijo quedan bajo el normado (septiembre y noviembre)", () => {
    expect(r.rows.filter((x) => x.fixedBelowRequired).map((x) => x.month)).toEqual(["Septiembre", "Noviembre"]);
  });
  it("un mes en cero no produce NaN", () => {
    const i = defaultPowerFactorInput(); i.months[0] = { ...i.months[0]!, activeKwh: 0, reactiveKvarh: 0, demandKw: 0 };
    const x = computePowerFactor(i);
    expect(Number.isFinite(x.averageBankKvar)).toBe(true);
    expect(x.rows[0]!.pf).toBe(0);
  });
});

describe("arreglos en inversor (Cal_Inv_St)", () => {
  const base = { projectName: "TEJAS EL ÁGUILA", city: "León", moduleModel: "Trina - TSM-NE21-710 (710W)", inverterModel: "Growatt (MIC 2000TL-X2)", modulesToInstall: 58, invertersCount: 1, mppts: [{ strings: 0, modules: 0 }] };
  const r = computeArray(base, catalog);
  it("reproduce temperaturas de celda y valores eléctricos a máx y mín", () => {
    expect(r.cellTempMaxC).toBeCloseTo(83.06368055555555, 9);
    expect(r.cellTempMinC).toBeCloseTo(-15.442534722222222, 9);
    expect(r.hot.voc).toBeCloseTo(42.171711166666668, 9);
    expect(r.hot.isc).toBeCloseTo(18.82734868888889, 9);
    expect(r.hot.vmp).toBeCloseTo(35.200469116666667, 9);
    expect(r.hot.imp).toBeCloseTo(17.763194197777779, 9);
    expect(r.hot.pmp).toBeCloseTo(590.4468817361111, 9);
    expect(r.cold.voc).toBeCloseTo(53.756042083333334, 9);
    expect(r.cold.isc).toBeCloseTo(18.102342944444441, 9);
    expect(r.cold.vmp).toBeCloseTo(44.869839208333332, 9);
    expect(r.cold.imp).toBeCloseTo(17.079167038888887, 9);
    expect(r.cold.pmp).toBeCloseTo(793.27117899305551, 9);
  });
  it("reproduce los límites del sistema", () => {
    expect(r.maxModulesByPower).toBe(4);
    expect(r.minModulesByVoltage).toBe(2);
    expect(r.maxSeries).toBe(4);
    expect(r.minSeries).toBe(2);
    expect(r.designMaxV).toBe(500);
    expect(r.mppts[0]!.refMaxA).toBe(16);
    expect(r.mppts[0]!.seriesOptions).toEqual([2, 3, 4]);
    // El libro muestra la tabla en ceros: la Isc en caliente (18.83 A) supera los 16 A del MPPT.
    expect(r.mppts[0]!.parallelOptions).toEqual([]);
    expect(r.placementDelta).toBe(-58);
    expect(r.warnings).toContain("Falta por acomodar 58 módulos Trina - TSM-NE21-710 (710W).");
  });
  it("con una cadena de 4 módulos reproduce la tensión en frío de la hoja DC y avisa de la corriente", () => {
    const x = computeArray({ ...base, mppts: [{ strings: 1, modules: 4 }] }, catalog);
    const m = x.mppts[0]!;
    expect(m.modulesPerString).toBe(4);
    expect(m.maxVoc).toBeCloseTo(215.024168, 5);
    expect(m.vmpAtMin).toBeCloseTo(4 * 35.200469116666667, 9);
    expect(m.impAtSrc).toBeCloseTo(17.763194197777779, 9);
    expect(m.issues.some((s) => s.includes("supera la del MPPT"))).toBe(true);
    expect(x.totalModules).toBe(4);
    expect(x.pvKw).toBeCloseTo(2.84, 9);
    expect(x.dcAcRatio).toBeCloseTo(1.42, 9);
  });
  it("un inversor grande de 10 MPPT arma la tabla completa", () => {
    const x = computeArray({ ...base, inverterModel: "Growatt (Growatt MAX 124KTL3-X2 MV)", modulesToInstall: 100, mppts: Array.from({ length: 10 }, () => ({ strings: 2, modules: 20 })) }, catalog);
    expect(x.inverter.mpptCount).toBe(10);
    expect(x.mppts.every((m) => m.seriesOptions.length > 0)).toBe(true);
    expect(x.mppts[0]!.parallelOptions).toEqual([1, 2]);
    expect(x.mppts[0]!.issues).toEqual([]);
    expect(x.totalModules).toBe(200);
  });
  it("módulos que no se reparten en cadenas iguales o sin cadenas se marcan", () => {
    const x = computeArray({ ...base, mppts: [{ strings: 2, modules: 7 }] }, catalog);
    expect(x.mppts[0]!.issues.some((s) => s.includes("cadenas iguales"))).toBe(true);
    const y = computeArray({ ...base, mppts: [{ strings: 0, modules: 4 }] }, catalog);
    expect(y.mppts[0]!.issues.some((s) => s.includes("sin cadenas"))).toBe(true);
  });
  it("módulo o inversor desconocidos lanzan un error con nombre", () => {
    expect(() => computeArray({ ...base, moduleModel: "nada" }, catalog)).toThrow(/SOLAR_MODULE_NOT_FOUND/);
    expect(() => computeArray({ ...base, inverterModel: "nada" }, catalog)).toThrow(/SOLAR_INVERTER_NOT_FOUND/);
  });
});

describe("simulación de sombra hora por hora", () => {
  const sc = { latitude: 19, panelLengthM: 4.804, inclinationDeg: 20, slopeDeg: 0, obstacleHeightM: 0 };
  it("a 4.625 h del mediodía reproduce la altura y el azimut del libro (Puebla, 19°)", () => {
    const s = sunAt(19, 12 - 4.625);
    expect(s.altitudeDeg).toBeCloseTo(10.145558653600476, 9);
    expect(Math.abs(s.azimuthDeg)).toBeCloseTo(60.73697014266839, 9);
  });
  it("a esa hora la distancia necesaria es la del libro (9.0025 m plana, 7.9407 m con pendiente 2°)", () => {
    expect(shadowAt(sc, 12 - 4.625).requiredDistanceM).toBeCloseTo(9.002537058593985, 9);
    expect(shadowAt({ ...sc, slopeDeg: 2 }, 12 - 4.625).requiredDistanceM).toBeCloseTo(7.9407002285529042, 9);
  });
  it("al mediodía la sombra es la más corta; de noche es infinita; el equinoccio pide menos distancia que el invierno", () => {
    expect(shadowAt(sc, 12).rowShadowM).toBeLessThan(shadowAt(sc, 8).rowShadowM);
    expect(shadowAt(sc, 21).up).toBe(false);
    expect(shadowAt({ ...sc, declinationDeg: declinationFor(80) }, 9).requiredDistanceM).toBeLessThan(shadowAt(sc, 9).requiredDistanceM);
    expect(declinationFor(355)).toBeCloseTo(-23.45, 0.5);
  });
  it("con la distancia mínima del libro la ventana libre dura 9.25 h centradas al mediodía", () => {
    const d = shadowDay(sc, 9.002537058593985, 0, 5);
    expect(d.rows!.from).toBeCloseTo(12 - 4.625, 1); expect(d.rows!.to).toBeCloseTo(12 + 4.625, 1);
    expect(shadowDay(sc, 6, 0, 5).rows).toBeNull(); // con 6 m ni al mediodía alcanza (hacen falta 6.01 m)
    expect(shadowDay(sc, 6.5, 0, 5).rows!.to - shadowDay(sc, 6.5, 0, 5).rows!.from).toBeLessThan(9);
  });
  it("un obstáculo de 3 m a 5 m de la primera fila la sombrea temprano y la libera después", () => {
    const d = shadowDay({ ...sc, obstacleHeightM: 3 }, 9.1, 5, 5);
    expect(d.obstacle).not.toBeNull(); expect(d.obstacle!.from).toBeGreaterThan(d.rows!.from);
    expect(d.clear!.from).toBe(d.obstacle!.from);
    expect(shadowAt({ ...sc, obstacleHeightM: 3 }, 12 - 4.625).obstacleShadowM).toBeCloseTo(3 * 0.48881964658994914 / 0.17894762454900073, 9);
  });
  it("paneles girados al oeste: por la mañana el sol les pega de lado (menos sombra útil) y por la tarde de frente (más)", () => {
    const west = { ...sc, panelAzimuthDeg: 30 };
    expect(shadowAt(west, 9).rowShadowM).toBeLessThan(shadowAt(sc, 9).rowShadowM);
    expect(shadowAt(west, 15).rowShadowM).toBeGreaterThan(shadowAt(sc, 15).rowShadowM);
  });
});
