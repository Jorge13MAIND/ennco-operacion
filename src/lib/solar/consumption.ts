/* Calculadora de consumo de energía (hoja Cal_Consumo del libro).
   Sirve para casas en construcción, donde todavía no hay recibo de CFE: se estima el
   consumo sumando aire acondicionado, electrodomésticos e iluminación. Las fórmulas son
   las del libro, celda por celda, y el resultado se puede llevar a una cotización
   residencial como los 12 periodos del historial (lo que hacía Exportar_Consumo_Res). */

export type AcRow = {
  location: string; kind: string; quantity: number;
  /** BTU del equipo (1 tonelada = 12,000 BTU). */
  btu: number;
  /** Seasonal Energy Efficiency Ratio. */
  seer: number;
  hoursPerWeek: number;
  /** Meses de uso al año, para enfriamiento o calefacción. */
  monthsOfUse: number;
};
export type ApplianceRow = { location: string; kind: string; quantity: number; hoursPerWeek: number; kw: number };
export type LightingRow = { location: string; kind: string; quantity: number; hoursPerWeek: number; watts: number };

export type ConsumptionInput = { ac: AcRow[]; appliances: ApplianceRow[]; lighting: LightingRow[] };

export type AcComputed = { hoursPerDay: number; kwhDay: number; kwhMonth: number };
export type ConsumptionResult = {
  ac: AcComputed[]; acMonthlyTotal: number;
  appliances: number[]; applianceDailyTotal: number;
  lighting: number[]; lightingDailyTotal: number;
  dailyTotal: number; monthlyTotal: number;
};

const safe = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function computeConsumption(input: ConsumptionInput): ConsumptionResult {
  // J9 =H9/7 · K9 =E9*F9/G9/1000*J9 · L9 =K9*30*I9/12
  const ac = input.ac.map((r) => {
    const hoursPerDay = safe(r.hoursPerWeek) / 7;
    const seer = safe(r.seer);
    const kwhDay = seer === 0 ? 0 : (safe(r.quantity) * safe(r.btu)) / seer / 1000 * hoursPerDay;
    return { hoursPerDay, kwhDay, kwhMonth: (kwhDay * 30 * safe(r.monthsOfUse)) / 12 };
  });
  const acMonthlyTotal = ac.reduce((a, r) => a + r.kwhMonth, 0);

  // H25 =E25*G25*F25/7
  const appliances = input.appliances.map((r) => (safe(r.quantity) * safe(r.kw) * safe(r.hoursPerWeek)) / 7);
  const applianceDailyTotal = appliances.reduce((a, v) => a + v, 0);

  // H50 =E50*F50/7*G50/1000
  const lighting = input.lighting.map((r) => ((safe(r.quantity) * safe(r.hoursPerWeek)) / 7 * safe(r.watts)) / 1000);
  const lightingDailyTotal = lighting.reduce((a, v) => a + v, 0);

  // D64 =L16/30+H44+H62 · D65 =D64*30
  const dailyTotal = acMonthlyTotal / 30 + applianceDailyTotal + lightingDailyTotal;
  return { ac, acMonthlyTotal, appliances, applianceDailyTotal, lighting, lightingDailyTotal, dailyTotal, monthlyTotal: dailyTotal * 30 };
}

/** Captura con la que viene la hoja del libro: una casa tipo que el operador ajusta. */
export function defaultConsumptionInput(): ConsumptionInput {
  return {
    ac: [
      { location: "Sala", kind: "Central", quantity: 1, btu: 24000, seer: 13, hoursPerWeek: 14, monthsOfUse: 7 },
      { location: "Recamara Principal", kind: "Central", quantity: 1, btu: 24000, seer: 13, hoursPerWeek: 25, monthsOfUse: 7 },
      { location: "Recamara Niños 1", kind: "Central", quantity: 1, btu: 1800, seer: 13, hoursPerWeek: 25, monthsOfUse: 7 },
      { location: "Recamara Niños 2", kind: "Central", quantity: 1, btu: 1800, seer: 13, hoursPerWeek: 25, monthsOfUse: 7 },
      { location: "Cocina", kind: "Central", quantity: 0, btu: 12000, seer: 13, hoursPerWeek: 14, monthsOfUse: 7 },
      { location: "Comedor", kind: "Central", quantity: 0, btu: 12000, seer: 13, hoursPerWeek: 14, monthsOfUse: 8 },
      { location: "Recamara Servicio", kind: "Central", quantity: 0, btu: 12000, seer: 13, hoursPerWeek: 50, monthsOfUse: 8 },
    ],
    appliances: [
      { location: "Cocina", kind: "Refrigerador", quantity: 1, hoursPerWeek: 6, kw: 1 },
      { location: "Cocina", kind: "Horno microondas", quantity: 2, hoursPerWeek: 0.5, kw: 0.9 },
      { location: "Cocina", kind: "Horno eléctrico", quantity: 1, hoursPerWeek: 1, kw: 0.95 },
      { location: "Cocina", kind: "Lavavajillas", quantity: 1, hoursPerWeek: 1, kw: 1 },
      { location: "Cocina", kind: "Estufa eléctrica", quantity: 0, hoursPerWeek: 14, kw: 2.5 },
      { location: "Lavandería", kind: "Lavadora", quantity: 1, hoursPerWeek: 6, kw: 0.9 },
      { location: "Lavandería", kind: "Secadora eléctrica", quantity: 1, hoursPerWeek: 6, kw: 3 },
      { location: "Lavandería", kind: "Plancha", quantity: 1, hoursPerWeek: 4, kw: 1.5 },
      { location: "Baño", kind: "Secadora de pelo", quantity: 1, hoursPerWeek: 0.5, kw: 0.8 },
      { location: "Baño", kind: "Calentador de agua", quantity: 1, hoursPerWeek: 2, kw: 3 },
      { location: "Baño", kind: "Jacuzzi", quantity: 0, hoursPerWeek: 4, kw: 0.6 },
      { location: "Electrónicos", kind: "LCD hasta 32\"", quantity: 2, hoursPerWeek: 14, kw: 0.2 },
      { location: "Electrónicos", kind: "LCD hasta 60\"", quantity: 1, hoursPerWeek: 14, kw: 0.5 },
      { location: "Electrónicos", kind: "Computadora de escritorio", quantity: 1, hoursPerWeek: 14, kw: 0.35 },
      { location: "Electrónicos", kind: "Computadora portátil", quantity: 1, hoursPerWeek: 14, kw: 0.1 },
      { location: "Electrónicos", kind: "Sistema de sonido", quantity: 1, hoursPerWeek: 7, kw: 0.25 },
      { location: "Otros", kind: "Aspiradora", quantity: 1, hoursPerWeek: 5, kw: 1 },
      { location: "Otros", kind: "Bomba de agua", quantity: 1, hoursPerWeek: 7, kw: 0.7 },
      { location: "Otros", kind: "Bomba de agua alberca", quantity: 0, hoursPerWeek: 21, kw: 0.8 },
    ],
    lighting: (["Cocina", "Sala/Comedor", "Recámaras", "Cochera/Jardín"] as const).flatMap((location, i) => [
      { location, kind: "Incandescente", quantity: 0, hoursPerWeek: 0, watts: 100 },
      { location, kind: "Ahorrador", quantity: 0, hoursPerWeek: 0, watts: 11 },
      { location, kind: "LED", quantity: 10, hoursPerWeek: [28, 28, 21, 56][i] ?? 0, watts: 7 },
    ]),
  };
}
