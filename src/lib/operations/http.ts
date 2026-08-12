import { NextResponse } from "next/server";
import { z } from "zod";

const MAX_OPERATIONS_BODY_CHARACTERS = 100_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" } as const;

export type ParsedOperationsInput<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse };

function errorResponse(code: string, status: number): NextResponse {
  return NextResponse.json(
    { error: code, correlation_id: crypto.randomUUID() },
    { status, headers: PRIVATE_HEADERS },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function parseOperationsMutationInput<T>(input: {
  request: Request;
  schema: z.ZodType<T>;
  trustedValues: Readonly<Record<string, unknown>>;
  protectedBodyKeys?: readonly string[];
}): Promise<ParsedOperationsInput<T>> {
  const idempotencyKey = input.request.headers.get("Idempotency-Key") ?? "";
  if (!SHA256_PATTERN.test(idempotencyKey)) {
    return { ok: false, response: errorResponse("OPERATIONS_IDEMPOTENCY_KEY_INVALID", 400) };
  }

  const declaredLength = input.request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > MAX_OPERATIONS_BODY_CHARACTERS) {
      return { ok: false, response: errorResponse("OPERATIONS_BODY_INVALID", 400) };
    }
  }

  let text: string;
  try {
    text = await input.request.text();
  } catch {
    return { ok: false, response: errorResponse("OPERATIONS_BODY_INVALID", 400) };
  }
  if (!text || text.length > MAX_OPERATIONS_BODY_CHARACTERS) {
    return { ok: false, response: errorResponse("OPERATIONS_BODY_INVALID", 400) };
  }

  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, response: errorResponse("OPERATIONS_BODY_INVALID", 400) };
  }
  if (!isRecord(body)) {
    return { ok: false, response: errorResponse("OPERATIONS_BODY_INVALID", 400) };
  }

  const protectedKeys = new Set([
    "organizationId",
    "organization_id",
    "actorId",
    "actor_id",
    "idempotencyKey",
    "idempotency_key",
    ...(input.protectedBodyKeys ?? []),
  ]);
  if (Object.keys(body).some((key) => protectedKeys.has(key))) {
    return { ok: false, response: errorResponse("OPERATIONS_TRUSTED_FIELD_IN_BODY", 400) };
  }

  const parsed = input.schema.safeParse({
    ...body,
    ...input.trustedValues,
    idempotencyKey,
  });
  if (!parsed.success) {
    return { ok: false, response: errorResponse("OPERATIONS_INPUT_INVALID", 400) };
  }
  return { ok: true, data: parsed.data };
}

export function operationsRpcResponse<T>(
  schema: z.ZodType<T>,
  value: unknown,
  status = 200,
): NextResponse {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return errorResponse("OPERATIONS_RPC_RESPONSE_INVALID", 502);
  return NextResponse.json(parsed.data, { status, headers: PRIVATE_HEADERS });
}

export function operationsRpcRejected(code: string, status = 409): NextResponse {
  return errorResponse(code, status);
}
