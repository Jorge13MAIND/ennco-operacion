import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/authorization";
import { auditExportArtifact, createExportArtifact, isExportDataset } from "@/lib/exports/datasets";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ dataset: string }> }): Promise<NextResponse> {
  const { dataset } = await params;
  if (!isExportDataset(dataset)) {
    return NextResponse.json({ error: "EXPORT_DATASET_NOT_FOUND" }, { status: 404 });
  }
  try {
    const access = await requireOperationsAccess();
    const artifact = await createExportArtifact(dataset, access);
    await auditExportArtifact(artifact, access);
    return new NextResponse(artifact.csv, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${artifact.filename}"`,
        "Content-Type": "text/csv; charset=utf-8",
        "X-Content-SHA256": artifact.sha256,
        "X-Evidence-Class": access.evidenceClass,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "EXPORT_UNAVAILABLE", correlation_id: crypto.randomUUID() },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
