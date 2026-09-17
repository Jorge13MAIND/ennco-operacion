import { describe, expect, it } from "vitest";

import { computeAcCircuit } from "@/lib/solar/engineering/ac-circuit";
import { computeArray } from "@/lib/solar/engineering/array";
import { computeDcCircuit } from "@/lib/solar/engineering/dc-circuit";
import { computePanelBoard } from "@/lib/solar/engineering/panel-board";
import { computeShading } from "@/lib/solar/engineering/shading";
import { workbookCatalog } from "@/lib/solar/workbook";

const catalog = workbookCatalog();
const finite = (o: unknown): string[] => {
  const bad: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (typeof v === "number") { if (!Number.isFinite(v)) bad.push(path); return; }
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => walk(x, `${path}.${k}`));
  };
  walk(o, "$"); return bad;
};

/* Todo módulo × todo inversor × varias ciudades: ningún motor debe lanzar ni producir NaN o infinito. */
describe("barrido del catálogo completo", () => {
  const cities = ["Puebla", "León", "Mexicali", "Cancún", "Toluca"].filter((c) => catalog.cities.some((x) => x.city === c));
  it("arreglos, DC, AC y tableros son finitos para todas las combinaciones", () => {
    let combos = 0;
    for (const m of catalog.modules) for (const inv of catalog.inverters) for (const city of cities) {
      const a = computeArray({ projectName: "x", city, moduleModel: m.model, inverterModel: inv.model, modulesToInstall: 10, invertersCount: 1, mppts: [{ strings: 1, modules: 4 }, { strings: 2, modules: 10 }] }, catalog);
      expect(finite(a), `${m.model} / ${inv.model} / ${city}`).toEqual([]);
      const ac = computeAcCircuit({ projectName: "x", city, inverterModel: inv.model, invertersCount: 1, gridV: null, material: "Cobre", installation: "Tubería", ambientC: 35, conductorsPerRaceway: 3, insulation: "THHW-LS", tempRating: 75, onRooftop: true, roofSeparationMm: 20, selectedMm2: null, lengthM: 25 }, catalog);
      expect(finite(ac), `AC ${inv.model}`).toEqual([]);
      const dc = computeDcCircuit({ modulesInSeries: Math.max(a.minSeries, 1), strings: 2, iscStcA: a.stc.isc, impStcA: a.stc.imp, vocColdV: a.cold.voc, vmpHotV: a.hot.vmp, inverterMaxV: a.inverter.maxDcInputV, installation: "Tubería", awg: 10, circuitsInRaceway: 2, insulationC: 90, ambientC: 35, onRooftop: true, roofSeparationMm: 20, lengthM: 25, combinedStrings: false, moduleMaxFuseA: null });
      expect(finite(dc), `DC ${m.model}`).toEqual([]);
      const tb = computePanelBoard({ config: ac.config, lineToLineV: ac.lineToLineV, inverterModel: inv.model, invertersCount: 1, inverterOutputA: ac.maxOutputA, feederMm2: ac.selected?.mm2 ?? null, feederAwg: ac.selected?.awg ?? null, feederCorrectedA: ac.selected?.correctedA ?? null, acDropFraction: ac.voltageDropFraction, dcDropFraction: dc.voltageDropFraction, dcStringCurrentA: dc.circuitMaxA, dcMinimumAwg: dc.minimumAwg, dcFuseA: dc.fuseA, arrayInverterModel: inv.model, busbarA: 250, mainBreakerA: 200, interconnection: "Barras" });
      expect(finite(tb)).toEqual([]);
      combos += 1;
    }
    expect(combos).toBe(catalog.modules.length * catalog.inverters.length * cities.length);
  });
  it("sombras es finita para todo módulo y toda ciudad, plana y con pendiente", () => {
    for (const m of catalog.modules) for (const c of catalog.cities) for (const sloped of [false, true]) {
      const r = computeShading({ city: c.city, moduleModel: m.model, obstacleHeightM: 1.5, inclinationDeg: 15, slopedSurface: sloped, slopeDeg: 5, modulesPerPanel: 2, orientation: "VERTICAL" }, catalog);
      expect(finite(r), `${m.model} / ${c.city}`).toEqual([]);
      expect(r.rowDistanceM).toBeGreaterThan(0);
    }
  });
  it("entradas extremas no revientan: cero cadenas, cero módulos, temperaturas absurdas, longitudes cero", () => {
    const m = catalog.modules[0]!, inv = catalog.inverters[0]!;
    const a = computeArray({ projectName: "", city: "Puebla", moduleModel: m.model, inverterModel: inv.model, modulesToInstall: 0, invertersCount: 0, designMaxV: 0, mppts: [] }, catalog);
    expect(finite(a)).toEqual([]);
    const ac = computeAcCircuit({ projectName: "", city: "Puebla", inverterModel: inv.model, invertersCount: 0, gridV: 0, material: "Aluminio", installation: "Aire libre", ambientC: 95, conductorsPerRaceway: 0, insulation: "", tempRating: 60, onRooftop: true, roofSeparationMm: 0, selectedMm2: 1, lengthM: 0 }, catalog);
    expect(finite(ac)).toEqual([]);
    expect(ac.warnings.length).toBeGreaterThan(0);
    const dc = computeDcCircuit({ modulesInSeries: 0, strings: 0, iscStcA: 0, impStcA: 0, vocColdV: 0, vmpHotV: 0, inverterMaxV: 0, installation: "Tubería", awg: 14, circuitsInRaceway: 0, insulationC: 90, ambientC: -10, onRooftop: false, roofSeparationMm: 0, lengthM: 0, combinedStrings: true, moduleMaxFuseA: 0 });
    expect(finite(dc)).toEqual([]);
  });
});
