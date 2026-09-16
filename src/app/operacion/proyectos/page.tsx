import { SolarHome } from "@/components/solar/SolarHome";
import { requireOperationsAccess } from "@/lib/auth/authorization";
import { listQuotes, loadSolarCatalog, workbookVersions, type CatalogVersions, type StoredQuote } from "@/lib/solar/server";

export const dynamic = "force-dynamic";

export default async function ProjectsMasterPage() {
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
    quotes = await listQuotes(access);
  } catch {
    storageError = true;
  }
  return <SolarHome live={access.evidenceClass === "live"} quotes={quotes} storageError={storageError} versions={versions} />;
}
