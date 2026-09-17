/* Tablas de la hoja Tab_Amp_Cir_AC del libro (NOM-001-SEDE-2012, DOF 29/11/2012).
   Se copian tal cual, con el mismo orden de renglones, porque las herramientas de
   circuito buscan "el primer valor que alcanza" sobre columnas ascendentes. */

/** Tabla 310-15(b)(16) y (b)(17): ampacidad por calibre. Columnas en el orden del libro:
    Cu 60/75/90 en canalización · Al 60/75/90 en canalización · Cu 60/75/90 al aire · Al 60/75/90 al aire. */
export type WireRow = { mm2: number; awg: string; amps: number[]; ohmKmCu: number; ohmKmAl: number };
export const WIRES: WireRow[] = [
  { mm2: 2.08, awg: "14 AWG", amps: [15, 20, 25, 0, 0, 0, 25, 30, 35, 0, 0, 0], ohmKmCu: 8.9, ohmKmAl: 0 },
  { mm2: 3.31, awg: "12 AWG", amps: [20, 25, 30, 0, 0, 0, 30, 35, 40, 0, 0, 0], ohmKmCu: 5.6, ohmKmAl: 9.2 },
  { mm2: 5.26, awg: "10 AWG", amps: [30, 35, 40, 0, 0, 0, 40, 50, 55, 0, 0, 0], ohmKmCu: 3.6, ohmKmAl: 5.9 },
  { mm2: 8.37, awg: "8 AWG", amps: [40, 50, 55, 0, 0, 0, 60, 70, 80, 0, 0, 0], ohmKmCu: 2.3, ohmKmAl: 3.6 },
  { mm2: 13.3, awg: "6 AWG", amps: [55, 65, 75, 40, 50, 55, 80, 95, 105, 60, 75, 85], ohmKmCu: 1.48, ohmKmAl: 2.36 },
  { mm2: 21.2, awg: "4 AWG", amps: [70, 85, 95, 55, 65, 75, 105, 125, 140, 80, 100, 115], ohmKmCu: 0.98, ohmKmAl: 1.51 },
  { mm2: 33.6, awg: "2 AWG", amps: [95, 115, 130, 75, 90, 100, 140, 170, 190, 110, 135, 150], ohmKmCu: 0.66, ohmKmAl: 0.98 },
  { mm2: 53.5, awg: "1/0 AWG", amps: [125, 150, 170, 100, 120, 135, 195, 230, 260, 150, 180, 205], ohmKmCu: 0.43, ohmKmAl: 0.66 },
  { mm2: 67.4, awg: "2/0 AWG", amps: [145, 175, 195, 115, 135, 150, 225, 265, 300, 175, 210, 235], ohmKmCu: 0.36, ohmKmAl: 0.52 },
  { mm2: 85, awg: "3/0 AWG", amps: [165, 200, 225, 130, 155, 175, 260, 310, 350, 200, 240, 270], ohmKmCu: 0.308, ohmKmAl: 0.46 },
  { mm2: 107, awg: "4/0 AWG", amps: [195, 230, 260, 150, 180, 205, 300, 360, 405, 235, 280, 315], ohmKmCu: 0.262, ohmKmAl: 0.36 },
  { mm2: 127, awg: "250 Kcmil", amps: [215, 255, 290, 170, 205, 230, 340, 405, 455, 265, 315, 355], ohmKmCu: 0.24, ohmKmAl: 0.33 },
  { mm2: 152, awg: "300 Kcmil", amps: [240, 285, 320, 195, 230, 260, 375, 445, 500, 290, 350, 395], ohmKmCu: 0.213, ohmKmAl: 0.289 },
  { mm2: 177, awg: "350 Kcmil", amps: [260, 310, 350, 210, 250, 280, 420, 505, 570, 330, 395, 445], ohmKmCu: 0.197, ohmKmAl: 0.262 },
  { mm2: 203, awg: "400 Kcmil", amps: [280, 335, 380, 225, 270, 305, 455, 545, 615, 355, 425, 480], ohmKmCu: 0.184, ohmKmAl: 0.24 },
  { mm2: 253, awg: "500 Kcmil", amps: [320, 380, 430, 260, 310, 350, 515, 620, 700, 405, 485, 545], ohmKmCu: 0.164, ohmKmAl: 0.21 },
  { mm2: 304, awg: "600 Kcmil", amps: [355, 420, 475, 285, 340, 385, 575, 690, 780, 455, 545, 615], ohmKmCu: 0.154, ohmKmAl: 0.19 },
  { mm2: 355, awg: "700 Kcmil", amps: [385, 460, 520, 315, 375, 425, 630, 755, 850, 500, 595, 670], ohmKmCu: 0.154, ohmKmAl: 0.19 },
  { mm2: 380, awg: "750 Kcmil", amps: [400, 475, 535, 320, 385, 435, 655, 785, 885, 515, 620, 700], ohmKmCu: 0.141, ohmKmAl: 0.171 },
  { mm2: 405, awg: "800 Kcmil", amps: [410, 490, 555, 330, 395, 445, 680, 815, 920, 535, 645, 725], ohmKmCu: 0.141, ohmKmAl: 0.171 },
  { mm2: 458, awg: "900 Kcmil", amps: [435, 520, 585, 355, 425, 480, 730, 870, 980, 580, 700, 790], ohmKmCu: 0.141, ohmKmAl: 0.171 },
  { mm2: 507, awg: "1000 Kcmil", amps: [455, 545, 615, 375, 445, 500, 780, 935, 1055, 625, 750, 845], ohmKmCu: 0.131, ohmKmAl: 0.151 },
  { mm2: 633, awg: "1250 Kcmil", amps: [495, 590, 665, 405, 485, 545, 890, 1065, 1200, 710, 855, 965], ohmKmCu: 0.131, ohmKmAl: 0.151 },
  { mm2: 760, awg: "1500 Kcmil", amps: [525, 625, 705, 435, 520, 585, 980, 1175, 1325, 795, 950, 1070], ohmKmCu: 0.131, ohmKmAl: 0.151 },
  { mm2: 887, awg: "1750 Kcmil", amps: [545, 650, 735, 455, 545, 615, 1070, 1280, 1445, 875, 1050, 1185], ohmKmCu: 0.131, ohmKmAl: 0.151 },
  { mm2: 1010, awg: "2000 Kcmil", amps: [555, 665, 750, 470, 560, 630, 1155, 1385, 1560, 960, 1150, 1295], ohmKmCu: 0.131, ohmKmAl: 0.151 },
];

/** Índice de columna en WIRES.amps, igual que en el libro: temperatura + aluminio (+3) + aire (+6). */
export function ampacityColumn(tempRating: 60 | 75 | 90, aluminum: boolean, freeAir: boolean): number {
  return [60, 75, 90].indexOf(tempRating) + (aluminum ? 3 : 0) + (freeAir ? 6 : 0);
}

/** Tabla 310-15(b)(2)(a): factor por temperatura ambiente (base 30 °C) para aislamiento 60/75/90 °C.
    `from` es el límite inferior del rango; el libro toma el último renglón cuyo `from` ≤ temperatura. */
export const TEMP_FACTORS: Array<{ from: number; f: [number, number, number] }> = [
  { from: 0, f: [1.29, 1.2, 1.15] }, { from: 11, f: [1.22, 1.15, 1.12] }, { from: 16, f: [1.15, 1.11, 1.08] },
  { from: 21, f: [1.08, 1.05, 1.04] }, { from: 26, f: [1, 1, 1] }, { from: 31, f: [0.91, 0.94, 0.96] },
  { from: 36, f: [0.82, 0.88, 0.91] }, { from: 41, f: [0.71, 0.82, 0.87] }, { from: 46, f: [0.58, 0.75, 0.82] },
  { from: 51, f: [0.41, 0.67, 0.76] }, { from: 56, f: [0, 0.58, 0.71] }, { from: 61, f: [0, 0.47, 0.65] },
  { from: 66, f: [0, 0.33, 0.58] }, { from: 71, f: [0, 0, 0.5] }, { from: 76, f: [0, 0, 0.41] }, { from: 81, f: [0, 0, 0.29] },
];

/** Tabla 310-15(b)(3)(a): factor por número de conductores portadores de corriente en la misma canalización. */
export const GROUPING_FACTORS: Array<{ from: number; f: number }> = [
  { from: 1, f: 1 }, { from: 4, f: 0.8 }, { from: 7, f: 0.7 }, { from: 10, f: 0.5 }, { from: 21, f: 0.45 }, { from: 31, f: 0.4 }, { from: 41, f: 0.35 },
];

/** Tabla 310-15(b)(3)(c): grados que se suman a la temperatura ambiente cuando la canalización va sobre techumbre,
    según la separación al techo en mm. */
export const ROOFTOP_ADDERS: Array<{ fromMm: number; addC: number }> = [
  { fromMm: 0, addC: 33 }, { fromMm: 14, addC: 22 }, { fromMm: 91, addC: 17 }, { fromMm: 301, addC: 14 },
];

/** 240-6: capacidades normalizadas de interruptores (A). */
export const BREAKERS = [10, 15, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200, 225, 250, 300, 350, 400, 500, 600, 700, 800, 1000, 1200, 1600, 2000, 2500];

/** Tabla 250-122: conductor de puesta a tierra de equipos por capacidad del interruptor. */
export const EGC: Array<{ upToA: number; cuMm2: number; cuAwg: string; alMm2: number; alAwg: string | null }> = [
  { upToA: 15, cuMm2: 2.08, cuAwg: "14 AWG", alMm2: 3.31, alAwg: null },
  { upToA: 20, cuMm2: 3.31, cuAwg: "12 AWG", alMm2: 5.26, alAwg: null },
  { upToA: 60, cuMm2: 5.26, cuAwg: "10 AWG", alMm2: 8.37, alAwg: null },
  { upToA: 100, cuMm2: 8.37, cuAwg: "8 AWG", alMm2: 13.3, alAwg: "6 AWG" },
  { upToA: 200, cuMm2: 13.3, cuAwg: "6 AWG", alMm2: 21.2, alAwg: "4 AWG" },
  { upToA: 300, cuMm2: 21.2, cuAwg: "4 AWG", alMm2: 33.6, alAwg: "2 AWG" },
  { upToA: 400, cuMm2: 33.6, cuAwg: "2 AWG", alMm2: 53.5, alAwg: "1/0 AWG" },
  { upToA: 500, cuMm2: 33.6, cuAwg: "2 AWG", alMm2: 53.5, alAwg: "1/0 AWG" },
  { upToA: 600, cuMm2: 53.5, cuAwg: "1/0 AWG", alMm2: 67.4, alAwg: "2/0 AWG" },
  { upToA: 800, cuMm2: 53.5, cuAwg: "1/0 AWG", alMm2: 85, alAwg: "3/0 AWG" },
  { upToA: 1000, cuMm2: 67.4, cuAwg: "2/0 AWG", alMm2: 107, alAwg: "4/0 AWG" },
  { upToA: 1200, cuMm2: 85, cuAwg: "3/0 AWG", alMm2: 127, alAwg: "250 Kcmil" },
  { upToA: 1600, cuMm2: 107, cuAwg: "4/0 AWG", alMm2: 177, alAwg: "350 Kcmil" },
  { upToA: 2000, cuMm2: 127, cuAwg: "250 Kcmil", alMm2: 203, alAwg: "400 Kcmil" },
  { upToA: 2500, cuMm2: 177, cuAwg: "350 Kcmil", alMm2: 304, alAwg: "600 Kcmil" },
  { upToA: 3000, cuMm2: 203, cuAwg: "400 Kcmil", alMm2: 304, alAwg: "600 Kcmil" },
  { upToA: 4000, cuMm2: 253, cuAwg: "500 Kcmil", alMm2: 380, alAwg: "750 Kcmil" },
  { upToA: 5000, cuMm2: 355, cuAwg: "700 Kcmil", alMm2: 633, alAwg: "1250 Kcmil" },
  { upToA: 6000, cuMm2: 405, cuAwg: "800 Kcmil", alMm2: 633, alAwg: "1250 Kcmil" },
];

/** Tabla 250-66: conductor del electrodo de puesta a tierra (Cu) por sección máxima del conductor de fase. */
export const GEC: Array<{ upToMm2: number; awg: string }> = [
  { upToMm2: 33.6, awg: "8 AWG" }, { upToMm2: 53.5, awg: "6 AWG" }, { upToMm2: 85, awg: "4 AWG" }, { upToMm2: 177, awg: "2 AWG" },
  { upToMm2: 304, awg: "1/0 AWG" }, { upToMm2: 557, awg: "2/0 AWG" }, { upToMm2: 99999, awg: "3/0 AWG" },
];

/** Configuración eléctrica por número de fases del inversor (Tab_Amp_Cir_AC!M94:M96). */
export const ELECTRICAL_CONFIG: Record<number, string> = { 1: "1F - 2H @ 50/60Hz", 2: "2F - 3H @ 50/60Hz", 3: "3F - 4H @ 50/60Hz" };

/** Cable fotovoltaico para el circuito DC: ampacidad 90 °C en canalización (b)(16) y al aire (b)(17), resistencia a 75 °C
    (Tabla 8), diámetro exterior, ampacidad para terminales a 75 °C (110-14(c)) y protección máxima 240-4(d). */
export const PV_WIRES: Array<{ awg: number; conduitA: number; airA: number; ohmKm75: number; diameterMm: number; terminalA75: number; maxOcpdA: number }> = [
  { awg: 14, conduitA: 25, airA: 35, ohmKm75: 10.1, diameterMm: 6.0, terminalA75: 20, maxOcpdA: 15 },
  { awg: 12, conduitA: 30, airA: 40, ohmKm75: 6.34, diameterMm: 6.5, terminalA75: 25, maxOcpdA: 20 },
  { awg: 10, conduitA: 40, airA: 55, ohmKm75: 3.984, diameterMm: 7.1, terminalA75: 35, maxOcpdA: 30 },
  { awg: 8, conduitA: 55, airA: 80, ohmKm75: 2.506, diameterMm: 8.3, terminalA75: 50, maxOcpdA: 9999 },
  { awg: 6, conduitA: 75, airA: 105, ohmKm75: 1.608, diameterMm: 9.7, terminalA75: 65, maxOcpdA: 9999 },
  { awg: 4, conduitA: 95, airA: 140, ohmKm75: 1.01, diameterMm: 11.4, terminalA75: 85, maxOcpdA: 9999 },
];

/** 240-6: fusibles normalizados de 1 a 100 A. */
export const FUSES = [1, 3, 6, 10, 15, 16, 20, 25, 30, 32, 35, 40, 45, 50, 60, 63, 70, 80, 90, 100];

/** Tabla 4 (Cap. 10): tubería PVC cédula 40, designación métrica, pulgadas y área disponible al 40 % (mm²). */
export const CONDUITS: Array<{ designation: number; inches: string; area40Mm2: number }> = [
  { designation: 16, inches: '1/2"', area40Mm2: 74 }, { designation: 21, inches: '3/4"', area40Mm2: 131 }, { designation: 27, inches: '1"', area40Mm2: 214 },
  { designation: 35, inches: '1 1/4"', area40Mm2: 374 }, { designation: 41, inches: '1 1/2"', area40Mm2: 513 }, { designation: 53, inches: '2"', area40Mm2: 849 },
  { designation: 63, inches: '2 1/2"', area40Mm2: 1212 }, { designation: 78, inches: '3"', area40Mm2: 1877 }, { designation: 91, inches: '3 1/2"', area40Mm2: 2511 },
  { designation: 103, inches: '4"', area40Mm2: 3237 },
];

/* Búsquedas con la semántica del libro. */
/** COUNTIF(rango,"<"&x)+1 → primer elemento ≥ x; -1 si ninguno alcanza. */
export function firstAtLeast(values: number[], x: number): number {
  return values.findIndex((v) => v >= x);
}
/** COUNTIF(rango,"<="&x) → último elemento ≤ x; -1 si x está por debajo de todos. */
export function lastAtMost(values: number[], x: number): number {
  let i = -1;
  values.forEach((v, k) => { if (v <= x) i = k; });
  return i;
}
