import { z } from "zod";

import type { OperationsAccessContext } from "@/lib/auth/authorization";
import { getSyntheticDirectLaneOverview } from "@/lib/correos/overview";
import { addDays, cdmxDateToUtcIso, weekStartCdmx } from "@/lib/correos/stats";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Pantalla Actividad (/operacion/correos/actividad): todo lo que salió, entró
 * y falló en el carril directo, en un periodo, con filtros por buzón, tipo de
 * mensaje, estado, campaña y texto. Una sola lectura por carga; los conteos
 * (por tipo, estado, buzón y día) vienen del mismo filtro que la tabla.
 */

export const ACTIVITY_RANGES = ["hoy", "semana", "30", "todo"] as const;
export type ActivityRange = (typeof ACTIVITY_RANGES)[number];

export const ACTIVITY_KINDS = ["todos", "TOUCH", "TOUCH_1", "TOUCH_2", "TOUCH_3", "TOUCH_4", "TOUCH_5", "TOUCH_6", "TOUCH_7", "TOUCH_8", "REPLY", "INBOUND"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_STATUSES = ["todos", "SENT", "DELIVERED", "QUEUED", "SENDING", "FAILED", "BOUNCED", "QUARANTINED", "DRY_RUN"] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export const ACTIVITY_LIMIT = 300;

const activityRowSchema = z.object({
  message_id: z.uuid(),
  direction: z.enum(["OUTBOUND", "INBOUND"]),
  status: z.string(),
  touch_number: z.number().nullable().optional(),
  kind: z.enum(["INBOUND", "REPLY", "TOUCH"]),
  mailbox_email: z.string().nullable().optional(),
  counterparty: z.string().nullable().optional(),
  account: z.string().nullable().optional(),
  account_state: z.string().nullable().optional(),
  contact: z.string().nullable().optional(),
  role_title: z.string().nullable().optional(),
  subject: z.string().nullable().optional(),
  created_at: z.string(),
  sent_at: z.string().nullable().optional(),
  cc: z.array(z.string()).nullable().optional(),
  opened_at: z.string().nullable().optional(),
  open_count: z.number().nullable().optional(),
  open_tracked: z.boolean().nullable().optional(),
  campaign: z.string().nullable().optional(),
  last_error: z.string().nullable().optional(),
}).passthrough();
export type DirectLaneActivityRow = z.infer<typeof activityRowSchema>;

const countSchema = z.object({ key: z.string(), count: z.number() });
export type ActivityCount = z.infer<typeof countSchema>;

export const directLaneActivitySchema = z.object({
  since: z.string(),
  until: z.string(),
  total: z.number(),
  rows: z.array(activityRowSchema).default([]),
  by: z.object({
    kind: z.array(countSchema).default([]),
    status: z.array(countSchema).default([]),
    mailbox: z.array(countSchema).default([]),
    day: z.array(countSchema).default([]),
  }).default({ kind: [], status: [], mailbox: [], day: [] }),
  options: z.object({
    mailboxes: z.array(z.object({ id: z.uuid(), email: z.string() })).default([]),
    campaigns: z.array(z.object({ id: z.uuid(), name: z.string(), state: z.string().nullable().optional() })).default([]),
  }).default({ mailboxes: [], campaigns: [] }),
});
export type DirectLaneActivity = z.infer<typeof directLaneActivitySchema>;

export type ActivityQuery = {
  rango: ActivityRange;
  /** uuid del buzón o null = todos. */
  buzon: string | null;
  tipo: ActivityKind;
  estado: ActivityStatus;
  /** uuid de la campaña o null = todas. */
  campana: string | null;
  q: string;
};

export type ActivityRequest = { rango?: string; buzon?: string; tipo?: string; estado?: string; campana?: string; q?: string };

export type DirectLaneActivityPage = {
  evidenceClass: "live" | "synthetic_demo";
  generatedAt: string;
  query: ActivityQuery;
  period: { since: string; until: string };
  activity: DirectLaneActivity;
};

const uuidSchema = z.uuid();

function optionalUuid(value: string | undefined): string | null {
  return value && uuidSchema.safeParse(value).success ? value : null;
}

export function parseActivityQuery(requested: ActivityRequest | undefined): ActivityQuery {
  const r = requested ?? {};
  return {
    rango: (ACTIVITY_RANGES as readonly string[]).includes(r.rango ?? "") ? (r.rango as ActivityRange) : "semana",
    buzon: optionalUuid(r.buzon),
    tipo: (ACTIVITY_KINDS as readonly string[]).includes(r.tipo ?? "") ? (r.tipo as ActivityKind) : "todos",
    estado: (ACTIVITY_STATUSES as readonly string[]).includes(r.estado ?? "") ? (r.estado as ActivityStatus) : "todos",
    campana: optionalUuid(r.campana),
    q: (r.q ?? "").trim().slice(0, 80),
  };
}

/** Fecha civil de hoy en CDMX (YYYY-MM-DD). */
export function todayCdmx(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Ventana del periodo en UTC; "hoy" y "semana" anclan a medianoche CDMX. */
export function activityWindow(range: ActivityRange, now: Date): { since: string; until: string } {
  const until = now.toISOString();
  if (range === "hoy") return { since: cdmxDateToUtcIso(todayCdmx(now)), until };
  if (range === "30") return { since: new Date(now.getTime() - 30 * 86_400_000).toISOString(), until };
  if (range === "todo") return { since: cdmxDateToUtcIso(addDays(weekStartCdmx(now), -52 * 7)), until };
  return { since: cdmxDateToUtcIso(weekStartCdmx(now)), until };
}

export function kindKey(row: Pick<DirectLaneActivityRow, "kind" | "touch_number">): string {
  return row.kind === "TOUCH" ? `TOUCH_${row.touch_number ?? "?"}` : row.kind;
}

function matchesQuery(row: DirectLaneActivityRow, query: ActivityQuery): boolean {
  if (query.tipo !== "todos" && query.tipo !== row.kind && query.tipo !== kindKey(row)) return false;
  if (query.estado !== "todos" && query.estado !== row.status) return false;
  if (query.q) {
    const needle = query.q.toLowerCase();
    const haystack = [row.account, row.contact, row.counterparty, row.subject].filter(Boolean).join(" ").toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

function countBy(rows: DirectLaneActivityRow[], key: (row: DirectLaneActivityRow) => string): ActivityCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  return [...counts.entries()].map(([k, count]) => ({ key: k, count })).sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Ejemplo operativo para la app sin Supabase (CI, demo): reutiliza los mensajes
 * sintéticos de la pantalla Correos y aplica los mismos filtros en memoria.
 */
export function getSyntheticDirectLaneActivityPage(now = new Date(), requested?: ActivityRequest): DirectLaneActivityPage {
  const query = parseActivityQuery(requested);
  const period = activityWindow(query.rango, now);
  const overview = getSyntheticDirectLaneOverview(now);
  const rows = overview.recent_messages
    .map((message) => activityRowSchema.parse({ ...message, account_state: "Querétaro", role_title: "Maintenance Manager", campaign: overview.campaigns[0]?.name ?? null }))
    .filter((row) => matchesQuery(row, query));
  return {
    evidenceClass: "synthetic_demo",
    generatedAt: now.toISOString(),
    query,
    period,
    activity: {
      since: period.since, until: period.until, total: rows.length, rows,
      by: {
        kind: countBy(rows, kindKey),
        status: countBy(rows, (row) => row.status),
        mailbox: countBy(rows, (row) => row.mailbox_email ?? "?"),
        day: countBy(rows, (row) => todayCdmx(new Date(row.created_at))),
      },
      options: {
        mailboxes: overview.mailboxes.map((mailbox) => ({ id: mailbox.mailbox_id, email: mailbox.normalized_email })),
        campaigns: overview.campaigns.map((campaign) => ({ id: campaign.campaign_id, name: campaign.name, state: campaign.state })),
      },
    },
  };
}

export async function loadDirectLaneActivityPage(access: OperationsAccessContext, requested: ActivityRequest | undefined): Promise<DirectLaneActivityPage> {
  const now = new Date();
  if (access.evidenceClass !== "live" || !access.organizationId) return getSyntheticDirectLaneActivityPage(now, requested);
  const query = parseActivityQuery(requested);
  const period = activityWindow(query.rango, now);
  const client = await createSupabaseServerClient();
  const args: Record<string, string | number> = {
    target_organization_id: access.organizationId,
    since_at: period.since,
    until_at: period.until,
    page_limit: ACTIVITY_LIMIT,
  };
  if (query.buzon) args.target_mailbox_id = query.buzon;
  if (query.tipo !== "todos") args.target_kind = query.tipo;
  if (query.estado !== "todos") args.target_status = query.estado;
  if (query.campana) args.target_campaign_id = query.campana;
  if (query.q) args.search_text = query.q;
  const { data, error } = await client.rpc("read_direct_lane_activity", args);
  if (error) throw new Error("DIRECT_LANE_ACTIVITY_UNAVAILABLE");
  return { evidenceClass: "live", generatedAt: now.toISOString(), query, period, activity: directLaneActivitySchema.parse(data) };
}
