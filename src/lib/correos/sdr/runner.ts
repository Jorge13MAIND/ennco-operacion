import { readDirectLaneCredential, recordEmailRecovery } from "@/lib/correos/client";
import { openDirectLaneSecret } from "@/lib/correos/vault";
import { applyDispatchProviderEvent } from "@/lib/dispatch/client";
import { getGmailAccessToken } from "@/lib/dispatch/gmail-token";
import { extractReplyText } from "@/lib/gmail/body";
import type { RuntimeConfig } from "@/lib/runtime/config";
import { sdrCommand, sdrEnvironment, workSchema, type SdrWorkItem } from "@/lib/correos/sdr/client";
import { POLICY_VERSION, deterministicProposal, evaluateConversation, evaluateProposal, proposalSchema, threadSchema, unsubscribeRequested } from "@/lib/correos/sdr/policy";
import { proposeWithModel } from "@/lib/correos/sdr/model";

export async function readSdrThread(token: string, threadId: string) {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/threads/" + encodeURIComponent(threadId) + "?format=full", {
    headers: { authorization: "Bearer " + token }, cache: "no-store", signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("SDR_THREAD_UNAVAILABLE");
  return threadSchema.parse(await response.json());
}
export async function sdrMailboxToken(config: RuntimeConfig, item: SdrWorkItem) {
  if (!config.directLaneVaultKey || !config.googleOauthClientId || !config.googleOauthClientSecret) throw new Error("SDR_GMAIL_CONFIG_MISSING");
  const credential = await readDirectLaneCredential(config, item.mailbox_id);
  if (credential.normalized_email !== item.mailbox_email) throw new Error("SDR_MAILBOX_MISMATCH");
  const refreshToken = openDirectLaneSecret({ ciphertext: credential.ciphertext, keyId: credential.key_id }, config.directLaneVaultKey);
  const token = await getGmailAccessToken({ refreshToken, credentialSha256: credential.credential_sha256, clientId: config.googleOauthClientId, clientSecret: config.googleOauthClientSecret });
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { authorization: "Bearer " + token }, signal: AbortSignal.timeout(15000), cache: "no-store" });
  if (!response.ok || (await response.json()).emailAddress?.toLowerCase() !== item.mailbox_email.toLowerCase()) throw new Error("SDR_PROFILE_MISMATCH");
  return token;
}
const nextActions: Record<string, string> = {
  CONTEXT: "Revisar borrador de contexto. No contabilizar como interés explícito ni lead",
  EXPLICIT_INTEREST: "Validar interés documentado y preguntar por la necesidad. Calificación contractual humana",
  WRONG_PERSON: "Corregir identidad y ubicación. Cerrar esta campaña para esta persona; no contactar referidos automáticamente",
  NOT_NOW: "Mantener detenida la secuencia. Revisar respuesta breve y registrar si el contacto indica cuándo retomar",
  REJECTION: "Mantener detenida la secuencia. Revisar respuesta de cierre",
  REFERRAL: "Validar identidad y autorización del referido antes de cualquier contacto",
  PRICE: "Paco debe revisar precio y condiciones. No cotizar automáticamente",
  OUT_OF_OFFICE: "Revisar fecha de regreso. No enviar seguimientos hasta validarla",
  COMPLAINT: "Escalar queja a revisión humana. No enviar automáticamente",
  TECHNICAL_COMMITMENT: "Validación técnica y comercial humana antes de responder",
  AMBIGUOUS: "Leer conversación completa y definir siguiente acción",
};
export async function runEmailSdr(config: RuntimeConfig) {
  const environment = sdrEnvironment();
  if (!environment.serviceSecret) return { state: "HOLD", reason: "SDR_SERVICE_NOT_CONFIGURED" };
  const work = workSchema.parse(await sdrCommand(config, { op: "WORK" }));
  if (work.policy_version !== POLICY_VERSION) throw new Error("SDR_POLICY_VERSION_MISMATCH");
  const startedAt = Date.now();
  const results: Array<{ case_id: string; state: string; reason?: string }> = [];
  for (const item of work.cases) {
    if (Date.now() - startedAt > 150000) break; // Unprocessed leases expire before the next five-minute tick.
    try {
      if (!item.provider_thread_id || !item.provider_message_id) throw new Error("SDR_THREAD_ID_MISSING");
      const token = await sdrMailboxToken(config, item);
      const thread = await readSdrThread(token, item.provider_thread_id);
      const capturedAt = Date.now();
      const incoming = thread.messages.find(m => m.id === item.provider_message_id);
      const body = incoming ? extractReplyText(incoming) : null;
      if (!body) throw new Error("SDR_BODY_MISSING");
      await recordEmailRecovery(config, item.mailbox_id, { kind: "MESSAGE", event_id: item.event_id,
        provider_message_id: item.provider_message_id, provider_thread_id: item.provider_thread_id, body_text: body,
        rfc_message_id: incoming?.payload.headers.find(h => h.name.toLowerCase() === "message-id")?.value ?? null, thread });
      const context = evaluateConversation({ body, providerMessageId: item.provider_message_id, providerThreadId: item.provider_thread_id,
        mailboxEmail: item.mailbox_email, contactEmail: item.contact_email, ownerId: item.owner_id, suppressed: item.suppressed,
        thread, ownSdrMessageIds: item.own_sdr_message_ids, now: Date.now(), capturedAt });
      const identityUncertain = context.gates.some(g => ["THREAD_IDENTITY_MISMATCH", "SENDER_IDENTITY_UNCERTAIN", "MAILBOX_IDENTITY_UNCERTAIN", "BODY_MISSING", "BODY_CHANGED"].includes(g));
      if (unsubscribeRequested(body) && !identityUncertain) {
        await applyDispatchProviderEvent(config, { mailboxId: item.mailbox_id, externalEventId: "sdr-unsubscribe:" + item.provider_message_id,
          providerMessageId: item.provider_message_id, relatedOutboundMessageId: item.related_outbound_id, eventKind: "UNSUBSCRIBE",
          normalizedFrom: item.contact_email, subject: "Baja solicitada por email", bodyText: body, observedAtEpoch: Math.floor(Number(incoming!.internalDate) / 1000) });
        await sdrCommand(config, { op: "SUPPRESSED", case_id: item.case_id });
        results.push({ case_id: item.case_id, state: "SUPPRESSED" }); continue;
      }
      let proposal = deterministicProposal(body);
      let modelSource = "RULES_REVIEW_ONLY";
      let modelGate = "MODEL_NOT_CONFIGURED";
      const previous = proposalSchema.safeParse(item.decision?.proposal);
      if ((item.approved || item.followup) && previous.success) {
        proposal = previous.data; modelSource = String(item.decision?.model_source ?? "RULES_REVIEW_ONLY");
        modelGate = modelSource === "OPENAI" ? "" : "MODEL_NOT_CONFIGURED";
      } else if (environment.apiKey && environment.model && work.mode !== "PAUSED" && context.gates.length === 0) {
        const slot = await sdrCommand(config, { op: "MODEL_SLOT" });
        if (slot.allowed === true) {
          proposal = await proposeWithModel({ latestReply: body, apiKey: environment.apiKey, model: environment.model,
            conversation: thread.messages.map(m => ({ direction: m.labelIds?.includes("SENT") ? "ENNCO" : "EXTERNAL", text: extractReplyText(m) ?? "[Sin texto: requiere revisión humana]" })) });
          modelSource = "OPENAI"; modelGate = "";
        } else modelGate = "MODEL_BUDGET_HOLD";
      }
      if (item.event_kind === "AUTO_REPLY") proposal = { ...proposal, intent: "OUT_OF_OFFICE", draft: "", escalation_reason: "Respuesta automática. Revisar fecha de regreso" };
      const evaluated = evaluateProposal(proposal, body);
      const gates = [...context.gates, ...evaluated.gates, ...(modelGate ? [modelGate] : []), ...(work.mode === "PAUSED" ? ["SDR_PAUSED"] : [])];
      const state = context.manualReply ? "MANUAL_HANDLED" : item.suppressed ? "NO_ACTION" : context.gates.length ? "BLOCKED" : "REVIEW";
      await sdrCommand(config, { op: "DECIDE", case_id: item.case_id, policy_version: POLICY_VERSION, state, thread_hash: context.threadHash,
        next_action: context.manualReply ? "Intervención humana encontrada en Gmail. Evitar respuesta duplicada" : nextActions[proposal.intent] ?? "Revisión humana requerida",
        decision: { intent: proposal.intent, eligible: gates.length === 0, gates, evidence: proposal.evidence, draft: evaluated.draft || proposal.draft,
          proposal, model_source: modelSource, model: modelSource === "OPENAI" ? environment.model : null, facts_version: POLICY_VERSION } });
      if (gates.length === 0) {
        const queued = await sdrCommand(config, { op: "QUEUE", case_id: item.case_id, thread_hash: context.threadHash, followup: item.followup });
        results.push({ case_id: item.case_id, state: String(queued.status), reason: typeof queued.reason === "string" ? queued.reason : undefined });
      } else results.push({ case_id: item.case_id, state, reason: gates.join(",") });
    } catch (error) {
      const reason = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "SDR_PROCESSING_FAILED";
      await sdrCommand(config, { op: "DECIDE", case_id: item.case_id, policy_version: POLICY_VERSION, state: "BLOCKED", thread_hash: null,
        next_action: "Resolver " + reason + " antes de responder", decision: { intent: "AMBIGUOUS", eligible: false, gates: [reason], evidence: [], draft: "" } });
      results.push({ case_id: item.case_id, state: "BLOCKED", reason });
    }
  }
  return { state: "PROCESSED", mode: work.mode, count: results.length, results };
}
