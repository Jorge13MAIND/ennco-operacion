import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requireOperationsAccess,
  type OperationsAccessContext,
} from "@/lib/auth/authorization";
import { getRuntimeConfig } from "@/lib/runtime/config";
import { evaluateMutationRequest } from "@/lib/security/request";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import * as repository from "./repository";
import * as demo from "./demo";
import { canAppendRecord } from "./permissions";
import { proposalEconomics } from "./economics";
import { projectSummary, priceProposal } from "./finance";
import { parseRecordData } from "./schemas";
import type {
  CatalogEntry,
  JsonRecord,
  ProjectBundle,
  ProjectCreateInput,
  ProjectReadiness,
  ProjectUpdateInput,
  RecordKind,
} from "./types";
export const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
export class ProjectApiError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}
export function readiness(context: OperationsAccessContext): ProjectReadiness {
  const synthetic = context.evidenceClass === "synthetic_demo";
  return {
    storage: synthetic ? "DEMO" : "READY",
    drive:
      process.env.ENNCO_DRIVE_REFRESH_TOKEN &&
      process.env.ENNCO_DRIVE_CLIENT_ID &&
      process.env.ENNCO_DRIVE_CLIENT_SECRET
        ? "CONFIGURED"
        : "NOT_CONFIGURED",
    ocr: "ASSISTED",
    engineering: "REVIEW_REQUIRED",
    contractTemplate: "REVIEW_REQUIRED",
    demo: synthetic,
    ...(synthetic
      ? {
          message:
            "Entorno de demostración. Los datos se conservan sólo durante esta sesión del servidor; Drive y operaciones externas están desactivados.",
        }
      : {}),
  };
}
export async function context(
  request?: Request,
): Promise<OperationsAccessContext> {
  if (request) {
    const decision = evaluateMutationRequest(
      request,
      getRuntimeConfig().appUrl,
    );
    if (decision.decision !== "ALLOW")
      throw new ProjectApiError(decision.code, 403);
  }
  let auth: OperationsAccessContext;
  try {
    auth = await requireOperationsAccess();
  } catch {
    throw new ProjectApiError("PROJECT_AUTHENTICATION_REQUIRED", 401);
  }
  if (
    request &&
    auth.evidenceClass === "synthetic_demo" &&
    !demo.isProjectDemoWritable()
  )
    throw new ProjectApiError("PROJECT_DEMO_READ_ONLY", 409);
  return auth;
}
export function key(request: Request) {
  const k = request.headers.get("idempotency-key");
  if (!k || !/^[a-f0-9]{64}$/i.test(k))
    throw new ProjectApiError("IDEMPOTENCY_KEY_REQUIRED", 400);
  return k.toLowerCase();
}
export async function body(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length") ?? 0) > 1_000_000)
    throw new ProjectApiError("PROJECT_REQUEST_TOO_LARGE", 413);
  const raw = await request.text();
  if (raw.length > 1_000_000)
    throw new ProjectApiError("PROJECT_REQUEST_TOO_LARGE", 413);
  try {
    return JSON.parse(raw);
  } catch {
    throw new ProjectApiError("PROJECT_JSON_INVALID", 400);
  }
}
export async function api<T>(run: () => Promise<T>) {
  try {
    return NextResponse.json(await run(), { headers });
  } catch (e) {
    return apiError(e);
  }
}
export function apiError(e: unknown) {
  if (e instanceof z.ZodError)
    return NextResponse.json(
      {
        error: "PROJECT_INPUT_INVALID",
        message: "Revisa los campos señalados.",
        issues: e.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 422, headers },
    );
  const message = e instanceof Error ? e.message : "PROJECT_UNAVAILABLE";
  const code = /^[A-Z][A-Z0-9_]+$/.test(message)
    ? message
    : "PROJECT_OPERATION_REJECTED";
  const status =
    e instanceof ProjectApiError ||
    e instanceof repository.ProjectRepositoryError
      ? e.status
      : code.includes("NOT_FOUND")
        ? 404
        : code.includes("FORBIDDEN")
          ? 403
          : code.includes("UNAVAILABLE") || code.includes("NOT_CONFIGURED")
            ? 503
            : 409;
  return NextResponse.json(
    {
      error: code,
      message: errorMessage(code),
      correlationId: crypto.randomUUID(),
    },
    { status, headers },
  );
}
function errorMessage(code: string) {
  const messages: Record<string, string> = {
    PROJECT_FINANCIALLY_CLOSED:
      "Primero reabre el cierre financiero con motivo y evidencia para corregir operaciones.",
    PROJECT_TECHNICALLY_CLOSED:
      "Primero reabre el cierre técnico para modificar esta información.",
    PROJECT_PAYMENT_DUPLICATE:
      "Ya existe un pago activo con la misma fecha, referencia y método. Revisa el historial.",
    PROJECT_ALLOCATION_TOTAL_MISMATCH:
      "Distribuye el importe completo del cobro entre sus parcialidades.",
    PROJECT_PAID_INSTALLMENT_REMOVAL:
      "Una parcialidad con cobros no se puede eliminar. Conserva su identificador.",
    PROJECT_SCHEDULE_TOTAL_MISMATCH:
      "El calendario debe sumar el contrato y los adicionales autorizados.",
    PROJECT_PAYMENT_EXCEEDS_INSTALLMENT:
      "La asignación supera el saldo de una parcialidad.",
    PROJECT_REVERSAL_HAS_DEPENDENCIES:
      "Corrige primero los registros que dependen de este movimiento.",
    FINANCIAL_RECONCILIATION_REQUIRED:
      "Concilia facturas, cobros, parcialidades, gastos y compras pendientes, o registra la excepción de Dirección.",
    PROJECT_CONTRACT_ALREADY_EXISTS:
      "El contrato vigente se modifica mediante un adicional y su autorización.",
  };
  if (messages[code]) return messages[code];
  if (code.includes("VERSION") || code.includes("CONFLICT"))
    return "El expediente cambió o la solicitud ya se utilizó. Actualiza la vista antes de continuar.";
  if (code.includes("ADVANCE"))
    return "Compras requiere anticipo confirmado o excepción documentada de Dirección.";
  if (code.includes("FORBIDDEN")) return "Tu función no permite esta acción.";
  if (code.includes("DRIVE"))
    return "La conexión de Drive requiere atención. El borrador permanece disponible.";
  if (code.includes("NOT_FOUND"))
    return "No se encontró el expediente solicitado.";
  if (code.includes("DEMO"))
    return "Esta vista es de demostración; habilita el entorno local de pruebas para registrar datos sintéticos.";
  if (code.includes("UNAVAILABLE"))
    return "La base de proyectos todavía no está disponible. Revisa la migración y la conexión.";
  if (code.includes("INCOMPLETE"))
    return "Faltan datos o verificaciones antes de aprobar esta revisión.";
  return "No se pudo registrar la operación. Revisa sus referencias, importes y permisos.";
}
export async function accessFor(c: OperationsAccessContext) {
  return c.evidenceClass === "synthetic_demo"
    ? demo.isProjectDemoWritable()
      ? demo.demoAccess
      : demo.readOnlyDemoAccess
    : repository.getProjectPermissions(c);
}
export async function bundleFor(c: OperationsAccessContext, id: string) {
  z.uuid().parse(id);
  return c.evidenceClass === "synthetic_demo"
    ? demo.demoGet(id)
    : repository.getProject(c, id);
}
export function detail(c: OperationsAccessContext, b: ProjectBundle) {
  return {
    project: b.project,
    records: b.records,
    access: b.permissions,
    summary: projectSummary(b.records, b.permissions),
    readiness: readiness(c),
  };
}
export async function allProjects(c: OperationsAccessContext) {
  const projects =
    c.evidenceClass === "synthetic_demo"
      ? demo.demoList()
      : await repository.listProjects(c);
  const access = await accessFor(c);
  const summaries: Record<string, ReturnType<typeof projectSummary>> = {};
  for (const p of projects) {
    const b = await bundleFor(c, p.id);
    summaries[p.id] = projectSummary(b.records, b.permissions);
  }
  return {
    projects,
    access,
    summaries,
    readiness: readiness(c),
    links: await commercialLinks(c),
  };
}
async function commercialLinks(c: OperationsAccessContext) {
  if (c.evidenceClass === "synthetic_demo")
    return { accounts: [], opportunities: [] };
  const client = await createSupabaseServerClient();
  const results = await Promise.allSettled([
    client
      .from("accounts")
      .select("id,legal_name")
      .eq("organization_id", c.organizationId)
      .limit(200),
    client
      .from("opportunities")
      .select("id,account_id,stage")
      .eq("organization_id", c.organizationId)
      .limit(200),
  ]);
  return {
    accounts:
      results[0].status === "fulfilled" && !results[0].value.error
        ? (results[0].value.data ?? []).map((a) => ({
            id: a.id,
            name: a.legal_name,
          }))
        : [],
    opportunities:
      results[1].status === "fulfilled" && !results[1].value.error
        ? (results[1].value.data ?? []).map((o) => ({
            id: o.id,
            accountId: o.account_id,
            label: `${o.stage} · ${o.id.slice(0, 8)}`,
          }))
        : [],
  };
}
export async function create(
  c: OperationsAccessContext,
  data: ProjectCreateInput,
  k: string,
) {
  const access = await accessFor(c);
  if (!access.canCreate) throw new ProjectApiError("PROJECT_FORBIDDEN", 403);
  return c.evidenceClass === "synthetic_demo"
    ? demo.demoCreate(data, k)
    : repository.createProject(c, data, k);
}
export async function update(
  c: OperationsAccessContext,
  id: string,
  version: number,
  data: ProjectUpdateInput,
  k: string,
) {
  const access = await accessFor(c);
  if (!access.canEdit) throw new ProjectApiError("PROJECT_FORBIDDEN", 403);
  return c.evidenceClass === "synthetic_demo"
    ? demo.demoUpdate(id, version, data, k)
    : repository.updateProject(c, id, version, data, k);
}
export async function append(
  c: OperationsAccessContext,
  id: string,
  version: number,
  kind: RecordKind,
  data: JsonRecord,
  k: string,
  internal = false,
) {
  const a = await accessFor(c);
  if (!canAppendRecord(a, kind, data))
    throw new ProjectApiError("PROJECT_FORBIDDEN", 403);
  if (!internal && ["calculation", "document", "drive_setup"].includes(kind))
    throw new ProjectApiError("PROJECT_SPECIALIZED_ENDPOINT_REQUIRED", 400);
  let safe = internal ? data : parseRecordData(kind, data);
  if (kind === "proposal") {
    if (safe.exchangeRateSource) {
      const source = safe.exchangeRateSource as JsonRecord;
      const entry = (await catalogs(c)).find(
        (e) =>
          e.id === source.catalogId &&
          e.version === source.version &&
          e.sourceUrl === source.sourceUrl &&
          e.sourceDate === source.sourceDate &&
          e.status === "APPROVED",
      );
      if (!entry || entry.data.rateMxnPerUsd !== safe.exchangeRate)
        throw new ProjectApiError("PROJECT_EXCHANGE_RATE_SOURCE_INVALID", 422);
    }
    const b = await bundleFor(c, id);
    const requestFingerprint = hash(
      JSON.stringify({ version, kind, data: safe }),
    );
    const existing = b.records.find(
      (r) =>
        r.kind === "proposal" &&
        r.data.operationKeyHash === hash(k) &&
        (c.evidenceClass === "synthetic_demo" || r.actorId === c.userId),
    );
    if (existing) {
      if (existing.data.requestFingerprint !== requestFingerprint)
        throw new ProjectApiError("PROJECT_IDEMPOTENCY_CONFLICT");
      return b;
    }
    safe = priceProposal({
      ...safe,
      operationKeyHash: hash(k),
      requestFingerprint,
      customerSnapshot: {
        customerName: b.project.customerName,
        contactName: b.project.contactName,
        location: b.project.location,
        scope: b.project.scope,
      },
    });
    safe.economics = proposalEconomics(
      safe,
      b.records.find(
        (r) => r.kind === "calculation" && r.id === safe.calculationId,
      ),
    );
  }
  if (kind === "supplier_quote") {
    const subtotal =
      Math.round(Number(safe.quantity) * Number(safe.unitCostMxn) * 100) / 100;
    safe = {
      ...safe,
      totalMxn:
        Math.round(subtotal * (1 + Number(safe.vatPct) / 100) * 100) / 100,
    };
  }
  return c.evidenceClass === "synthetic_demo"
    ? demo.demoAppend(id, version, kind, safe, k)
    : repository.appendRecord(c, id, version, kind, safe, k);
}
export async function catalogs(c: OperationsAccessContext) {
  return c.evidenceClass === "synthetic_demo"
    ? demo.demoCatalogs()
    : repository.listCatalogs(c);
}
export async function catalogSave(
  c: OperationsAccessContext,
  data: Omit<CatalogEntry, "id"> & { id?: string },
  k: string,
) {
  const a = await accessFor(c);
  if (!a.canManageCatalogs || (data.status === "APPROVED" && !a.canApprove))
    throw new ProjectApiError("PROJECT_FORBIDDEN", 403);
  return c.evidenceClass === "synthetic_demo"
    ? demo.demoSaveCatalog(data)
    : repository.saveCatalog(c, data, k);
}
