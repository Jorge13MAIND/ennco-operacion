import { ProjectsList } from "@/components/solar/ProjectsList";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { listProjects } from "@/lib/precios/server";
import { listQuotes } from "@/lib/solar/server";
export const dynamic = "force-dynamic";
export default async function ProjectListPage() {
  const access = await requireOperationsAccess();
  let projects: Awaited<ReturnType<typeof listProjects>> = []; let quotes: Awaited<ReturnType<typeof listQuotes>> = []; let storageError = false;
  try { projects = await listProjects(access); } catch { storageError = true; }
  try { quotes = await listQuotes(access); } catch { storageError = true; }
  return <ProjectsList projects={projects} quotes={quotes.map((q) => ({ id: q.id, name: q.name, segment: q.segment, cashPrice: q.summary?.cashPrice ?? null }))} storageError={storageError} />;
}
