import { SolarHome } from "@/components/solar/SolarHome";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { listQuotes, loadSolarCatalog } from "@/lib/solar/server";

export const dynamic = "force-dynamic";

export default async function ProjectsMasterPage() {
  const access = await requireOperationsAccess();
  const [{ versions }, quotes] = await Promise.all([loadSolarCatalog(access), listQuotes(access).catch(() => null)]);
  return <SolarHome live={access.evidenceClass === "live"} quotes={quotes ?? []} storageError={quotes === null} versions={versions} />;
}
