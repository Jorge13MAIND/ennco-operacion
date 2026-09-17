/* Calculadora de sombras (hojas Cal_Sombra y Cal_Sombra_Apoyo del libro).
   Distancia mínima entre filas de páneles para que la fila de atrás no reciba sombra de la de
   adelante en el peor día del año (solsticio de invierno) durante la ventana de horas sin sombra,
   y distancia a un obstáculo frontal (muro o árbol) por el mismo criterio. */
import { findCity, findModule } from "@/lib/solar/catalog";
import type { SolarCatalog } from "@/lib/solar/types";

export type ShadingInput = {
  city: string;
  moduleModel: string;
  /** E12: altura del obstáculo frontal (m). */
  obstacleHeightM: number;
  /** E29: inclinación del panel (°). */
  inclinationDeg: number;
  /** I29 + I30: si la superficie tiene pendiente y su ángulo (°). */
  slopedSurface: boolean;
  slopeDeg: number;
  /** L29: módulos por panel (en el sentido de la longitud). */
  modulesPerPanel: number;
  /** E31: VERTICAL usa el largo del módulo; HORIZONTAL el ancho. */
  orientation: "VERTICAL" | "HORIZONTAL";
  /** D10 de la hoja de apoyo: ventana de horas sin sombra (9.25 en el libro). */
  hoursWithoutShade?: number;
};

export type ShadingResult = {
  latitude: number;
  /** H18: longitud de los módulos sin holgura (m). */
  modulesLengthM: number;
  /** C35: longitud total del panel con 2 cm de holgura por módulo (m). */
  panelLengthM: number;
  /** D25: altura solar al inicio de la ventana (°). */
  solarAltitudeDeg: number;
  /** D30: azimut solar en ese momento (°). */
  solarAzimuthDeg: number;
  /** D37: distancia pie a pie sin pendiente (m). */
  rowDistanceFlatM: number;
  /** D59: distancia pie a pie con la pendiente capturada (m). */
  rowDistanceSlopedM: number;
  /** G35: la que aplica según la captura. */
  rowDistanceM: number;
  /** H37: distancia libre a un obstáculo vertical de la altura capturada (m). */
  obstacleDistanceM: number;
  /** D47: comprobación con el criterio de colectores solares térmicos (m). */
  collectorCheckM: number;
  warnings: string[];
};

/** D14 del libro: declinación del solsticio de invierno, el peor día del año. */
export const WINTER_DECLINATION_DEG = -23.42899966413048;
export const DEFAULT_HOURS_WITHOUT_SHADE = 9.25;

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function computeShading(input: ShadingInput, catalog: SolarCatalog): ShadingResult {
  const city = findCity(catalog, input.city);
  const panel = findModule(catalog, input.moduleModel);
  if (!city) throw new Error(`SOLAR_CITY_NOT_FOUND: ${input.city}`);
  if (!panel) throw new Error(`SOLAR_MODULE_NOT_FOUND: ${input.moduleModel}`);
  const warnings: string[] = [];

  const latitude = city.latitude ?? 0;
  const hours = input.hoursWithoutShade ?? DEFAULT_HOURS_WITHOUT_SHADE;
  const n = Math.max(0, input.modulesPerPanel);
  const sideMm = (input.orientation === "HORIZONTAL" ? panel.widthMm : panel.lengthMm) ?? 0;
  if (!sideMm) warnings.push("El módulo no tiene dimensiones en el catálogo.");
  const modulesLengthM = (sideMm / 1000) * n;        // H18
  const panelLengthM = n * (sideMm / 1000 + 0.02);   // C35

  // Hoja de apoyo, columna D: posición del sol al inicio de la ventana en el solsticio de invierno.
  const w = 15 * (hours / 2);                                            // D15: ángulo horario
  const sinH = Math.sin(rad(latitude)) * Math.sin(rad(WINTER_DECLINATION_DEG))
    + Math.cos(rad(latitude)) * Math.cos(rad(WINTER_DECLINATION_DEG)) * Math.cos(rad(w)); // D24
  const h = deg(Math.asin(sinH));                                        // D25: altura solar
  const cosH = Math.cos(rad(h));
  const sinPsi = cosH === 0 ? 0 : (Math.cos(rad(WINTER_DECLINATION_DEG)) * Math.sin(rad(w))) / cosH; // D29
  const psi = deg(Math.asin(Math.max(-1, Math.min(1, sinPsi))));       // D30: azimut solar
  const tanH = Math.tan(rad(h));
  if (h <= 0) warnings.push("Con esa latitud y esa ventana de horas el sol queda bajo el horizonte al inicio de la ventana; reduce las horas sin sombra.");

  const a = input.inclinationDeg;
  const cosPsi = Math.cos(rad(psi));
  // D37: distancia pie a pie sobre superficie plana.
  const rowDistanceFlatM = tanH > 0 ? panelLengthM * (Math.cos(rad(a)) + (Math.sin(rad(a)) * cosPsi) / tanH) : 0;
  // D44..D47: comprobación con el criterio de colectores (h0 = 90 − lat − 23.5).
  const h0 = 90 - latitude - 23.5;
  const collectorCheckM = panelLengthM * (Math.cos(rad(a)) + Math.sin(rad(a)) / Math.tan(rad(h0)));
  // D51..D59: con pendiente θ la inclinación efectiva es α−θ y la altura solar efectiva h+θ.
  const theta = input.slopedSurface ? input.slopeDeg : 0;
  const tanHT = Math.tan(rad(h + theta));
  const rowDistanceSlopedM = tanHT > 0 ? panelLengthM * (Math.cos(rad(a - theta)) + (Math.sin(rad(a - theta)) * cosPsi) / tanHT) : 0;
  const rowDistanceM = input.slopedSurface ? rowDistanceSlopedM : rowDistanceFlatM;
  // Columna H: el obstáculo se trata como un panel vertical (90°) de su altura, sin pendiente.
  const obstacleDistanceM = tanH > 0 ? input.obstacleHeightM * (Math.cos(rad(90)) + (Math.sin(rad(90)) * cosPsi) / tanH) : 0;

  if (n === 0) warnings.push("Captura al menos un módulo por panel.");
  return { latitude, modulesLengthM, panelLengthM, solarAltitudeDeg: h, solarAzimuthDeg: psi, rowDistanceFlatM, rowDistanceSlopedM, rowDistanceM, obstacleDistanceM, collectorCheckM, warnings };
}
