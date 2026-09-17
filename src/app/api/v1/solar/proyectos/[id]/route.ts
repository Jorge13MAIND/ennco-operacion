import { api, context, ProjectApiError } from "@/lib/solar/api";
import { deleteProject, getProject } from "@/lib/precios/server";
export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  return api(async () => { const c = await context(); try { return { project: await getProject(c, (await params).id) }; } catch (e) { const code = e instanceof Error ? e.message : "SOLAR_STORAGE_UNAVAILABLE"; throw new ProjectApiError(code, code.includes("NOT_FOUND") ? 404 : 503); } });
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return api(async () => { const c = await context(request); try { return await deleteProject(c, (await params).id); } catch (e) { const code = e instanceof Error ? e.message : "SOLAR_STORAGE_UNAVAILABLE"; throw new ProjectApiError(code, code === "SOLAR_FORBIDDEN" ? 403 : code.includes("NOT_FOUND") ? 404 : 503); } });
}
