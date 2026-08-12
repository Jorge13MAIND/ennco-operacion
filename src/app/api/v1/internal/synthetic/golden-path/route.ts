import { NextResponse } from "next/server";
import { z } from "zod";

import { MemoryGoldenPathRepository, runSyntheticGoldenPath } from "@/lib/domain/golden-path";
import type { GoldenPathInput } from "@/lib/domain/types";
import { getRuntimeConfig } from "@/lib/runtime/config";

const bodySchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(120),
  suppressed: z.boolean().default(false),
});

const idempotencyRepository = new MemoryGoldenPathRepository();

export async function POST(request: Request): Promise<NextResponse> {
  const config = getRuntimeConfig();
  if (!config.demoMode || config.appEnv === "production") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_SYNTHETIC_INPUT" }, { status: 400 });
  }

  const input: GoldenPathInput = {
    idempotencyKey: parsed.data.idempotencyKey,
    company: {
      id: "00000000-0000-4000-8000-000000000101",
      organizationId: "00000000-0000-4000-8000-000000000001",
      legalName: "Synthetic Industrial Plant",
      domain: "synthetic.example",
    },
    contact: {
      id: "00000000-0000-4000-8000-000000000201",
      companyId: "00000000-0000-4000-8000-000000000101",
      fullName: "Synthetic Contact",
      role: "Dirección de planta",
      email: "synthetic@synthetic.example",
    },
    qualification: {
      industrialOver100Kwp: true,
      outsideAnnexA: true,
      verifiedTargetRole: true,
      explicitInterest: true,
      monthlySpendMxn: 150_000,
      evidenceRecordIds: ["00000000-0000-4000-8000-000000000301"],
    },
  };

  const repository = parsed.data.suppressed
    ? new MemoryGoldenPathRepository()
    : idempotencyRepository;
  if (parsed.data.suppressed) repository.suppress(input.company.organizationId, input.contact.email);
  const result = await runSyntheticGoldenPath(input, repository);
  return NextResponse.json(
    {
      evidence_class: "synthetic_demo",
      external_side_effects: 0,
      result,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
