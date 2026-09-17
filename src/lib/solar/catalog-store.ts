import "server-only";

import type { OperationsAccessContext } from "@/lib/auth/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type CatalogEntry = { id: string; category: string; name: string; version: number; data: Record<string, unknown>; sourceUrl: string; sourceDate: string; status: string; createdAt: string };

/** Catalogos aprobados en Catalogos (tabla ennco_project_catalogs). Sustituyen al libro cuando existen. */
export async function listCatalogs(access: OperationsAccessContext): Promise<CatalogEntry[]> {
  if (access.evidenceClass !== "live" || !access.organizationId) throw new Error("SOLAR_STORAGE_UNAVAILABLE");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("ennco_projects_catalog_list", { target_organization_id: access.organizationId });
  if (error) throw new Error("SOLAR_STORAGE_UNAVAILABLE");
  return (data ?? []) as CatalogEntry[];
}
