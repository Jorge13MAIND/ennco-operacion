import { z } from "zod";

import type { OperationsAccessContext } from "@/lib/auth/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Pantalla Leads (/operacion/leads): todos los contactos de la base en una sola
 * tabla, etiquetados con la lista de Apollo de la que salieron, con la etapa en
 * que va cada uno (sin enviar, en cola, toque N, respondió, rebotó, baja) y una
 * franja de porcentajes calculada sobre el filtro vigente. Sustituye a las
 * pestañas Leads y Empresas; la vista por empresa agrupa el mismo filtro.
 */

export const LEAD_STAGES = ["todos", "PENDIENTE", "SIN_ENVIAR", "EN_COLA", "ENVIADO", "TOQUE_1", "TOQUE_2", "TOQUE_3", "TOQUE_4", "TOQUE_5", "TOQUE_6", "TOQUE_7", "TOQUE_8", "RESPONDIO", "REBOTO", "BAJA"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];
export const LEAD_VIEWS = ["contactos", "empresas"] as const;
export type LeadView = (typeof LEAD_VIEWS)[number];
export const LEAD_PAGE_SIZE = 150;
export const ALL = "todos";

export const LEAD_STAGE_LABELS: Record<string, string> = {
  todos: "Todas las etapas",
  PENDIENTE: "Faltan por enviar (sin enviar + en cola)",
  SIN_ENVIAR: "Sin enviar",
  EN_COLA: "En cola",
  ENVIADO: "Ya se les envió (cualquier toque)",
  TOQUE_1: "Van en toque 1",
  TOQUE_2: "Van en toque 2",
  TOQUE_3: "Van en toque 3",
  TOQUE_4: "Van en toque 4",
  TOQUE_5: "Van en toque 5",
  TOQUE_6: "Van en toque 6",
  TOQUE_7: "Van en toque 7",
  TOQUE_8: "Van en toque 8",
  RESPONDIO: "Respondieron",
  REBOTO: "Rebotaron",
  BAJA: "Pidieron baja",
};

export const LEAD_LIST_LABELS: Record<string, string> = {
  LANZAMIENTO_SEPTIEMBRE: "Lanzamiento septiembre",
  RESERVA_SEPTIEMBRE: "Reserva septiembre",
  NUEVOS_AMPLIACION_1000: "Nuevos · ampliación 1,000 créditos",
  RETENIDOS_REVISION: "Retenidos en revisión",
  SIN_LISTA: "Sin lista (pruebas internas)",
};

export const LEAD_GROUP_LABELS: Record<string, string> = {
  A_MANTENIMIENTO: "Grupo A · mantenimiento",
  B_PROYECTOS: "Grupo B · proyectos",
};

export const LEAD_STATE_LABELS: Record<string, string> = {
  queretaro: "Querétaro",
  jalisco: "Jalisco",
  guanajuato: "Guanajuato",
  michoacan: "Michoacán",
};

const countSchema = z.object({ key: z.string(), count: z.number() });
export type LeadCount = z.infer<typeof countSchema>;

const leadRowSchema = z.object({
  contact_id: z.uuid(),
  full_name: z.string().nullable().optional(),
  role_title: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  verified: z.boolean().nullable().optional(),
  account_id: z.uuid(),
  account: z.string().nullable().optional(),
  account_state: z.string().nullable().optional(),
  sector: z.string().nullable().optional(),
  tier: z.number().nullable().optional(),
  city: z.string().nullable().optional(),
  source_list: z.string().nullable().optional(),
  source_wave: z.string().nullable().optional(),
  source_group: z.string().nullable().optional(),
  source_origin: z.string().nullable().optional(),
  source_category: z.string().nullable().optional(),
  variant: z.string().nullable().optional(),
  stage: z.string(),
  enrollment_status: z.string().nullable().optional(),
  campaign: z.string().nullable().optional(),
  mailbox: z.string().nullable().optional(),
  next_touch_number: z.number().nullable().optional(),
  next_touch_at: z.string().nullable().optional(),
  last_touch: z.number().nullable().optional(),
  last_sent_at: z.string().nullable().optional(),
  first_sent_at: z.string().nullable().optional(),
  sends: z.number().default(0),
  opened: z.boolean().default(false),
  opens: z.number().default(0),
  replied_at: z.string().nullable().optional(),
  positive: z.boolean().default(false),
  reply_classification: z.string().nullable().optional(),
}).passthrough();
export type LeadRow = z.infer<typeof leadRowSchema>;

const companyRowSchema = z.object({
  account_id: z.uuid(),
  account: z.string().nullable().optional(),
  account_state: z.string().nullable().optional(),
  sector: z.string().nullable().optional(),
  tier: z.number().nullable().optional(),
  contacts: z.number(),
  enviados: z.number(),
  respondieron: z.number(),
  rebotes: z.number(),
  abrieron: z.number(),
  last_sent_at: z.string().nullable().optional(),
  max_touch: z.number().nullable().optional(),
  lists: z.string().nullable().optional(),
}).passthrough();
export type LeadCompanyRow = z.infer<typeof companyRowSchema>;

const statsSchema = z.object({
  total: z.number(), sin_enviar: z.number(), en_cola: z.number(), enviado: z.number(),
  toque_1: z.number(), toque_2: z.number(), toque_3: z.number(), toque_4: z.number(),
  toque_5: z.number(), toque_6: z.number(), toque_7: z.number(), toque_8: z.number(),
  abrieron: z.number(), respondio: z.number(), positivas: z.number(), reboto: z.number(), baja: z.number(), empresas: z.number(),
});
export type LeadStats = z.infer<typeof statsSchema>;

export const leadInventorySchema = z.object({
  total: z.number(),
  offset: z.number(),
  limit: z.number(),
  stats: statsSchema,
  rows: z.array(leadRowSchema).default([]),
  companies: z.array(companyRowSchema).default([]),
  total_companies: z.number().default(0),
  options: z.object({
    lists: z.array(countSchema).default([]),
    waves: z.array(countSchema).default([]),
    groups: z.array(countSchema).default([]),
    states: z.array(countSchema).default([]),
    tiers: z.array(countSchema).default([]),
    sectors: z.array(countSchema).default([]),
    campaigns: z.array(z.object({ id: z.uuid(), name: z.string(), state: z.string().nullable().optional() })).default([]),
  }).default({ lists: [], waves: [], groups: [], states: [], tiers: [], sectors: [], campaigns: [] }),
});
export type LeadInventory = z.infer<typeof leadInventorySchema>;

export type LeadQuery = {
  vista: LeadView;
  lista: string | null;
  ola: string | null;
  grupo: string | null;
  estado: string | null;
  tier: number | null;
  sector: string | null;
  campana: string | null;
  etapa: LeadStage;
  q: string;
  pagina: number;
};
export type LeadRequest = Partial<Record<"vista" | "lista" | "ola" | "grupo" | "estado" | "tier" | "sector" | "campana" | "etapa" | "q" | "pagina", string>>;

export type LeadInventoryPage = {
  evidenceClass: "live" | "synthetic_demo";
  generatedAt: string;
  query: LeadQuery;
  inventory: LeadInventory;
};

const uuidSchema = z.uuid();

function optionalText(value: string | undefined, max = 80): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed || trimmed === ALL || trimmed === "todas") return null;
  return trimmed.slice(0, max);
}

export function parseLeadQuery(requested: LeadRequest | undefined): LeadQuery {
  const r = requested ?? {};
  const tier = Number.parseInt(r.tier ?? "", 10);
  const pagina = Number.parseInt(r.pagina ?? "", 10);
  return {
    vista: (LEAD_VIEWS as readonly string[]).includes(r.vista ?? "") ? (r.vista as LeadView) : "contactos",
    lista: optionalText(r.lista),
    ola: optionalText(r.ola, 4),
    grupo: optionalText(r.grupo),
    estado: optionalText(r.estado),
    tier: Number.isInteger(tier) && tier > 0 && tier < 10 ? tier : null,
    sector: optionalText(r.sector, 120),
    campana: r.campana && uuidSchema.safeParse(r.campana).success ? r.campana : null,
    etapa: (LEAD_STAGES as readonly string[]).includes(r.etapa ?? "") ? (r.etapa as LeadStage) : "todos",
    q: (r.q ?? "").trim().slice(0, 80),
    pagina: Number.isInteger(pagina) && pagina > 1 ? Math.min(pagina, 1000) : 1,
  };
}

export function share(part: number, total: number): number | null {
  return total > 0 ? part / total : null;
}

export function stageLabel(row: Pick<LeadRow, "stage" | "last_touch">): string {
  if (row.stage.startsWith("TOQUE_")) return `Toque ${row.last_touch ?? row.stage.slice(6)} enviado`;
  return LEAD_STAGE_LABELS[row.stage]?.replace(/^Van en /u, "") ?? row.stage;
}

const emptyStats: LeadStats = {
  total: 0, sin_enviar: 0, en_cola: 0, enviado: 0, toque_1: 0, toque_2: 0, toque_3: 0, toque_4: 0, toque_5: 0, toque_6: 0, toque_7: 0, toque_8: 0,
  abrieron: 0, respondio: 0, positivas: 0, reboto: 0, baja: 0, empresas: 0,
};

/** Ejemplo operativo para la app sin Supabase (CI, demo): cuatro contactos inventados en distintas etapas. */
export function getSyntheticLeadInventoryPage(now = new Date(), requested?: LeadRequest): LeadInventoryPage {
  const query = parseLeadQuery(requested);
  const iso = (offsetHours: number) => new Date(now.getTime() - offsetHours * 3_600_000).toISOString();
  const all: LeadRow[] = [
    { contact_id: "11111111-1111-4111-8111-111111111111", full_name: "Persona de ejemplo 1", role_title: "Maintenance Manager", email: "ejemplo1@planta-alfa.example", verified: true, account_id: "21111111-1111-4111-8111-111111111111", account: "Planta Alfa (SIMULACION)", account_state: "Querétaro", sector: "automotive", tier: 1, source_list: "LANZAMIENTO_SEPTIEMBRE", source_wave: "1", source_group: "A_MANTENIMIENTO", variant: "MANTENIMIENTO", stage: "TOQUE_2", enrollment_status: "ACTIVE", campaign: "Campaña de ejemplo", mailbox: "buzon@ejemplo.test", next_touch_number: 3, next_touch_at: iso(-48), last_touch: 2, last_sent_at: iso(30), first_sent_at: iso(102), sends: 2, opened: true, opens: 3, positive: false },
    { contact_id: "11111111-1111-4111-8111-111111111112", full_name: "Persona de ejemplo 2", role_title: "Plant Manager", email: "ejemplo2@planta-beta.example", verified: true, account_id: "21111111-1111-4111-8111-111111111112", account: "Planta Beta (SIMULACION)", account_state: "Jalisco", sector: "machinery", tier: 2, source_list: "RESERVA_SEPTIEMBRE", source_group: "B_PROYECTOS", variant: "DIRECCION", stage: "SIN_ENVIAR", sends: 0, opened: false, opens: 0, positive: false },
    { contact_id: "11111111-1111-4111-8111-111111111113", full_name: "Persona de ejemplo 3", role_title: "Procurement Supervisor", email: "ejemplo3@planta-gamma.example", verified: true, account_id: "21111111-1111-4111-8111-111111111113", account: "Planta Gamma (SIMULACION)", account_state: "Guanajuato", sector: "plastics", tier: 1, source_list: "NUEVOS_AMPLIACION_1000", source_group: "A_MANTENIMIENTO", variant: "COMPRAS", stage: "RESPONDIO", enrollment_status: "REPLIED", campaign: "Campaña de ejemplo", mailbox: "buzon@ejemplo.test", last_touch: 1, last_sent_at: iso(80), first_sent_at: iso(80), sends: 1, opened: true, opens: 1, replied_at: iso(50), positive: true, reply_classification: "POSITIVE" },
    { contact_id: "11111111-1111-4111-8111-111111111114", full_name: "Persona de ejemplo 4", role_title: "Maintenance Supervisor", email: "ejemplo4@planta-delta.example", verified: true, account_id: "21111111-1111-4111-8111-111111111114", account: "Planta Delta (SIMULACION)", account_state: "Querétaro", sector: "automotive", tier: 1, source_list: "LANZAMIENTO_SEPTIEMBRE", source_wave: "2", source_group: "B_PROYECTOS", variant: "MANTENIMIENTO", stage: "REBOTO", enrollment_status: "BOUNCED", campaign: "Campaña de ejemplo", mailbox: "buzon@ejemplo.test", last_touch: 1, last_sent_at: iso(100), first_sent_at: iso(100), sends: 1, opened: false, opens: 0, positive: false },
  ];
  const scoped = all.filter((row) =>
    (!query.lista || (row.source_list ?? "SIN_LISTA") === query.lista)
    && (!query.grupo || row.source_group === query.grupo)
    && (!query.ola || row.source_wave === query.ola)
    && (!query.estado || (row.account_state ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/gu, "") === query.estado)
    && (query.tier === null || row.tier === query.tier)
    && (!query.sector || row.sector === query.sector)
    && (!query.q || `${row.account} ${row.full_name} ${row.email} ${row.role_title}`.toLowerCase().includes(query.q.toLowerCase())));
  const rows = scoped.filter((row) => matchesStage(row, query.etapa));
  const stats: LeadStats = {
    ...emptyStats,
    total: scoped.length,
    sin_enviar: scoped.filter((row) => row.stage === "SIN_ENVIAR").length,
    en_cola: scoped.filter((row) => row.stage === "EN_COLA").length,
    enviado: scoped.filter((row) => row.last_touch != null).length,
    toque_1: scoped.filter((row) => (row.last_touch ?? 0) >= 1).length,
    toque_2: scoped.filter((row) => (row.last_touch ?? 0) >= 2).length,
    abrieron: scoped.filter((row) => row.opened).length,
    respondio: scoped.filter((row) => row.stage === "RESPONDIO").length,
    positivas: scoped.filter((row) => row.positive).length,
    reboto: scoped.filter((row) => row.stage === "REBOTO").length,
    empresas: new Set(scoped.map((row) => row.account_id)).size,
  };
  const count = (key: (row: LeadRow) => string | null | undefined): LeadCount[] => {
    const map = new Map<string, number>();
    for (const row of all) { const k = key(row); if (k) map.set(k, (map.get(k) ?? 0) + 1); }
    return [...map.entries()].map(([k, n]) => ({ key: k, count: n })).sort((a, b) => a.key.localeCompare(b.key));
  };
  const companies = query.vista === "empresas" ? [...new Map(rows.map((row) => [row.account_id, row])).values()].map((row) => ({
    account_id: row.account_id, account: row.account, account_state: row.account_state, sector: row.sector, tier: row.tier,
    contacts: rows.filter((r) => r.account_id === row.account_id).length,
    enviados: rows.filter((r) => r.account_id === row.account_id && r.last_touch != null).length,
    respondieron: rows.filter((r) => r.account_id === row.account_id && r.stage === "RESPONDIO").length,
    rebotes: rows.filter((r) => r.account_id === row.account_id && r.stage === "REBOTO").length,
    abrieron: rows.filter((r) => r.account_id === row.account_id && r.opened).length,
    last_sent_at: row.last_sent_at ?? null, max_touch: row.last_touch ?? null, lists: row.source_list ?? "SIN_LISTA",
  })) : [];
  return {
    evidenceClass: "synthetic_demo",
    generatedAt: now.toISOString(),
    query,
    inventory: {
      total: rows.length, offset: 0, limit: LEAD_PAGE_SIZE, stats,
      rows: query.vista === "empresas" ? [] : rows, companies, total_companies: new Set(rows.map((row) => row.account_id)).size,
      options: {
        lists: count((row) => row.source_list ?? "SIN_LISTA"), waves: count((row) => row.source_wave), groups: count((row) => row.source_group),
        states: count((row) => (row.account_state ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/gu, "")), tiers: count((row) => row.tier?.toString()), sectors: count((row) => row.sector),
        campaigns: [{ id: "31111111-1111-4111-8111-111111111111", name: "Campaña de ejemplo", state: "RUNNING" }],
      },
    },
  };
}

export function matchesStage(row: Pick<LeadRow, "stage" | "last_touch">, stage: LeadStage): boolean {
  if (stage === "todos") return true;
  if (stage === "ENVIADO") return row.last_touch != null;
  if (stage === "PENDIENTE") return row.last_touch == null && !["REBOTO", "BAJA", "RESPONDIO"].includes(row.stage);
  return row.stage === stage;
}

export async function loadLeadInventoryPage(access: OperationsAccessContext, requested: LeadRequest | undefined): Promise<LeadInventoryPage> {
  const now = new Date();
  if (access.evidenceClass !== "live" || !access.organizationId) return getSyntheticLeadInventoryPage(now, requested);
  const query = parseLeadQuery(requested);
  const client = await createSupabaseServerClient();
  const args: Record<string, string | number | boolean> = {
    target_organization_id: access.organizationId,
    page_limit: LEAD_PAGE_SIZE,
    page_offset: (query.pagina - 1) * LEAD_PAGE_SIZE,
    group_by_company: query.vista === "empresas",
  };
  if (query.lista) args.target_list = query.lista;
  if (query.ola) args.target_wave = query.ola;
  if (query.grupo) args.target_group = query.grupo;
  if (query.estado) args.target_state = query.estado;
  if (query.tier !== null) args.target_tier = query.tier;
  if (query.sector) args.target_sector = query.sector;
  if (query.campana) args.target_campaign_id = query.campana;
  if (query.etapa !== "todos") args.target_stage = query.etapa;
  if (query.q) args.search_text = query.q;
  const { data, error } = await client.rpc("read_lead_inventory", args);
  if (error) throw new Error("LEAD_INVENTORY_UNAVAILABLE");
  return { evidenceClass: "live", generatedAt: now.toISOString(), query, inventory: leadInventorySchema.parse(data) };
}
