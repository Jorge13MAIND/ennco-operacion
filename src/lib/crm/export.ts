import { INTENT_LABELS, SERVICE_LABELS, SOURCE_LABELS, STAGE_LABELS, formatDateTime, isQualified, personName, type CrmRecord } from "@/lib/crm/model";
import type { Cell } from "@/lib/precios/xlsx";

/** Filas del Excel del CRM, con encabezados en español. */
export function crmWorkbookRows(records: CrmRecord[]): Cell[][] {
  const header = ["Nombre", "Empresa", "Puesto", "Correo", "Teléfono", "Ciudad", "Estado", "Etapa", "Responsable", "Calificado",
    "Siguiente acción", "Fecha de la siguiente acción", "Servicio", "Valor MXN", "Motivo de cierre", "Clasificación de la respuesta",
    "Última respuesta", "Origen", "Parque o zona industrial", "Dirección", "Sector o nota", "Fuente", "También en campaña de correo"];
  return [header, ...records.map((r) => [
    r.full_name, r.company_name, r.role_title, r.email, r.phone, r.city, r.state, STAGE_LABELS[r.stage], personName(r.owner_email),
    isQualified(r) ? "Sí" : "No", r.next_action, formatDateTime(r.next_action_at),
    r.service_interest ? SERVICE_LABELS[r.service_interest] : null, r.value_mxn, r.close_reason,
    r.reply_intent ? INTENT_LABELS[r.reply_intent] ?? r.reply_intent : null, formatDateTime(r.last_reply_at),
    SOURCE_LABELS[r.source], r.industrial_park, r.address, r.sector, r.source_url, r.in_email_campaign ? "Sí" : "No",
  ])];
}
