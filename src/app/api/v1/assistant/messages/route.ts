import { NextResponse } from "next/server";

export function POST(): NextResponse {
  return NextResponse.json(
    {
      error: "ASSISTANT_NOT_RELEASED",
      handoff: "Comparte tus datos en el diagnóstico y el equipo de ENNCO dará seguimiento.",
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
