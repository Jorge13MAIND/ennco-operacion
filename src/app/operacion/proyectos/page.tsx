import { SolarHome } from "@/components/solar/SolarHome";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { listQuotes, loadSolarCatalog, workbookVersions, type CatalogVersions, type StoredQuote } from "@/lib/solar/server";

export const dynamic = "force-dynamic";

export default async function ProjectsMasterPage({ searchParams }: { searchParams: Promise<{ archivadas?: string }> }) {
  const archived = (await searchParams).archivadas === "1";
  const access = await requireOperationsAccess();
  let versions: CatalogVersions = workbookVersions();
  let quotes: StoredQuote[] = [];
  let storageError = false;
  // Ninguna lectura debe tumbar la pantalla: sin catálogos se trabaja con el libro, sin lista se avisa.
  try {
    versions = (await loadSolarCatalog(access)).versions;
  } catch {
    storageError = true;
  }
  try {
    quotes = await listQuotes(access, archived);
  } catch {
    storageError = true;
  }
  // En la vista de archivadas solo se muestran esas; la lista activa ya las excluye.
  const shown = archived ? quotes.filter((q) => q.status === "ARCHIVED") : quotes;
  return <SolarHome live={access.evidenceClass === "live"} quotes={shown} storageError={storageError} versions={versions} archived={archived} />;
}
