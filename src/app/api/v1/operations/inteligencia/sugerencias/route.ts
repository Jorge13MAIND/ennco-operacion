import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/authorization";
import { classifyReply } from "@/lib/inteligencia/clasificador";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const privateHeaders = { "Cache-Control": "private, no-store" } as const;

/** Tope por corrida. La bandeja real nunca debería acercarse a esto. */
const BATCH_LIMIT = 200;

/**
 * Genera sugerencias para las respuestas que siguen sin clasificar.
 *
 * No toca provider_events.reply_classification: escribe en una tabla aparte de
 * propuestas. La decisión la sigue tomando un humano en el Control Room, que es
 * lo que exige el diseño del SLA.
 */
export async function POST(): Promise<NextResponse> {
  const access = await requireOperationsAccess();
  if (access.evidenceClass !== "live" || !access.organizationId) {
    return NextResponse.json({ error: "LIVE_ACCESS_REQUIRED" }, { status: 403, headers: privateHeaders });
  }

  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("provider_events")
    .select("id,message_id,observed_at")
    .eq("organization_id", access.organizationId)
    .eq("event_kind", "REPLY")
    .eq("reply_classification", "UNREVIEWED")
    .order("observed_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) return NextResponse.json({ error: "EVENTS_READ_FAILED" }, { status: 502, headers: privateHeaders });

  const events = (data ?? []).filter((row) => row.message_id !== null);
  if (events.length === 0) {
    return NextResponse.json({ state: "OK", written: 0, submitted: 0, reason: "SIN_RESPUESTAS_PENDIENTES" }, { status: 200, headers: privateHeaders });
  }

  const { data: messages } = await client
    .from("messages")
    .select("id,subject,body_text")
    .eq("organization_id", access.organizationId)
    .in("id", events.map((row) => String(row.message_id)));

  const byId = new Map((messages ?? []).map((row) => [String(row.id), row]));

  const suggestions = events.map((event) => {
    const message = byId.get(String(event.message_id));
    const result = classifyReply({
      subject: (message?.subject as string | null) ?? null,
      body: (message?.body_text as string | null) ?? null,
    });
    return {
      provider_event_id: event.id,
      intent: result.intent,
      classification: result.classification,
      confidence: result.confidence,
      signals: result.signals,
      needs_human_now: result.needs_human_now,
      classifier_version: result.classifier_version,
    };
  });

  const { data: written, error: writeError } = await client.rpc("upsert_reply_suggestions", {
    target_organization_id: access.organizationId,
    target_suggestions: suggestions,
  });

  if (writeError) {
    return NextResponse.json({ error: "SUGGESTIONS_WRITE_REJECTED", reason: writeError.message.slice(0, 120) }, { status: 422, headers: privateHeaders });
  }

  return NextResponse.json({ state: "OK", ...(written as Record<string, unknown>) }, { status: 200, headers: privateHeaders });
}
