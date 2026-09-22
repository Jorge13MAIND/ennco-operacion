/**
 * Rúbrica ICP v2 (22-sep-2026): a quién le escribimos primero.
 *
 * Por qué no se usa `icp.ts`: aquella rúbrica espera cadenas del padrón DENUE/PROFEPA
 * ("SCIAN 336330 · … · 251 y más personas") y un certificado de Industria Limpia. Nuestras
 * 840 cuentas vienen de Apollo, donde `sector` es una etiqueta corta en inglés ("automotive")
 * y no hay SCIAN ni PROFEPA. Resultado medido el 21-sep: 0 de 840 cuentas puntuadas. Esta
 * versión puntúa con las señales que sí tenemos, y deja anotado lo que falta en vez de
 * suponerlo. La v1 se conserva para cuando vuelva a haber sourcing de padrón.
 *
 * Regla heredada y respetada: sin evidencia nunca se pinta verde. Una señal ausente suma cero
 * y queda listada en `missing`.
 *
 * Orden de la regla de Paco en la puerta (junta #1): "yo no voy a la tiendita de la esquina;
 * voy con las que tienen renombre o bastantes equipos instalados".
 */

export const ICP_V2_VERSION = "icp-v2-2026-09-22";

/** Estados de la cláusula 01 del contrato. Fuera de aquí no se escribe. */
export const CONTRACT_STATES_V2 = ["GUANAJUATO", "QUERETARO", "JALISCO", "MICHOACAN"] as const;

/**
 * Sectores donde una falla eléctrica para la línea o compromete el producto. Son los giros
 * en los que el argumento de Paco (paro, termografía, póliza) aterriza sin traducción.
 */
const HIGH_VALUE_SECTORS = new Set([
  "automotive", "food & beverages", "food production", "plastics", "chemicals", "pharmaceuticals",
  "packaging & containers", "machinery", "electrical/electronic manufacturing",
  "mechanical or industrial engineering", "glass, ceramics & concrete", "mining & metals",
  "paper & forest products", "textiles", "automotive parts", "industrial",
]);

/**
 * Corporativos globales con compras centralizadas y contrato nacional. No se cierran por correo
 * frío: entran a una lista aparte para referido o licitación, y por eso restan.
 */
const GLOBAL_ACCOUNTS = /\b(heineken|nestl|coca[- ]?cola|pepsi|bimbo|unilever|p&g|procter|kellogg|danone|mars|general motors|gm de mexico|ford|toyota|mazda|honda|volkswagen|nissan|bosch|siemens|abb|schneider|3m|pirelli|michelin|continental|bridgestone|cemex|grupo modelo|femsa|lala|sigma alimentos)\b/i;

export type IcpBandV2 = "A" | "B" | "C" | "FUERA_DE_CONTRATO";

export interface IcpV2Input {
  readonly legal_name: string;
  readonly state: string | null;
  readonly city: string | null;
  readonly sector: string | null;
  readonly primary_domain: string | null;
  readonly tier: string | null;
  /** Puestos de los contactos verificados que tenemos de esa empresa. */
  readonly contact_roles: readonly string[];
  /** Gancho verificable encontrado y aprobado para esa empresa. */
  readonly has_hook: boolean;
}

export interface IcpV2Factor { readonly key: string; readonly label: string; readonly points: number; readonly max: number; readonly evidence: string }
export interface IcpV2Score {
  readonly score: number;
  readonly band: IcpBandV2;
  readonly rubric_version: string;
  readonly factors: readonly IcpV2Factor[];
  readonly missing: readonly string[];
  /** Cuenta estratégica: no va por correo frío aunque puntúe alto. */
  readonly strategic_account: boolean;
}

const normalize = (value: string | null | undefined) =>
  (value ?? "").normalize("NFD").replace(/[̀-ͯ]/gu, "").toLowerCase().trim();

const MAINTENANCE = /(manten|maintenance|electric|el[eé]ctric|facilit)/i;
const DECISION = /(plant manager|plant director|director de planta|gerente de planta|general manager|gerente general|director general|owner|ceo|country manager|operations manager|gerente de operaciones)/i;
const PURCHASING = /(purchas|procure|compras|sourcing|buyer|abastecimiento)/i;

export function scoreAccountV2(account: IcpV2Input): IcpV2Score {
  const stateKey = normalize(account.state).toUpperCase().replace(/\s+/gu, "");
  const state = stateKey === "MICHOACANDEOCAMPO" ? "MICHOACAN" : stateKey;
  if (!(CONTRACT_STATES_V2 as readonly string[]).includes(state)) {
    return {
      score: 0, band: "FUERA_DE_CONTRATO", rubric_version: ICP_V2_VERSION,
      factors: [{ key: "estado", label: "Estado contractual", points: 0, max: 0, evidence: account.state ? `${account.state} está fuera de la cláusula 01` : "sin estado registrado" }],
      missing: account.state ? [] : ["estado"], strategic_account: false,
    };
  }

  const factors: IcpV2Factor[] = [];
  const missing: string[] = [];

  // Giro donde el paro se paga caro.
  const sector = normalize(account.sector);
  const highValue = HIGH_VALUE_SECTORS.has(sector);
  if (!sector) missing.push("sector");
  factors.push({
    key: "sector", label: "Giro donde una falla para la línea", points: highValue ? 25 : sector ? 8 : 0, max: 25,
    evidence: !sector ? "sin sector" : highValue ? `${account.sector}, intensivo o de paro caro` : `${account.sector}, fuera de los giros prioritarios`,
  });

  // Multi-hilo: resuelve la objeción número uno de Paco, que el segundo al mando no transmite.
  const roles = account.contact_roles.map((r) => r ?? "");
  const hasMaintenance = roles.some((r) => MAINTENANCE.test(r));
  const hasDecision = roles.some((r) => DECISION.test(r));
  const hasPurchasing = roles.some((r) => PURCHASING.test(r));
  const threadPoints = hasMaintenance && hasDecision ? 20 : hasMaintenance || hasDecision ? 8 : 0;
  if (roles.length === 0) missing.push("contactos");
  factors.push({
    key: "multihilo", label: "Mantenimiento y dirección a la vez", points: threadPoints, max: 20,
    evidence: roles.length === 0 ? "sin contactos verificados"
      : `${hasMaintenance ? "mantenimiento" : "sin mantenimiento"} · ${hasDecision ? "dirección" : "sin dirección"}${hasPurchasing ? " · compras" : ""}`,
  });

  // Gancho verificable: la línea propia de esa planta, con fuente aprobada.
  factors.push({
    key: "gancho", label: "Gancho verificable aprobado", points: account.has_hook ? 25 : 0, max: 25,
    evidence: account.has_hook ? "gancho con fuente y fecha" : "sin gancho todavía",
  });
  if (!account.has_hook) missing.push("gancho");

  // Tier del sourcing: la única señal de tamaño que traemos de Apollo.
  const tierPoints = account.tier === "1" ? 20 : account.tier === "2" ? 8 : 0;
  if (!account.tier) missing.push("tier");
  factors.push({
    key: "tier", label: "Tier del sourcing (proxy de tamaño)", points: tierPoints, max: 20,
    evidence: account.tier ? `tier ${account.tier}` : "sin tier",
  });

  // Dominio propio: sin él no hay a quién escribirle ni cómo verificar la empresa.
  const domain = (account.primary_domain ?? "").trim();
  factors.push({ key: "dominio", label: "Dominio propio", points: domain ? 10 : 0, max: 10, evidence: domain || "sin dominio" });
  if (!domain) missing.push("dominio");

  const strategic = GLOBAL_ACCOUNTS.test(account.legal_name);
  const raw = factors.reduce((total, f) => total + f.points, 0);
  const score = Math.max(0, Math.min(100, strategic ? raw - 30 : raw));
  if (strategic) {
    factors.push({ key: "estrategica", label: "Corporativo con compras centralizadas", points: -30, max: 0, evidence: "no se cierra por correo frío; va por referido o licitación" });
  }

  const band: IcpBandV2 = strategic ? "C" : score >= 70 ? "A" : score >= 45 ? "B" : "C";
  return { score, band, rubric_version: ICP_V2_VERSION, factors, missing, strategic_account: strategic };
}
