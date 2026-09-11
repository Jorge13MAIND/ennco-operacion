import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { OperationsAccessContext } from "@/lib/auth/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getRuntimeConfig, hasDedicatedSupabase } from "@/lib/runtime/config";
import type {
  CatalogEntry,
  JsonRecord,
  Project,
  ProjectAccess,
  ProjectArea,
  ProjectBundle,
  ProjectCreateInput,
  ProjectUpdateInput,
  RecordKind,
} from "@/lib/projects/types";

/** Stable application errors. Provider messages and payloads must never enter logs. */
export class ProjectRepositoryError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(code: string, status: number) {
    super(code);
    this.name = "ProjectRepositoryError";
    this.code = code;
    this.status = status;
  }
}

function organization(context: OperationsAccessContext): string {
  if (
    context.evidenceClass !== "live" ||
    !context.organizationId ||
    !context.userId
  ) {
    throw new ProjectRepositoryError("PROJECT_STORAGE_UNAVAILABLE", 503);
  }
  return context.organizationId;
}

async function call<T>(
  context: OperationsAccessContext,
  name: string,
  args: JsonRecord = {},
): Promise<T> {
  const organizationId = organization(context);
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc(name, {
    target_organization_id: organizationId,
    ...args,
  });
  if (error) {
    const code =
      /PROJECT_[A-Z_]+/.exec(error.message)?.[0] ??
      "PROJECT_STORAGE_UNAVAILABLE";
    const status =
      error.code === "42501"
        ? 403
        : error.code === "P0002"
          ? 404
          : error.code === "40001" || error.code === "23505"
            ? 409
            : error.code === "22023" ||
                error.code === "23514" ||
                error.code?.startsWith("22")
              ? 422
              : 503;
    throw new ProjectRepositoryError(code, status);
  }
  if (data === null)
    throw new ProjectRepositoryError("PROJECT_STORAGE_UNAVAILABLE", 503);
  return data as T;
}

export async function listProjects(
  context: OperationsAccessContext,
): Promise<Project[]> {
  return call<Project[]>(context, "ennco_projects_list");
}
export async function getProject(
  context: OperationsAccessContext,
  id: string,
): Promise<ProjectBundle> {
  return call<ProjectBundle>(context, "ennco_projects_get", {
    target_project_id: id,
  });
}
export async function getProjectPermissions(
  context: OperationsAccessContext,
): Promise<ProjectAccess> {
  return call<ProjectAccess>(context, "ennco_projects_permissions");
}
export async function createProject(
  context: OperationsAccessContext,
  input: ProjectCreateInput,
  idempotencyKey: string,
): Promise<ProjectBundle> {
  const result = await call<{ projectId: string }>(
    context,
    "ennco_projects_create",
    { input, idempotency_key: idempotencyKey },
  );
  return getProject(context, result.projectId);
}
export async function appendRecord(
  context: OperationsAccessContext,
  id: string,
  expectedVersion: number,
  kind: RecordKind,
  data: JsonRecord,
  idempotencyKey: string,
): Promise<ProjectBundle> {
  let serverAttestation: string | undefined;
  if (
    [
      "calculation",
      "proposal",
      "supplier_quote",
      "document",
      "drive_setup",
    ].includes(kind)
  ) {
    const organizationId = organization(context);
    const config = getRuntimeConfig();
    const signingKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!hasDedicatedSupabase(config) || !signingKey) {
      throw new ProjectRepositoryError(
        "PROJECT_SERVER_SIGNING_NOT_CONFIGURED",
        503,
      );
    }
    // This client may only attest already validated server output. All writes
    // below still use the user's session, capabilities and organization.
    const signer = createClient(config.supabaseUrl, signingKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const proof = await signer.rpc("ennco_projects_attest", {
      target_organization_id: organizationId,
      target_actor_id: context.userId,
      target_project_id: id,
      expected_version: expectedVersion,
      record_kind: kind,
      payload: data,
      idempotency_key: idempotencyKey,
    });
    if (
      proof.error ||
      typeof proof.data !== "string" ||
      !/^[a-f0-9]{64}$/.test(proof.data)
    ) {
      throw new ProjectRepositoryError(
        "PROJECT_SERVER_SIGNING_UNAVAILABLE",
        503,
      );
    }
    serverAttestation = proof.data;
  }
  await call(context, "ennco_projects_append", {
    target_project_id: id,
    expected_version: expectedVersion,
    record_kind: kind,
    payload: data,
    idempotency_key: idempotencyKey,
    ...(serverAttestation ? { server_attestation: serverAttestation } : {}),
  });
  return getProject(context, id);
}
export async function updateProject(
  context: OperationsAccessContext,
  id: string,
  expectedVersion: number,
  patch: ProjectUpdateInput,
  idempotencyKey: string,
): Promise<ProjectBundle> {
  await call(context, "ennco_projects_update", {
    target_project_id: id,
    expected_version: expectedVersion,
    patch,
    idempotency_key: idempotencyKey,
  });
  return getProject(context, id);
}
export async function listCatalogs(
  context: OperationsAccessContext,
): Promise<CatalogEntry[]> {
  return call<CatalogEntry[]>(context, "ennco_projects_catalog_list");
}
export async function saveCatalog(
  context: OperationsAccessContext,
  input: Omit<CatalogEntry, "id" | "createdAt">,
  idempotencyKey: string,
): Promise<CatalogEntry> {
  const result = await call<{ catalogId: string }>(
    context,
    "ennco_projects_catalog_save",
    { input, idempotency_key: idempotencyKey },
  );
  const entry = (await listCatalogs(context)).find(
    (catalog) => catalog.id === result.catalogId,
  );
  if (!entry)
    throw new ProjectRepositoryError("PROJECT_CATALOG_NOT_FOUND", 404);
  return entry;
}
export async function setProjectMemberAreas(
  context: OperationsAccessContext,
  userId: string,
  areas: ProjectArea[],
  idempotencyKey: string,
): Promise<{ userId: string; areas: ProjectArea[] }> {
  return call(context, "ennco_projects_member_set", {
    target_user_id: userId,
    areas,
    idempotency_key: idempotencyKey,
  });
}

export async function listProjectMembers(
  context: OperationsAccessContext,
): Promise<
  Array<{
    userId: string;
    email: string;
    displayName: string;
    role: string;
    areas: ProjectArea[];
  }>
> {
  return call(context, "ennco_projects_member_list");
}
