import { PriceWorkspace } from "@/components/solar/PriceWorkspace";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { workbookCatalog } from "@/lib/solar/workbook";
export const dynamic = "force-dynamic";
export default async function PreciosPage() {
  await requireOperationsAccess();
  const c = workbookCatalog();
  return <PriceWorkspace catalogModels={{ modules: c.modules.map((m) => m.model), inverters: c.inverters.map((i) => i.model) }} />;
}
