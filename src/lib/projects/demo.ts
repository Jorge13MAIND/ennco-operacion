/** Explicit local-only sandbox. Never persists, never calls Drive, never enabled on Vercel. */
import { buildProjectDemoFixtures } from "./demo-fixtures";
import { randomUUID } from "node:crypto";
import { validateRecordTransition } from "./finance";
import { projectPermissions } from "./permissions";
import type {
  CatalogEntry,
  JsonRecord,
  ProjectBundle,
  ProjectCreateInput,
  ProjectRecord,
  ProjectUpdateInput,
  RecordKind,
} from "./types";
const storeKey = Symbol.for("ennco.projects.local-demo");
type Store = {
  projects: Map<string, ProjectBundle>;
  keys: Map<string, { fingerprint: string; projectId: string }>;
  catalogs: CatalogEntry[];
};
const globals = globalThis as unknown as Record<symbol, Store>;
function store(): Store {
  if (!globals[storeKey]) {
    const state: Store = { projects: new Map(), keys: new Map(), catalogs: [] };
    if (!isProjectDemoWritable()) {
      for (const bundle of buildProjectDemoFixtures(readOnlyDemoAccess))
        state.projects.set(bundle.project.id, bundle);
    }
    globals[storeKey] = state;
  }
  return globals[storeKey]!;
}
export const demoAccess = projectPermissions([
  "direction",
  "administration",
  "engineering",
  "projects",
  "sales",
  "purchases",
]);
export const readOnlyDemoAccess = projectPermissions(
  [
    "direction",
    "administration",
    "engineering",
    "projects",
    "sales",
    "purchases",
  ],
  true,
  true,
);
export function isProjectDemoWritable() {
  return (
    process.env.ENNCO_PROJECTS_DEMO_WRITE === "true" &&
    process.env.NEXT_PUBLIC_APP_ENV !== "production" &&
    !process.env.VERCEL_ENV &&
    process.env.NODE_ENV !== "production"
  );
}
export function demoList() {
  return [...store().projects.values()].map((b) => b.project);
}
export function demoGet(id: string) {
  const b = store().projects.get(id);
  if (!b) throw new Error("PROJECT_NOT_FOUND");
  return structuredClone(b);
}
function replay(key: string, payload: unknown): ProjectBundle | null {
  const v = store().keys.get(key);
  if (!v) return null;
  if (v.fingerprint !== JSON.stringify(payload))
    throw new Error("IDEMPOTENCY_CONFLICT");
  return demoGet(v.projectId);
}
function save(key: string, payload: unknown, bundle: ProjectBundle) {
  store().keys.set(key, {
    fingerprint: JSON.stringify(payload),
    projectId: bundle.project.id,
  });
  store().projects.set(bundle.project.id, bundle);
  return structuredClone(bundle);
}
export function demoCreate(
  data: ProjectCreateInput,
  key: string,
): ProjectBundle {
  const exists = replay(key, data);
  if (exists) return exists;
  const now = new Date().toISOString(),
    id = randomUUID();
  return save(key, data, {
    project: {
      id,
      organizationId: "00000000-0000-4000-8000-000000000001",
      folio: `DEMO-${String(store().projects.size + 1).padStart(4, "0")}`,
      name: data.name,
      segment: data.segment,
      customerName: data.customerName,
      contactName: data.contactName ?? "",
      email: data.email ?? "",
      phone: data.phone ?? "",
      location: data.location ?? "",
      scope: data.scope ?? "",
      stage: "PROSPECT",
      lifecycle: "ACTIVE",
      version: 1,
      createdAt: now,
      updatedAt: now,
      data: data.data ?? {},
    },
    records: [],
    permissions: demoAccess,
  });
}
export function demoAppend(
  id: string,
  version: number,
  kind: RecordKind,
  data: JsonRecord,
  key: string,
): ProjectBundle {
  const payload = { id, version, kind, data };
  const exists = replay(key, payload);
  if (exists) return exists;
  const b = demoGet(id);
  if (b.project.version !== version)
    throw new Error("PROJECT_VERSION_CONFLICT");
  validateRecordTransition(b.records, kind, data, b.permissions);
  const record: ProjectRecord = {
    id: randomUUID(),
    projectId: id,
    kind,
    data,
    revision: version + 1,
    createdAt: new Date().toISOString(),
    actorId: "00000000-0000-4000-8000-000000000002",
  };
  b.records.push(record);
  if (kind === "reversal" && b.project.stage === "CLOSED") {
    const target = b.records.find((r) => r.id === data.recordId);
    if (target?.kind === "financial_closure") b.project.stage = "COLLECTION";
    if (target?.kind === "technical_closure") b.project.stage = "ENGINEERING";
  }
  b.project.version++;
  b.project.updatedAt = record.createdAt;
  return save(key, payload, b);
}
export function demoUpdate(
  id: string,
  version: number,
  data: ProjectUpdateInput,
  key: string,
) {
  const payload = { id, version, data };
  const exists = replay(key, payload);
  if (exists) return exists;
  const b = demoGet(id);
  if (b.project.version !== version)
    throw new Error("PROJECT_VERSION_CONFLICT");
  if (
    data.stage === "CLOSED" &&
    !(["technical_closure", "financial_closure"] as const).every((kind) =>
      b.records.some(
        (r) =>
          r.kind === kind &&
          !b.records.some(
            (v) => v.kind === "reversal" && v.data.recordId === r.id,
          ),
      ),
    )
  )
    throw new Error("PROJECT_CLOSURES_REQUIRED");
  b.project = {
    ...b.project,
    ...data,
    data: Object.fromEntries(
      Object.entries({ ...b.project.data, ...data.data }).filter(
        ([, v]) => v !== null,
      ),
    ),
    version: version + 1,
    updatedAt: new Date().toISOString(),
  };
  return save(key, payload, b);
}
export const demoCatalogs = () => structuredClone(store().catalogs);
export function demoSaveCatalog(
  entry: Omit<CatalogEntry, "id"> & { id?: string },
) {
  const same = store().catalogs.find(
    (c) =>
      c.category === entry.category &&
      c.name === entry.name &&
      c.version === entry.version,
  );
  if (same) {
    if (JSON.stringify(same.data) !== JSON.stringify(entry.data))
      throw new Error("CATALOG_VERSION_CONFLICT");
    return same;
  }
  const saved = { ...entry, id: entry.id ?? randomUUID() };
  store().catalogs.push(saved);
  return saved;
}
