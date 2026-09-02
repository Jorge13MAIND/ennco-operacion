import { z } from "zod";

import type { OperationsAccessContext } from "@/lib/auth/authorization";
import { directLaneHealthSchema } from "@/lib/correos/client";
import { getRuntimeConfig } from "@/lib/runtime/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Lo que la pantalla "Correos" necesita en una sola lectura. En modo demo se
 * devuelve un escenario sintético marcado como tal: prueba el flujo, no
 * representa buzones ni prospectos reales.
 */

const campaignSchema = z.object({
  campaign_id: z.uuid(),
  name: z.string(),
  state: z.enum(["DRAFT", "RUNNING", "PAUSED", "COMPLETED"]),
  approved_at: z.string().nullable().optional(),
  created_at: z.string(),
  manifest_sha256: z.string(),
  cc_on_reply_email: z.string().nullable().optional(),
  enrollments: z.record(z.string(), z.number()).default({}),
  by_variant: z.record(z.string(), z.number()).default({}),
}).passthrough();

const messageSchema = z.object({
  message_id: z.uuid(),
  direction: z.enum(["OUTBOUND", "INBOUND"]),
  status: z.string(),
  touch_number: z.number().nullable().optional(),
  kind: z.enum(["INBOUND", "REPLY", "TOUCH"]),
  mailbox_email: z.string().nullable().optional(),
  counterparty: z.string().nullable().optional(),
  account: z.string().nullable().optional(),
  contact: z.string().nullable().optional(),
  subject: z.string().nullable().optional(),
  created_at: z.string(),
  sent_at: z.string().nullable().optional(),
  cc: z.array(z.string()).nullable().optional(),
  last_error: z.string().nullable().optional(),
}).passthrough();

const pendingReplySchema = z.object({
  provider_event_id: z.uuid(),
  classification: z.string(),
  observed_at: z.string(),
  message_id: z.uuid().nullable().optional(),
  subject: z.string().nullable().optional(),
  body_text: z.string().nullable().optional(),
  from_email: z.string().nullable().optional(),
  mailbox_email: z.string().nullable().optional(),
  account: z.string().nullable().optional(),
  contact: z.string().nullable().optional(),
  role_title: z.string().nullable().optional(),
  already_answered: z.boolean().default(false),
}).passthrough();

export const directLaneOverviewSchema = directLaneHealthSchema.extend({
  campaigns: z.array(campaignSchema).default([]),
  enrollable_contacts: z.number().default(0),
  unverified_contacts: z.number().default(0),
  recent_messages: z.array(messageSchema).default([]),
  pending_replies: z.array(pendingReplySchema).default([]),
  upcoming: z.array(z.object({ day: z.string(), touches: z.number() })).default([]),
  recent_ticks: z.array(z.object({ tick_kind: z.string(), outcome: z.string(), created_at: z.string(), mailbox_id: z.uuid().nullable().optional(), detail: z.unknown().optional() })).default([]),
});

export type DirectLaneOverview = z.infer<typeof directLaneOverviewSchema>;

export type DirectLaneScreen = {
  evidenceClass: "synthetic_demo" | "live";
  generatedAt: string;
  mode: "shadow" | "live";
  released: boolean;
  overview: DirectLaneOverview;
  canApprove: boolean;
};

export function getSyntheticDirectLaneOverview(now = new Date()): DirectLaneOverview {
  const iso = (offsetMinutes: number) => new Date(now.getTime() + offsetMinutes * 60_000).toISOString();
  return directLaneOverviewSchema.parse({
    mailboxes: [
      {
        mailbox_id: "41000000-0000-4000-8000-000000000201", normalized_email: "francisco@enncoindustrial.com", domain: "enncoindustrial.com",
        sender_name: "Francisco Cuellar", status: "CONNECTED", credential_active: true, credential_connected_at: iso(-3_000),
        ramp_mode: "AUTO", fixed_cap: 5, cap_max: 40, effective_cap: 5, sent_today: 2, queued: 1, sent_total: 9, first_send_at: iso(-4_320),
        is_client_primary: false, sync: { status: "READY", last_history_id: "412", last_synced_at: iso(-4), last_error_code: null }, pending_invitation: null, last_error: null,
      },
      {
        mailbox_id: "41000000-0000-4000-8000-000000000202", normalized_email: "fcuellar@enncoindustrial.com", domain: "enncoindustrial.com",
        sender_name: "Francisco Cuellar", status: "DISCONNECTED", credential_active: false, ramp_mode: "AUTO", fixed_cap: 5, cap_max: 40,
        effective_cap: 5, sent_today: 0, queued: 0, sent_total: 0, is_client_primary: false, sync: null,
        pending_invitation: { expires_at: iso(60 * 24 * 6), status: "PENDING", created_at: iso(-30) }, last_error: null,
      },
      {
        mailbox_id: "41000000-0000-4000-8000-000000000203", normalized_email: "francisco@enncoenergia.com", domain: "enncoenergia.com",
        sender_name: "Francisco Cuellar", status: "PAUSED", credential_active: true, credential_connected_at: iso(-2_000),
        ramp_mode: "FIXED", fixed_cap: 10, cap_max: 40, effective_cap: 10, sent_today: 0, queued: 0, sent_total: 3, is_client_primary: false,
        sync: { status: "READY", last_history_id: "88", last_synced_at: iso(-9), last_error_code: null }, pending_invitation: null, last_error: null,
      },
      {
        mailbox_id: "41000000-0000-4000-8000-000000000204", normalized_email: "contacto@ennco.com.mx", domain: "ennco.com.mx",
        sender_name: "Francisco Cuellar", status: "DISCONNECTED", credential_active: false, ramp_mode: "AUTO", fixed_cap: 5, cap_max: 20,
        effective_cap: 5, sent_today: 0, queued: 0, sent_total: 0, is_client_primary: true, sync: null, pending_invitation: null, last_error: null,
      },
    ],
    totals: { sent_today: 2, shadow_today: 0, queued: 1, failed_today: 0, sent_total: 12, replies_unreviewed: 1, due_now: 3 },
    flags: { global_kill_switch: false, external_send_allowed: true, annex_a_ready: true, send_window_open: true, running_campaigns: 1 },
    last_tick: { tick_kind: "CLAIM", outcome: "CLAIMED_TOUCH", created_at: iso(-2), mailbox_id: "41000000-0000-4000-8000-000000000201" },
    campaigns: [{
      campaign_id: "41000000-0000-4000-8000-000000000301", name: "ENNCO · Bajío industrial · septiembre", state: "RUNNING",
      approved_at: iso(-5_000), created_at: iso(-5_100), manifest_sha256: "c".repeat(64), cc_on_reply_email: "francisco.cuellar@ennco.com.mx",
      enrollments: { PENDING: 14, ACTIVE: 9, REPLIED: 2, COMPLETED: 0, PAUSED: 1 },
      by_variant: { DIRECCION: 8, MANTENIMIENTO: 11, SEGURIDAD: 3, COMPRAS: 4 },
    }],
    enrollable_contacts: 37,
    unverified_contacts: 12,
    recent_messages: [
      { message_id: "41000000-0000-4000-8000-000000000501", direction: "INBOUND", status: "DELIVERED", touch_number: null, kind: "INBOUND", mailbox_email: "francisco@enncoindustrial.com", counterparty: "compras@simulacion.invalid", account: "SIMULACION Autopartes del Bajío", contact: "Juan Pérez", subject: "Re: Lo que le costó un apagón a un cliente", created_at: iso(-35), sent_at: iso(-35), cc: [], last_error: null },
      { message_id: "41000000-0000-4000-8000-000000000502", direction: "OUTBOUND", status: "SENT", touch_number: 1, kind: "TOUCH", mailbox_email: "francisco@enncoindustrial.com", counterparty: "compras@simulacion.invalid", account: "SIMULACION Autopartes del Bajío", contact: "Juan Pérez", subject: "Lo que le costó un apagón a un cliente", created_at: iso(-1_500), sent_at: iso(-1_500), cc: [], last_error: null },
      { message_id: "41000000-0000-4000-8000-000000000503", direction: "OUTBOUND", status: "QUEUED", touch_number: null, kind: "REPLY", mailbox_email: "francisco@enncoindustrial.com", counterparty: "mantenimiento@simulacion.invalid", account: "SIMULACION Papelera del Centro", contact: "Ana Ruiz", subject: "Re: El tablero que nadie abre", created_at: iso(-8), sent_at: null, cc: ["francisco.cuellar@ennco.com.mx"], last_error: null },
    ],
    pending_replies: [{
      provider_event_id: "41000000-0000-4000-8000-000000000601", classification: "UNREVIEWED", observed_at: iso(-35), message_id: "41000000-0000-4000-8000-000000000501",
      subject: "Re: Lo que le costó un apagón a un cliente", body_text: "Hola Francisco, sí me interesa. ¿Me mandas el formato del reporte? Con mantenimiento habla Luis Ortega.",
      from_email: "compras@simulacion.invalid", mailbox_email: "francisco@enncoindustrial.com", account: "SIMULACION Autopartes del Bajío", contact: "Juan Pérez", role_title: "Purchasing Manager", already_answered: false,
    }],
    upcoming: [{ day: now.toISOString().slice(0, 10), touches: 3 }, { day: new Date(now.getTime() + 86_400_000 * 3).toISOString().slice(0, 10), touches: 9 }],
    recent_ticks: [{ tick_kind: "CLAIM", outcome: "CLAIMED_TOUCH", created_at: iso(-2), mailbox_id: "41000000-0000-4000-8000-000000000201", detail: { touch: 1 } }],
  });
}

export async function loadDirectLaneScreen(access: OperationsAccessContext): Promise<DirectLaneScreen> {
  const config = getRuntimeConfig();
  const base = { generatedAt: new Date().toISOString(), mode: config.directLaneMode, released: config.directLaneReleased };
  if (access.evidenceClass !== "live" || !access.organizationId) {
    return { ...base, evidenceClass: "synthetic_demo", overview: getSyntheticDirectLaneOverview(), canApprove: true };
  }
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("read_direct_lane_overview", { target_organization_id: access.organizationId });
  if (error) throw new Error("DIRECT_LANE_OVERVIEW_UNAVAILABLE");
  return {
    ...base,
    evidenceClass: "live",
    overview: directLaneOverviewSchema.parse(data),
    canApprove: access.role === "teckel_admin",
  };
}
