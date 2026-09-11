import {
  api,
  context,
  body,
  key,
  catalogs,
  catalogSave,
  accessFor,
  readiness,
} from "@/lib/projects/server";
import historical from "../../../../../../data/projects/historical-catalogs.json";
import { engineeringSources } from "@/lib/projects/engineering-sources";
import { catalogSchema } from "@/lib/projects/schemas";
export async function GET() {
  return api(async () => {
    const c = await context();
    return {
      entries: (await catalogs(c)).filter((e) => e.category !== "drive_root"),
      historical: historical.entries,
      historicalMeta: {
        sourceSha256: historical.sourceSha256,
        sourceDateNote: historical.sourceDateNote,
        counts: historical.counts,
      },
      sourceLibrary: engineeringSources,
      access: await accessFor(c),
      readiness: readiness(c),
    };
  });
}
export async function POST(request: Request) {
  return api(async () => {
    const c = await context(request);
    const entry = await catalogSave(
      c,
      catalogSchema.parse(await body(request)),
      key(request),
    );
    return {
      entry,
      entries: await catalogs(c),
      access: await accessFor(c),
      readiness: readiness(c),
    };
  });
}
