import { describe, expect, it } from "vitest";

import { importPriceWorkbook } from "@/lib/precios/import";
import { fxFor, latestBySupplier, priceItem } from "@/lib/precios/pricing";
import type { PriceCatalog } from "@/lib/precios/types";
import { readXlsx, writeXlsx } from "@/lib/precios/xlsx";

const sup = (id: string, name: string) => ({ id, name, active: true });
const catalog: PriceCatalog = {
  suppliers: [sup("a", "Exel"), sup("b", "Solar Center"), sup("c", "DM Solar")],
  items: [
    { id: "i1", category: "Inversores", name: "Growatt MIN 5000TL-X2", unit: "Pzs", currency: "USD", equipment: { kind: "inverter", model: "MIN 5000TL-X2" }, sort: 1, active: true, notes: null },
    { id: "i2", category: "Cableado", name: "Cable THW Negro Cal. 10", unit: "Mts", currency: "MXN", equipment: null, sort: 1, active: true, notes: null },
  ],
  quotes: [
    { itemId: "i1", supplierId: "a", period: "2026-07-01", unitPrice: 359 }, { itemId: "i1", supplierId: "b", period: "2026-07-01", unitPrice: 393.24 },
    { itemId: "i1", supplierId: "c", period: "2026-07-01", unitPrice: 373 }, { itemId: "i1", supplierId: "a", period: "2026-08-01", unitPrice: 359.88 },
    { itemId: "i1", supplierId: "b", period: "2026-08-01", unitPrice: 339 }, { itemId: "i1", supplierId: "c", period: "2026-08-01", unitPrice: 373 },
    { itemId: "i2", supplierId: "a", period: "2026-06-01", unitPrice: 18.78 },
  ],
  settings: { iva: 0.16, margin: 0.3, marginByCategory: {}, fxByPeriod: { "2026-07-01": 17.3168, "2026-08-01": 17.3823 }, priceRule: "MAX" },
};

describe("reglas de precio del Excel", () => {
  it("el precio vigente por proveedor es su cotización más reciente y el costo es el máximo (agosto: 373 de DM Solar)", () => {
    const p = priceItem(catalog, catalog.items[0]!);
    expect(p.bySupplier.map((x) => [x.supplier.name, x.unitPrice])).toEqual([["DM Solar", 373], ["Exel", 359.88], ["Solar Center", 339]]);
    expect(p.cost).toBe(373); expect(p.costSupplier?.name).toBe("DM Solar"); expect(p.costPeriod).toBe("2026-08-01");
  });
  it("$ FINAL = máximo × 1.16 × 1.30, igual que la hoja PRECIOS INV (agosto MIN 5000: 373 → 562.484)", () => {
    expect(priceItem(catalog, catalog.items[0]!).finalPrice).toBeCloseTo(562.484, 9);
  });
  it("convierte a pesos con el tipo de cambio del periodo del costo", () => {
    const p = priceItem(catalog, catalog.items[0]!);
    expect(p.fx).toBe(17.3823); expect(p.costMxn).toBeCloseTo(373 * 17.3823, 6);
    const m = priceItem(catalog, catalog.items[1]!); expect(m.costMxn).toBe(18.78); expect(m.fx).toBeNull();
  });
  it("hasta julio el máximo era Solar Center a 393.24 (en la hoja gana Mayorista Solar a 422.24, que este catálogo de prueba no incluye)", () => {
    const p = priceItem(catalog, catalog.items[0]!, "2026-07-31");
    expect(p.cost).toBe(393.24); expect(p.finalPrice).toBeCloseTo(393.24 * 1.16 * 1.3, 9);
  });
  it("regla mínimo y margen por categoría", () => {
    const c: PriceCatalog = { ...catalog, settings: { ...catalog.settings, priceRule: "MIN", marginByCategory: { Inversores: 0.2 } } };
    const p = priceItem(c, c.items[0]!);
    expect(p.cost).toBe(339); expect(p.finalPrice).toBeCloseTo(339 * 1.16 * 1.2, 9);
  });
  it("un material sin cotizaciones no da precio ni revienta; proveedor inactivo no cuenta", () => {
    const c: PriceCatalog = { ...catalog, suppliers: [sup("a", "Exel"), { id: "b", name: "Solar Center", active: false }, sup("c", "DM Solar")] };
    expect(latestBySupplier(c.quotes, c.suppliers, "i1").map((x) => x.supplier.name)).toEqual(["DM Solar", "Exel"]);
    expect(priceItem(catalog, { ...catalog.items[1]!, id: "nada" }).cost).toBeNull();
    expect(fxFor({ ...catalog.settings, fxByPeriod: {} }, "2026-08-01")).toBeNull();
  });
});

describe("xlsx propio: ida y vuelta", () => {
  it("escribe y vuelve a leer texto, números y acentos", () => {
    const buf = writeXlsx([{ name: "Hoja", rows: [["Equipos", "Unidad", 12.5, null, "Ñandú & <x>"], ["Cable", "Mts", 7]] }]);
    const [s] = readXlsx(buf);
    expect(s!.name).toBe("Hoja");
    expect(s!.rows.get(1)!.get("E")).toBe("Ñandú & <x>"); expect(s!.rows.get(1)!.get("C")).toBe(12.5); expect(s!.rows.get(2)!.get("B")).toBe("Mts");
  });
});

describe("importación del formato de Paco", () => {
  const book = writeXlsx([
    { name: "LISTA PROYECTOS", rows: [
      [null, null, "ABRIL", null, "MAYO"],
      ["Equipos", "Unidad", "Precio Uni.", "Proveedor", "Precio Uni.", "Proveedor"],
      ["Equipos FV", null, "DOLAR", 17.4346, "DOLAR", 17.3168],
      ["Inversor Growatt 20kW", "Pzs", null, null, 1628, "Nos mueve el Sol"],
      ["Cableado"],
      ["Cable THW Negro Cal. 10", "Mts", 17.26, "Ascencio", 18.78, "Ascencio"],
      ["Cable Solar Viakon", "Mts", null, null, 1.19, "Exel"],
    ] },
    { name: "PRECIOS INV", rows: [
      ["INVERSORES", "JUNIO/JULIO", null, null, null, "AGOSTO"],
      [null, "PROVEEDORES", null, "MAX", "$ FINAL", "PROVEEDORES", null, "MAX", "$ FINAL"],
      [null, "EXEL", "SOLAR CENTER", null, null, "EXEL", "SOLAR CENTER"],
      ["Growatt"],
      ["MIN 5000TL-X2", 359, 393.24, 393.24, 636.73, 359.88, 339, 359.88, 541],
    ] },
  ]);
  const p = importPriceWorkbook(book, 2026);
  it("separa categorías, materiales, proveedores, monedas y tipo de cambio", () => {
    expect(p.fxByPeriod).toEqual({ "2026-04-01": 17.4346, "2026-05-01": 17.3168 });
    const cable = p.items.find((i) => i.name === "Cable THW Negro Cal. 10")!;
    expect(cable.category).toBe("Cableado"); expect(cable.unit).toBe("Mts"); expect(cable.currency).toBe("MXN");
    expect(cable.quotes).toEqual([{ supplier: "Grupo Ascencio", period: "2026-04-01", unitPrice: 17.26 }, { supplier: "Grupo Ascencio", period: "2026-05-01", unitPrice: 18.78 }]); // "Ascencio" es alias de Grupo Ascencio
    expect(p.items.find((i) => i.name === "Inversor Growatt 20kW")!.currency).toBe("USD");
    expect(p.items.find((i) => i.name === "Cable Solar Viakon")!.currency).toBe("USD");
  });
  it("lee la comparativa de inversores con marca, proveedor por columna y periodo por bloque, sin MAX ni $ FINAL", () => {
    const inv = p.items.find((i) => i.equipment?.kind === "inverter")!;
    expect(inv.name).toBe("Growatt MIN 5000TL-X2"); expect(inv.category).toBe("Inversores");
    expect(inv.quotes).toEqual([
      { supplier: "Exel", period: "2026-07-01", unitPrice: 359 }, { supplier: "Solar Center", period: "2026-07-01", unitPrice: 393.24 },
      { supplier: "Exel", period: "2026-08-01", unitPrice: 359.88 }, { supplier: "Solar Center", period: "2026-08-01", unitPrice: 339 },
    ]);
    expect(p.suppliers).toEqual(["Exel", "Grupo Ascencio", "Nos mueve el Sol", "Solar Center"]);
  });
});
