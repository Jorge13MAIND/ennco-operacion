import type { OperationsAccessContext } from "@/lib/auth/authorization";
import { crmBoardSchema, crmDetailSchema, type CrmBoardData, type CrmDetail } from "@/lib/crm/model";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Lecturas del CRM (/operacion/crm). En vivo usan las RPC read_crm y read_crm_record con la sesión
 * del usuario (migración 109); fuera de producción regresan un ejemplo marcado SIMULACION.
 */
export type CrmScreen = CrmBoardData & { evidenceClass: OperationsAccessContext["evidenceClass"]; me: string | null; canEdit: boolean };

export async function loadCrm(access: OperationsAccessContext): Promise<CrmScreen> {
  const canEdit = access.evidenceClass === "live" && access.role !== "auditor_readonly";
  if (access.evidenceClass !== "live" || !access.organizationId) {
    return { ...syntheticBoard(), evidenceClass: access.evidenceClass, me: SYNTHETIC_USER, canEdit: false };
  }
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("read_crm", { target_organization_id: access.organizationId });
  if (error) throw new Error("CRM_READ_FAILED");
  return { ...crmBoardSchema.parse(data), evidenceClass: "live", me: access.userId, canEdit };
}

export async function loadCrmRecord(access: OperationsAccessContext, recordId: string): Promise<CrmDetail> {
  if (access.evidenceClass !== "live" || !access.organizationId) {
    const record = syntheticBoard().records.find((r) => r.id === recordId);
    if (!record) throw new Error("CRM_RECORD_NOT_FOUND");
    return { record, activities: [], tasks: [], emails: [] };
  }
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("read_crm_record", { target_organization_id: access.organizationId, target_record_id: recordId });
  if (error) throw new Error("CRM_RECORD_READ_FAILED");
  return crmDetailSchema.parse(data);
}

const SYNTHETIC_USER = "00000000-0000-4000-8000-0000000000a1";

function syntheticBoard(): CrmBoardData {
  const now = Date.now();
  const iso = (hours: number) => new Date(now + hours * 3_600_000).toISOString();
  const base = {
    contact_id: null, account_id: null, source: "CORREO" as const, phone: null, city: "Querétaro", state: "Querétaro",
    owner_user_id: SYNTHETIC_USER, owner_email: "oscar.ojeda@ennco.com.mx", service_interest: null, value_mxn: null,
    next_action: null, next_action_at: null, close_reason: null, qualification: {}, last_touch_at: null,
    mailbox_email: "contacto@ennco.com.mx", open_tasks: 0, next_task_at: null, revision: 1,
    industrial_park: null, address: null, sector: null, source_url: null, import_batch: null, in_email_campaign: true,
  };
  const rows = [
    { name: "SIMULACION Ana Pérez", company: "SIMULACION Planta Norte", stage: "RESPONDIO", intent: "POSITIVE_VISIT", body: "¿Podemos hablar el jueves a las 10?", hours: -3 },
    { name: "SIMULACION Luis Gómez", company: "SIMULACION Alimentos del Bajío", stage: "CALIFICADO", intent: "POSITIVE_ACCEPT", body: "Sí, mándame la propuesta.", hours: -30, next: "Llamar para agendar el levantamiento", nextAt: 20, value: 180000 },
    { name: "SIMULACION Marta Ruiz", company: "SIMULACION Plásticos Querétaro", stage: "PROPUESTA", intent: "POSITIVE_VISIT", body: "Vengan el martes a la planta.", hours: -120, next: "Seguimiento a la cotización", nextAt: -5, value: 420000 },
    { name: "SIMULACION Jorge Díaz", company: "SIMULACION Metalúrgica Celaya", stage: "DESCARTADO", intent: "REJECTION", body: "No nos interesa, gracias.", hours: -48, reason: "No le interesa" },
    { name: null, company: "SIMULACION Autopartes del Bajío", stage: "POR_CONTACTAR", intent: null, body: null, hours: -2, directory: true },
  ] as const;
  return {
    records: rows.map((row, index) => ({
      ...base,
      ...("directory" in row ? { source: "DIRECTORIO" as const, city: "Silao", industrial_park: "SIMULACION Puerto Interior", sector: "Automotriz",
        address: "SIMULACION Av. Ejemplo 100", source_url: "https://ejemplo.test", import_batch: "Directorio de ejemplo", owner_email: "oscar.ojeda@ennco.com.mx",
        mailbox_email: null, first_reply_at: null, last_reply_at: null } : {}),
      id: `00000000-0000-4000-8000-00000000c00${index}`,
      full_name: row.name, email: row.name ? `simulacion${index}@ejemplo.test` : null, role_title: row.name ? "Gerente de mantenimiento" : null,
      company_name: row.company, stage: row.stage, reply_intent: row.intent, last_reply_body: row.body,
      first_reply_at: row.body ? iso(row.hours) : null, last_reply_at: row.body ? iso(row.hours) : null, created_at: iso(row.hours), updated_at: iso(row.hours),
      next_action: "next" in row ? row.next : null, next_action_at: "nextAt" in row ? iso(row.nextAt) : null,
      value_mxn: "value" in row ? row.value : null, close_reason: "reason" in row ? row.reason : null,
      qualification: row.stage === "RESPONDIO" || row.stage === "DESCARTADO" || row.stage === "POR_CONTACTAR" ? {} : { mercado: true, contacto: true, necesidad: true, avance: true },
    })),
    users: [{ id: SYNTHETIC_USER, email: "oscar.ojeda@ennco.com.mx", role: "ennco_admin" }],
    default_owner_user_id: SYNTHETIC_USER,
    generated_at: new Date(now).toISOString(),
  };
}
