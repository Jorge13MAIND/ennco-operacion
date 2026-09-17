import { notFound } from "next/navigation";
import { ProjectWorkspace } from "@/components/solar/ProjectWorkspace";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { getProject, readPriceCatalog } from "@/lib/precios/server";
import { getQuote } from "@/lib/solar/server";
export const dynamic = "force-dynamic";
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await requireOperationsAccess();
  const { id } = await params;
  let project; try { project = await getProject(access, id); } catch { notFound(); }
  const catalog = await readPriceCatalog(access).catch(() => ({ suppliers: [], items: [], quotes: [], settings: { iva: 0.16, margin: 0.3, marginByCategory: {}, fxByPeriod: {}, priceRule: "MAX" as const } }));
  let quote = null;
  if (project.quoteId) { try { const q = await getQuote(access, project.quoteId); quote = { id: q.id, name: q.name, cashPrice: q.summary?.cashPrice ?? null, systemKw: q.summary?.systemKw ?? null, modules: q.summary?.modules ?? null }; } catch { quote = null; } }
  return <ProjectWorkspace catalog={catalog} project={project} quote={quote} />;
}
