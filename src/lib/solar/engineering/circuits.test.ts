import { describe, expect, it } from "vitest";

import { computeAcCircuit, type AcCircuitInput } from "@/lib/solar/engineering/ac-circuit";
import { computeDcCircuit, type DcCircuitInput } from "@/lib/solar/engineering/dc-circuit";
import { computePanelBoard } from "@/lib/solar/engineering/panel-board";
import { workbookCatalog } from "@/lib/solar/workbook";

const catalog = workbookCatalog();

/* Caso capturado en el libro (TEJAS EL ÁGUILA, Puebla) tal como se ve en las hojas AC, DC y Tableros. */
const AC: AcCircuitInput = {
  projectName: "TEJAS EL ÁGUILA", city: "Puebla", inverterModel: "Growatt (Growatt MAX 124KTL3-X2 MV)", invertersCount: 1, gridV: 440,
  material: "Cobre", installation: "Tubería", ambientC: 30, conductorsPerRaceway: 3, insulation: "THHW-LS", tempRating: 75,
  onRooftop: false, roofSeparationMm: 40, selectedMm2: null, lengthM: 30,
};

describe("corriente alterna (Cal_Cir_Ele_AC)", () => {
  const r = computeAcCircuit(AC, catalog);
  it("reproduce la salida del inversor y las correcciones", () => {
    expect(r.config).toBe("3F - 4H @ 50/60Hz");
    expect(r.lineToLineV).toBe(440);
    expect(r.lineToNeutralV).toBeCloseTo(254.03411844343535, 9);
    expect(r.maxOutputA).toBeCloseTo(164.1, 9);
    expect(r.maxOutputW).toBe(148800);
    expect(r.tempFactor).toBe(1);
    expect(r.groupingFactor).toBe(1);
    expect(r.maxCurrentA).toBeCloseTo(164.1, 9);
    expect(r.compensatedA).toBeCloseTo(205.125, 9);
    expect(r.conductorsPerPhase).toBe(1);
  });
  it("elige 4/0 AWG a 230 A, ITM de 225 A y tierra 4 AWG", () => {
    expect(r.recommended).toEqual({ mm2: 107, awg: "4/0 AWG", correctedA: 230 });
    expect(r.selected?.mm2).toBe(107);
    expect(r.breakerA).toBe(225);
    expect(r.egcMaxA).toBe(300);
    expect(r.egc).toEqual({ mm2: 21.2, awg: "4 AWG" });
  });
  it("reproduce la caída de tensión y la tensión final", () => {
    expect(r.impedanceOhmKm).toBeCloseTo(0.262, 12);
    expect(r.voltageDropFraction).toBeCloseTo(5.0773731020984873e-3, 12);
    expect(r.finalV).toBeCloseTo(437.77724160874487, 9);
    expect(r.warnings).toEqual([]);
  });
  it("aluminio al aire a 40 °C cambia tabla, factor y tierra", () => {
    const x = computeAcCircuit({ ...AC, material: "Aluminio", installation: "Aire libre", ambientC: 40 }, catalog);
    expect(x.tempFactor).toBe(0.88);
    // Al 75 °C al aire, ×0.88: 2/0 = 184.8 no alcanza; 3/0 = 211.2 ≥ 205.125.
    expect(x.recommended?.awg).toBe("3/0 AWG");
    expect(x.egc?.awg).toBe("2 AWG");
    expect(x.impedanceOhmKm).toBeCloseTo(0.46, 12); // Al 3/0
  });
  it("sobre techumbre con 40 mm suma 22 °C y aplica el factor de 52 °C", () => {
    const x = computeAcCircuit({ ...AC, onRooftop: true, roofSeparationMm: 40 }, catalog);
    expect(x.designTempC).toBe(52);
    expect(x.tempFactor).toBe(0.67);
  });
  it("temperatura fuera de tabla para el aislamiento marca la instalación como no viable", () => {
    const x = computeAcCircuit({ ...AC, tempRating: 60, ambientC: 60 }, catalog);
    expect(x.tempFactor).toBe(0);
    expect(x.warnings.some((w) => w.includes("No es viable"))).toBe(true);
    expect(x.recommended).toBeNull();
  });
  it("un calibre elegido menor que el recomendado avisa", () => {
    const x = computeAcCircuit({ ...AC, selectedMm2: 53.5 }, catalog);
    expect(x.selected?.awg).toBe("1/0 AWG");
    expect(x.warnings.some((w) => w.includes("inferior a la corriente"))).toBe(true);
  });
  it("muchos inversores en paralelo reparten en varios conductores por fase", () => {
    const x = computeAcCircuit({ ...AC, invertersCount: 6 }, catalog);
    expect(x.compensatedA).toBeCloseTo(1230.75, 9);
    expect(x.conductorsPerPhase).toBe(2);
    expect(x.recommended).not.toBeNull();
  });
});

const DC: DcCircuitInput = {
  modulesInSeries: 4, strings: 1, iscStcA: 18.4, impStcA: 17.36, vocColdV: 53.756042083333334, vmpHotV: 35.200469116666667, inverterMaxV: 500,
  installation: "Tubería", awg: 10, circuitsInRaceway: 1, insulationC: 90, ambientC: 30, onRooftop: false, roofSeparationMm: 40, lengthM: 20, combinedStrings: false, moduleMaxFuseA: null,
};

describe("corriente directa (Cal_Cir_Ele_DC)", () => {
  const r = computeDcCircuit(DC);
  it("reproduce corrientes, ampacidad y calibre mínimo", () => {
    expect(r.stringMaxA).toBeCloseTo(23, 12);
    expect(r.circuitMaxA).toBeCloseTo(23, 12);
    expect(r.fuseCurrentA).toBeCloseTo(28.75, 12);
    expect(r.designTempC).toBe(30);
    expect(r.tempFactor).toBe(1);
    expect(r.groupingFactor).toBe(1);
    expect(r.baseAmpacityA).toBe(40);
    expect(r.correctedAmpacityA).toBe(40);
    expect(r.complies).toBe(true);
    expect(r.requiredBaseA).toBeCloseTo(28.75, 12);
    expect(r.minimumAwg).toBe(10);
  });
  it("reproduce fusible, tensión máxima, caída y tubería", () => {
    expect(r.fuseA).toBe(30);
    expect(r.fuseRequired).toBe(false);
    expect(r.fuseCheck).toBe("unknown");
    expect(r.arrayMaxV).toBeCloseTo(215.024168, 6);
    expect(r.voltageOk).toBe(true);
    expect(r.resistanceOhmKm90).toBeCloseTo(4.1770248, 7);
    expect(r.operatingA).toBeCloseTo(17.36, 12);
    expect(r.voltageDropV).toBeCloseTo(2.90052602, 7);
    expect(r.voltageDropFraction).toBeCloseTo(0.02060005, 7);
    expect(r.dropOk).toBe(true);
    expect(r.cableAreaMm2).toBeCloseTo(79.1838428, 6);
    expect(r.conduit).toBe('3/4"');
  });
  it("al aire libre no hay tubería y sube la ampacidad base", () => {
    const x = computeDcCircuit({ ...DC, installation: "Aire libre" });
    expect(x.baseAmpacityA).toBe(55);
    expect(x.cableAreaMm2).toBe(0);
    expect(x.conduit).toBeNull();
  });
  it("tres cadenas requieren fusible y el máximo del módulo se valida", () => {
    const x = computeDcCircuit({ ...DC, strings: 3, moduleMaxFuseA: 25 });
    expect(x.fuseRequired).toBe(true);
    expect(x.fuseCheck).toBe("exceeds");
    const y = computeDcCircuit({ ...DC, strings: 3, moduleMaxFuseA: 30 });
    expect(y.fuseCheck).toBe("ok");
  });
  it("cadenas combinadas multiplican la corriente del circuito y pueden dejar sin calibre PV", () => {
    const x = computeDcCircuit({ ...DC, strings: 4, combinedStrings: true });
    expect(x.circuitMaxA).toBeCloseTo(92, 12);
    expect(x.minimumAwg).toBeNull();
    expect(x.warnings.some((w) => w.includes("Ningún cable PV"))).toBe(true);
  });
  it("una trayectoria larga con 14 AWG dispara la caída de tensión", () => {
    const x = computeDcCircuit({ ...DC, awg: 14, lengthM: 60 });
    expect(x.dropOk).toBe(false);
    expect(x.warnings.some((w) => w.includes("caída de tensión"))).toBe(true);
  });
  it("muchos módulos en serie superan la tensión del inversor", () => {
    const x = computeDcCircuit({ ...DC, modulesInSeries: 12 });
    expect(x.voltageOk).toBe(false);
  });
});

describe("tableros (Cal_Cir_Ele_Tab)", () => {
  const ac = computeAcCircuit(AC, catalog);
  const dc = computeDcCircuit(DC);
  const r = computePanelBoard({
    config: ac.config, lineToLineV: ac.lineToLineV, inverterModel: AC.inverterModel, invertersCount: 1, inverterOutputA: ac.maxOutputA,
    feederMm2: ac.selected?.mm2 ?? null, feederAwg: ac.selected?.awg ?? null, feederCorrectedA: ac.selected?.correctedA ?? null, acDropFraction: ac.voltageDropFraction,
    dcDropFraction: dc.voltageDropFraction, dcStringCurrentA: dc.circuitMaxA, dcMinimumAwg: dc.minimumAwg, dcFuseA: dc.fuseA,
    arrayInverterModel: "Growatt (MIC 2000TL-X2)", busbarA: 250, mainBreakerA: 200, interconnection: "Barras",
  });
  it("reproduce la hoja: 205.125 A, ITM 225, no cumple 120 %, tierras 4 y 2 AWG, caída 2.57 %", () => {
    expect(r.totalPvA).toBeCloseTo(164.1, 9);
    expect(r.designA).toBeCloseTo(205.125, 9);
    expect(r.pvBreakerA).toBe(225);
    expect(r.busbarRule).toBe("fail");
    expect(r.egc).toEqual({ mm2: 21.2, awg: "4 AWG" });
    expect(r.gec).toBe("2 AWG");
    expect(r.totalDropFraction).toBeCloseTo(0.02567743, 7);
    expect(r.dropOk).toBe(true);
    expect(r.sameInverter).toBe(false);
    expect(r.summary.map((s) => s.conductor)).toEqual(["PV 10 AWG", "4/0 AWG", "4/0 AWG"]);
  });
  it("con un tablero de 400 A de barras la regla cumple, y en lado de línea no aplica", () => {
    const ok = computePanelBoard({ config: "", lineToLineV: 440, inverterModel: "x", invertersCount: 1, inverterOutputA: 164.1, feederMm2: 107, feederAwg: "4/0 AWG", feederCorrectedA: 230, acDropFraction: 0, dcDropFraction: 0, dcStringCurrentA: 23, dcMinimumAwg: 10, dcFuseA: 30, arrayInverterModel: "x", busbarA: 400, mainBreakerA: 200, interconnection: "Barras" });
    expect(ok.busbarRule).toBe("ok");
    const na = computePanelBoard({ config: "", lineToLineV: 440, inverterModel: "x", invertersCount: 1, inverterOutputA: 164.1, feederMm2: 107, feederAwg: "4/0 AWG", feederCorrectedA: 230, acDropFraction: 0, dcDropFraction: 0, dcStringCurrentA: 23, dcMinimumAwg: 10, dcFuseA: 30, arrayInverterModel: "x", busbarA: 250, mainBreakerA: 200, interconnection: "Lado de línea" });
    expect(na.busbarRule).toBe("na");
  });
});
