import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/authorization";
import {
  createUnknownOutboundProviderReadiness,
  parseOutboundProviderReadiness,
} from "@/lib/infrastructure/provider";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const privateHeaders = { "Cache-Control": "private, no-store" } as const;

export async function GET(): Promise<NextResponse> {
  const evaluatedAt = new Date().toISOString();
  try {
    const access = await requireOperationsAccess();
    if (access.evidenceClass === "synthetic_demo" || !access.organizationId) {
      return NextResponse.json(createUnknownOutboundProviderReadiness({
        evaluatedAt,
        reasonCode: "PROVIDER_NOT_CONNECTED_IN_SYNTHETIC_DEMO",
      }), { status: 200, headers: privateHeaders });
    }

    const client = await createSupabaseServerClient();
    const result = await client.rpc("evaluate_outbound_provider_readiness", {
      target_organization_id: access.organizationId,
      target_evaluated_at: evaluatedAt,
    });
    const readiness = parseOutboundProviderReadiness({
      rpcAvailable: !result.error,
      rpcData: result.data,
      expectedOrganizationId: access.organizationId,
      evaluatedAt,
    });
    return NextResponse.json(readiness, { status: 200, headers: privateHeaders });
  } catch {
    return NextResponse.json(
      { error: "PROVIDER_READINESS_AUTHORIZATION_REQUIRED", correlation_id: crypto.randomUUID() },
      { status: 401, headers: privateHeaders },
    );
  }
}
