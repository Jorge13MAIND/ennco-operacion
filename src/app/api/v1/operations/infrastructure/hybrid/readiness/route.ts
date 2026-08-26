import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/authorization";
import {
  createUnknownHybridOutboundReadiness,
  parseHybridOutboundReadiness,
} from "@/lib/infrastructure/hybrid-outbound";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const privateHeaders = { "Cache-Control": "private, no-store" } as const;

export async function GET(): Promise<NextResponse> {
  const evaluatedAt = new Date().toISOString();
  try {
    const access = await requireOperationsAccess();
    if (access.evidenceClass === "synthetic_demo" || !access.organizationId) {
      return NextResponse.json(createUnknownHybridOutboundReadiness({
        evaluatedAt,
        reasonCode: "HYBRID_OUTBOUND_NOT_LIVE_IN_SYNTHETIC_DEMO",
      }), { status: 200, headers: privateHeaders });
    }
    const client = await createSupabaseServerClient();
    const result = await client.rpc("evaluate_hybrid_outbound_readiness", {
      target_organization_id: access.organizationId,
      target_evaluated_at: evaluatedAt,
    });
    const readiness = parseHybridOutboundReadiness({
      rpcAvailable: !result.error,
      rpcData: result.data,
      expectedOrganizationId: access.organizationId,
      evaluatedAt,
    });
    return NextResponse.json(readiness, { status: 200, headers: privateHeaders });
  } catch {
    return NextResponse.json(
      { error: "HYBRID_OUTBOUND_AUTHORIZATION_REQUIRED", correlation_id: crypto.randomUUID() },
      { status: 401, headers: privateHeaders },
    );
  }
}
