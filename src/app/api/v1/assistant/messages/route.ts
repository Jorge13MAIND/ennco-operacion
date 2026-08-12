import { NextResponse } from "next/server";

import { assistantInputSchema, evaluateAssistantMessage } from "@/lib/assistant/policy";
import { getRuntimeConfig } from "@/lib/runtime/config";

const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: Request): Promise<NextResponse> {
  const config = getRuntimeConfig();
  if (!config.assistantReleased) {
    return NextResponse.json(
      {
        error: "ASSISTANT_NOT_RELEASED",
        handoff: "Comparte tus datos en el diagnóstico y el equipo de ENNCO dará seguimiento.",
      },
      { status: 503, headers },
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 4096) {
    return NextResponse.json({ error: "REQUEST_TOO_LARGE" }, { status: 413, headers });
  }

  const parsed = assistantInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_ASSISTANT_INPUT" }, { status: 400, headers });
  }

  return NextResponse.json(
    {
      ...evaluateAssistantMessage(parsed.data.message),
      evidence_class: "live",
      persisted: false,
    },
    { status: 200, headers },
  );
}
