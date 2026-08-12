import { createHash } from "node:crypto";

import type { OperationsAccessContext } from "@/lib/auth/authorization";
import { createCsv } from "@/lib/exports/csv";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const EXPORT_DATASETS = ["companies-contacts", "pipeline-attribution"] as const;
export type ExportDataset = (typeof EXPORT_DATASETS)[number];

export function isExportDataset(value: string): value is ExportDataset {
  return (EXPORT_DATASETS as readonly string[]).includes(value);
}

type ExportArtifact = {
  datasetKey: "companies_contacts" | "pipeline_attribution";
  filename: string;
  csv: string;
  rowCount: number;
  sha256: string;
};

type DbRow = Record<string, unknown>;

function rows(value: unknown): DbRow[] {
  return Array.isArray(value) ? value.filter((item): item is DbRow => Boolean(item) && typeof item === "object") : [];
}

function makeArtifact(dataset: ExportArtifact["datasetKey"], filename: string, columns: string[], data: DbRow[]): ExportArtifact {
  const csv = createCsv(columns, data);
  return {
    datasetKey: dataset,
    filename,
    csv,
    rowCount: data.length,
    sha256: createHash("sha256").update(csv).digest("hex"),
  };
}

export function buildCompaniesContactsExportRows(accountsValue: unknown, contactsValue: unknown): DbRow[] {
  const accounts = rows(accountsValue);
  const contacts = rows(contactsValue);
  const contactsByAccount = new Map<string, DbRow[]>();
  for (const contact of contacts) {
    const accountId = String(contact.account_id);
    contactsByAccount.set(accountId, [...(contactsByAccount.get(accountId) ?? []), contact]);
  }
  return accounts.flatMap((account) => {
    const accountContacts = contactsByAccount.get(String(account.id)) ?? [null];
    return accountContacts.map((contact) => ({
      evidence_class: "live",
      account_name: account.legal_name,
      domain: account.primary_domain,
      state: account.state,
      sector: account.sector,
      source_confidence: account.source_confidence,
      contact_name: contact?.full_name,
      role_title: contact?.role_title,
      normalized_email: contact?.normalized_email,
      verified: contact?.verified,
    }));
  });
}

export async function createExportArtifact(dataset: ExportDataset, access: OperationsAccessContext): Promise<ExportArtifact> {
  if (access.evidenceClass === "synthetic_demo") {
    if (dataset === "companies-contacts") {
      return makeArtifact("companies_contacts", "ennco-empresas-contactos-synthetic-empty.csv", [
        "evidence_class", "account_name", "domain", "state", "sector", "source_confidence",
        "contact_name", "role_title", "normalized_email", "verified",
      ], []);
    }
    return makeArtifact("pipeline_attribution", "ennco-pipeline-atribucion-synthetic-empty.csv", [
      "evidence_class", "account_name", "stage", "value_mxn", "next_action", "next_action_at",
      "first_contact_at", "attribution_expires_at", "first_payment_mxn",
    ], []);
  }
  if (!access.organizationId) throw new Error("EXPORT_ORGANIZATION_REQUIRED");
  const client = await createSupabaseServerClient();
  const organizationId = access.organizationId;

  if (dataset === "companies-contacts") {
    const [accountsResult, contactsResult] = await Promise.all([
      client.from("accounts").select("id,legal_name,primary_domain,state,sector,source_confidence").eq("organization_id", organizationId).eq("is_deleted", false).order("legal_name"),
      client.from("contacts").select("id,account_id,full_name,role_title,normalized_email,verified").eq("organization_id", organizationId).eq("is_deleted", false).order("full_name"),
    ]);
    if (accountsResult.error || contactsResult.error) throw new Error("EXPORT_QUERY_FAILED");
    const data = buildCompaniesContactsExportRows(accountsResult.data, contactsResult.data);
    return makeArtifact("companies_contacts", "ennco-empresas-contactos.csv", [
      "evidence_class", "account_name", "domain", "state", "sector", "source_confidence",
      "contact_name", "role_title", "normalized_email", "verified",
    ], data);
  }

  const [accountsResult, opportunitiesResult, attributionResult, paymentsResult] = await Promise.all([
    client.from("accounts").select("id,legal_name").eq("organization_id", organizationId).eq("is_deleted", false),
    client.from("opportunities").select("id,account_id,stage,value_mxn,next_action,next_action_at").eq("organization_id", organizationId).order("updated_at"),
    client.from("attribution_events").select("account_id,first_contact_at,attribution_expires_at").eq("organization_id", organizationId),
    client.from("payments").select("opportunity_id,amount_mxn,is_first_payment").eq("organization_id", organizationId).eq("is_first_payment", true),
  ]);
  if (accountsResult.error || opportunitiesResult.error || attributionResult.error || paymentsResult.error) {
    throw new Error("EXPORT_QUERY_FAILED");
  }
  const accountById = new Map(rows(accountsResult.data).map((account) => [String(account.id), account]));
  const attributionByAccount = new Map(rows(attributionResult.data).map((event) => [String(event.account_id), event]));
  const paymentByOpportunity = new Map(rows(paymentsResult.data).map((payment) => [String(payment.opportunity_id), payment]));
  const data = rows(opportunitiesResult.data).map((opportunity) => {
    const attribution = attributionByAccount.get(String(opportunity.account_id));
    const payment = paymentByOpportunity.get(String(opportunity.id));
    return {
      evidence_class: "live",
      account_name: accountById.get(String(opportunity.account_id))?.legal_name,
      stage: opportunity.stage,
      value_mxn: opportunity.value_mxn,
      next_action: opportunity.next_action,
      next_action_at: opportunity.next_action_at,
      first_contact_at: attribution?.first_contact_at,
      attribution_expires_at: attribution?.attribution_expires_at,
      first_payment_mxn: payment?.amount_mxn,
    };
  });
  return makeArtifact("pipeline_attribution", "ennco-pipeline-atribucion.csv", [
    "evidence_class", "account_name", "stage", "value_mxn", "next_action", "next_action_at",
    "first_contact_at", "attribution_expires_at", "first_payment_mxn",
  ], data);
}

export async function auditExportArtifact(artifact: ExportArtifact, access: OperationsAccessContext): Promise<void> {
  if (access.evidenceClass === "synthetic_demo") return;
  if (!access.organizationId) throw new Error("EXPORT_ORGANIZATION_REQUIRED");
  const client = await createSupabaseServerClient();
  const { error } = await client.rpc("record_export_run", {
    target_organization_id: access.organizationId,
    target_dataset: artifact.datasetKey,
    target_row_count: artifact.rowCount,
    target_sha256: artifact.sha256,
    target_correlation_id: crypto.randomUUID(),
  });
  if (error) throw new Error("EXPORT_AUDIT_FAILED");
}
