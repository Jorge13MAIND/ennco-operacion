/**
 * Traer contactos de Apollo hacia el inventario de investigación.
 *
 * Es el eslabón que faltaba: el cliente de Apollo sabía buscar personas y la
 * base sabía guardar candidatos, pero nada los conectaba, así que la
 * verificación se hacía a mano fuera de la plataforma y su evidencia no
 * quedaba ligada al sujeto.
 *
 * Tres reglas que gobiernan el diseño:
 *
 * 1. **Buscar es gratis, revelar el correo cuesta.** `mixed_people/api_search`
 *    no consume créditos; `people/match` sí. Por eso la búsqueda es amplia y
 *    el enriquecimiento va con tope duro por corrida, para que una pasada
 *    distraída no se coma el presupuesto del mes.
 *
 * 2. **La categoría la decide la base, no este archivo.** `upsert_contact_candidate`
 *    rechaza el alta si la categoría enviada no coincide con lo que devuelve
 *    `app.research_role_category` sobre el mismo cargo. Aquí se clasifica con
 *    el gemelo en TypeScript y la prueba de paridad vigila que no se separen.
 *
 * 3. **Un candidato no es un contacto.** Todo entra como `DISCOVERED` y sube a
 *    contacto sólo por el flujo de revisión de dos personas que ya existe.
 */

import { classifyRoleTitle, type ResearchRoleCategory } from "./roles";

/** Cargos que se buscan por categoría objetivo del copy. */
export const APOLLO_TITLE_QUERIES: Readonly<Record<Exclude<ResearchRoleCategory, "OTHER">, readonly string[]>> = {
  CEO: ["director general", "gerente general", "ceo", "propietario", "managing director"],
  PLANT_DIRECTOR: ["director de planta", "gerente de planta", "plant manager", "plant director", "jefe de planta"],
  MAINTENANCE: ["mantenimiento", "maintenance manager", "jefe de mantenimiento", "gerente de mantenimiento", "facilities manager"],
  PROCUREMENT: ["compras", "purchasing", "procurement", "comprador", "adquisiciones", "sourcing"],
  SAFETY: ["seguridad e higiene", "seguridad industrial", "ehs", "hse", "safety manager", "coordinador de seguridad"],
};

/** Antigüedades que deciden o influyen en una inversión de energía. */
export const APOLLO_SENIORITIES = ["owner", "founder", "c_suite", "vp", "head", "director", "manager"] as const;

/**
 * Tope de enriquecimientos por corrida.
 *
 * El pool del equipo es de 4,000 créditos pero el perfil de la llave reporta
 * 85 créditos de lead disponibles, y ese es el número que manda para la API.
 * Un tope de 40 deja margen para verificar el resultado antes de repetir.
 */
export const ENRICH_LIMIT_PER_RUN = 40;

/** Máximo de candidatos por cuenta: uno por categoría objetivo, no más. */
export const CANDIDATES_PER_ACCOUNT = 5;

export interface ApolloPersonLike {
  readonly id: string;
  readonly first_name: string;
  readonly last_name: string;
  readonly title?: string | null;
  readonly organization?: { readonly primary_domain?: string | null; readonly name?: string | null } | null;
}

export interface SelectedCandidate {
  readonly providerPersonId: string;
  readonly fullName: string;
  readonly roleTitle: string;
  readonly roleCategory: Exclude<ResearchRoleCategory, "OTHER">;
}

/**
 * Elige a quién vale la pena enriquecer de todo lo que devolvió la búsqueda.
 *
 * Se queda con una persona por categoría objetivo: escribirle a tres personas
 * de mantenimiento en la misma planta no aumenta la probabilidad de respuesta
 * y sí la de que alguien marque spam. Los cargos que caen en OTHER se
 * descartan aquí porque la base no los aceptaría de todos modos.
 */
export function selectCandidates(people: readonly ApolloPersonLike[]): SelectedCandidate[] {
  const porCategoria = new Map<string, SelectedCandidate>();

  for (const person of people) {
    const roleTitle = (person.title ?? "").trim();
    if (roleTitle.length < 2) continue;

    const roleCategory = classifyRoleTitle(roleTitle);
    if (roleCategory === "OTHER") continue;
    if (porCategoria.has(roleCategory)) continue;

    const fullName = `${person.first_name} ${person.last_name}`.trim();
    if (fullName.length < 2) continue;

    porCategoria.set(roleCategory, { providerPersonId: person.id, fullName, roleTitle, roleCategory });
    if (porCategoria.size >= CANDIDATES_PER_ACCOUNT) break;
  }

  return [...porCategoria.values()];
}

/** Un correo de Apollo sólo sirve si es real y está verificado. */
export function isUsableEmail(email: string | null | undefined, status: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) return false;
  // Apollo devuelve marcadores cuando el correo existe pero no está liberado.
  if (normalized.includes("email_not_unlocked")) return false;
  if (normalized.endsWith(".invalid")) return false;
  if (status && ["unavailable", "bounced", "invalid"].includes(status.trim().toLowerCase())) return false;
  return true;
}

/** Las consultas de cargos para las categorías pedidas, sin repetir. */
export function titlesFor(categories: readonly Exclude<ResearchRoleCategory, "OTHER">[]): string[] {
  const titles = new Set<string>();
  for (const category of categories) {
    for (const title of APOLLO_TITLE_QUERIES[category]) titles.add(title);
  }
  // El cliente de Apollo topa en 30 cargos por consulta.
  return [...titles].slice(0, 30);
}

export interface AccountForLookup {
  readonly id: string;
  readonly legal_name: string;
  readonly primary_domain: string | null;
}

/**
 * Separa las cuentas que se pueden consultar de las que no.
 *
 * La búsqueda de personas de Apollo exige dominios: una cuenta sin dominio no
 * se puede consultar y decirlo es más útil que devolver cero contactos sin
 * explicación. El sourcing del 26-ago trajo muchas cuentas con dominio nulo.
 */
export function partitionByDomain(accounts: readonly AccountForLookup[]): {
  buscables: AccountForLookup[];
  sinDominio: AccountForLookup[];
} {
  const buscables: AccountForLookup[] = [];
  const sinDominio: AccountForLookup[] = [];
  for (const account of accounts) {
    const domain = (account.primary_domain ?? "").trim().toLowerCase();
    if (domain.length >= 3 && domain.includes(".")) buscables.push(account);
    else sinDominio.push(account);
  }
  return { buscables, sinDominio };
}

export interface IngestSummary {
  readonly accountsRequested: number;
  readonly accountsSearched: number;
  readonly accountsWithoutDomain: number;
  readonly peopleFound: number;
  readonly candidatesSelected: number;
  readonly emailsRevealed: number;
  readonly candidatesWritten: number;
  readonly enrichBudgetSpent: number;
  readonly enrichBudgetLimit: number;
  readonly byCategory: Readonly<Record<string, number>>;
}

export function emptySummary(accountsRequested: number): IngestSummary {
  return {
    accountsRequested,
    accountsSearched: 0,
    accountsWithoutDomain: 0,
    peopleFound: 0,
    candidatesSelected: 0,
    emailsRevealed: 0,
    candidatesWritten: 0,
    enrichBudgetSpent: 0,
    enrichBudgetLimit: ENRICH_LIMIT_PER_RUN,
    byCategory: {},
  };
}
