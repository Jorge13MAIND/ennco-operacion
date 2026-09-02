/**
 * Puntuación ICP (patrón del agente 05 de Atlas, adaptado al stack de ENNCO).
 *
 * Atlas resuelve esto con un agente LLM que llama herramientas. Aquí no: la
 * puntuación es determinista y pura, por tres razones que sí importan en este
 * proyecto:
 *   1. El contrato define lead calificado por cláusula, no por criterio. Una
 *      cifra que cambia entre corridas no se puede defender ante el cliente.
 *   2. Sin llamadas a un proveedor externo no hay costo por cuenta ni límite
 *      de créditos, y las 1,831 empresas se pueden puntuar completas.
 *   3. Es verificable con pruebas unitarias, que es lo que el resto del repo
 *      exige antes de declarar algo listo.
 *
 * La rúbrica traduce a 100 puntos el esquema /7 que ya usó el sourcing del
 * 26-ago (PROFEPA +4, SCIAN intensivo +2, parque +1), conservando a PROFEPA
 * como la señal dominante porque es el único padrón público que confirma
 * operación industrial real y vigente.
 *
 * Regla heredada del repo: sin evidencia nunca se pinta verde. Una señal que
 * no se pudo leer suma cero y queda anotada como faltante, jamás se asume.
 */

export const ICP_RUBRIC_VERSION = "icp-v1-2026-09-02";

/** Estados que la cláusula 01 del contrato incluye. */
export const CONTRACT_STATES = ["GUANAJUATO", "QUERETARO", "JALISCO", "MICHOACAN"] as const;

/**
 * Estados que el código de investigación acepta hoy. El contrato incluye dos
 * más (ver hueco documentado en el handover del 1-sep): 176 filas de PROFEPA
 * de Jalisco y Michoacán descargadas que nunca entraron a un lote. Se puntúan
 * igual y se marcan, para que el mercado contractual sin explotar sea visible
 * en vez de desaparecer en silencio.
 */
export const IMPLEMENTED_STATES = ["GUANAJUATO", "QUERETARO"] as const;

/** Corredor industrial León-Querétaro efectivamente trabajado por el sourcing. */
export const CORRIDOR_CITIES = [
  "leon", "queretaro", "el marques", "silao", "irapuato", "celaya",
  "apaseo el grande", "salamanca", "colon", "apaseo el alto",
] as const;

/**
 * SCIAN intensivos en energía. Son los giros donde una falla eléctrica para
 * la producción y donde el consumo hace que un proyecto supere los 100 kWp.
 */
const ENERGY_INTENSIVE_SCIAN = new Set(["322", "325", "326", "327", "331", "336"]);

export type EmployeeBand = "251+" | "101-250" | "51-100" | "MENOR" | "DESCONOCIDO";

export type IcpBand = "A" | "B" | "C" | "D" | "FUERA_DE_CONTRATO";

export interface IcpAccountInput {
  readonly legal_name: string;
  readonly state: string | null;
  readonly city: string | null;
  readonly industrial_park: string | null;
  /** Texto crudo del sourcing: "SCIAN 336330 · Fabricación ... · 251 y más personas". */
  readonly sector: string | null;
  readonly primary_domain: string | null;
  /** Certificado PROFEPA-PNAA vigente, derivado del padrón de origen. */
  readonly profepa_certified: boolean | null;
}

export interface IcpFactor {
  readonly key: string;
  readonly label: string;
  readonly points: number;
  readonly max: number;
  readonly evidence: string;
}

export interface IcpScore {
  readonly score: number;
  readonly band: IcpBand;
  readonly rubric_version: string;
  readonly factors: readonly IcpFactor[];
  /** Señales que no se pudieron leer. Suman cero y quedan a la vista. */
  readonly missing: readonly string[];
  /** Estado contractual pero todavía no implementado en investigación. */
  readonly contract_only_state: boolean;
}

function normalize(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Extrae el código SCIAN de la cadena del sourcing. Devuelve null si no viene. */
export function parseScian(sector: string | null): string | null {
  const match = /scian\s*([0-9]{2,6})/i.exec(sector ?? "");
  return match?.[1] ?? null;
}

/** Extrae la banda de personal ocupado que publica DENUE. */
export function parseEmployeeBand(sector: string | null): EmployeeBand {
  const text = normalize(sector);
  if (!text) return "DESCONOCIDO";
  if (/251\s*y\s*mas/.test(text)) return "251+";
  if (/101\s*a\s*250/.test(text)) return "101-250";
  if (/51\s*a\s*100/.test(text)) return "51-100";
  if (/(0\s*a\s*5|6\s*a\s*10|11\s*a\s*30|31\s*a\s*50)\s*person/.test(text)) return "MENOR";
  return "DESCONOCIDO";
}

/**
 * Puntúa una cuenta de 0 a 100 contra el ICP contractual.
 *
 * El estado es compuerta, no factor: una empresa fuera de los cuatro estados
 * del contrato no puede ser lead calificado por mucho que cumpla lo demás, así
 * que devuelve 0 y banda FUERA_DE_CONTRATO en vez de un número que invite a
 * contactarla.
 */
export function scoreAccount(account: IcpAccountInput): IcpScore {
  const state = normalize(account.state).toUpperCase().replace(/\s+/g, "");
  const stateKey = state === "MICHOACAN" || state === "MICHOACANDEOCAMPO" ? "MICHOACAN" : state;
  const inContract = (CONTRACT_STATES as readonly string[]).includes(stateKey);

  if (!inContract) {
    return {
      score: 0,
      band: "FUERA_DE_CONTRATO",
      rubric_version: ICP_RUBRIC_VERSION,
      factors: [{
        key: "estado",
        label: "Estado contractual",
        points: 0,
        max: 0,
        evidence: account.state ? `${account.state} está fuera de la cláusula 01` : "sin estado registrado",
      }],
      missing: account.state ? [] : ["estado"],
      contract_only_state: false,
    };
  }

  const factors: IcpFactor[] = [];
  const missing: string[] = [];

  // Tamaño: el único proxy público de consumo >100 kWp. No hay padrón abierto
  // de grandes consumidores de CFE, así que el personal ocupado de DENUE es lo
  // más cercano que existe.
  const band = parseEmployeeBand(account.sector);
  const sizePoints = band === "251+" ? 30 : band === "101-250" ? 20 : band === "51-100" ? 8 : 0;
  if (band === "DESCONOCIDO") missing.push("tamaño");
  factors.push({
    key: "tamano",
    label: "Tamaño (proxy de >100 kWp)",
    points: sizePoints,
    max: 30,
    evidence: band === "DESCONOCIDO" ? "sin banda de personal en el padrón" : `personal ocupado ${band}`,
  });

  // PROFEPA: señal de calidad más fuerte del sourcing. Confirma operación
  // industrial real, vigente y con cultura de cumplimiento.
  const profepaPoints = account.profepa_certified === true ? 25 : 0;
  if (account.profepa_certified === null) missing.push("profepa");
  factors.push({
    key: "profepa",
    label: "Certificado PROFEPA-PNAA vigente",
    points: profepaPoints,
    max: 25,
    evidence: account.profepa_certified === true
      ? "Industria Limpia vigente"
      : account.profepa_certified === false ? "sin certificado en el padrón" : "no verificado",
  });

  // Giro: intensivo en energía contra manufactura general.
  const scian = parseScian(account.sector);
  const scian3 = scian ? scian.slice(0, 3) : null;
  const scian2 = scian ? scian.slice(0, 2) : null;
  const isIntensive = scian3 !== null && ENERGY_INTENSIVE_SCIAN.has(scian3);
  const isManufacturing = scian2 !== null && ["31", "32", "33"].includes(scian2);
  const sectorPoints = isIntensive ? 25 : isManufacturing ? 12 : 0;
  if (!scian) missing.push("scian");
  factors.push({
    key: "giro",
    label: "Giro intensivo en energía",
    points: sectorPoints,
    max: 25,
    evidence: !scian ? "sin código SCIAN"
      : isIntensive ? `SCIAN ${scian}, intensivo en energía`
      : isManufacturing ? `SCIAN ${scian}, manufactura no intensiva`
      : `SCIAN ${scian}, fuera de manufactura`,
  });

  // Parque industrial: facilita el acceso y suele implicar subestación propia.
  const park = (account.industrial_park ?? "").trim();
  factors.push({
    key: "parque",
    label: "Parque industrial identificado",
    points: park ? 10 : 0,
    max: 10,
    evidence: park ? park : "sin parque registrado",
  });
  if (!park) missing.push("parque");

  // Ciudad del corredor: donde ENNCO ya opera y puede hacer levantamiento.
  const city = normalize(account.city);
  const inCorridor = city !== "" && (CORRIDOR_CITIES as readonly string[]).some((c) => city.includes(c));
  factors.push({
    key: "corredor",
    label: "Ciudad del corredor León-Querétaro",
    points: inCorridor ? 10 : 0,
    max: 10,
    evidence: account.city ? (inCorridor ? `${account.city}, dentro del corredor` : `${account.city}, fuera del corredor`) : "sin ciudad",
  });
  if (!account.city) missing.push("ciudad");

  const score = factors.reduce((total, factor) => total + factor.points, 0);
  const scoreBand: IcpBand = score >= 75 ? "A" : score >= 55 ? "B" : score >= 35 ? "C" : "D";

  return {
    score,
    band: scoreBand,
    rubric_version: ICP_RUBRIC_VERSION,
    factors,
    missing,
    contract_only_state: !(IMPLEMENTED_STATES as readonly string[]).includes(stateKey),
  };
}

export const ICP_BAND_LABELS: Record<IcpBand, string> = {
  A: "Prioridad alta",
  B: "Prioridad media",
  C: "Prioridad baja",
  D: "Descartable",
  FUERA_DE_CONTRATO: "Fuera de contrato",
};
