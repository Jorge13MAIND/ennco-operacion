import { NextResponse } from "next/server";
import { z } from "zod";

import { sealDirectLaneSecret } from "@/lib/correos/vault";
import { rpcErrorCode } from "@/lib/dispatch/rpc-error";
import { GrowattError, growattDevices, growattPlants, isGrowattHost } from "@/lib/medidores/growatt";
import { operationsRpcRejected, parseOperationsMutationInput } from "@/lib/operations/http";
import { getMutationContext } from "@/lib/operations/route";
import { getRuntimeConfig } from "@/lib/runtime/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Conexión con Growatt. "probar" valida el token y lista sus plantas (Growatt permite listar plantas
 * solo 10 veces al día); "conectar" lee los inversores de la planta elegida, cifra el token con la llave
 * del vault (la misma de los buzones) y lo guarda. El token nunca se regresa al navegador ni se guarda en claro.
 */
const tokenSchema = z.string().trim().regex(/^[A-Za-z0-9]{20,64}$/);
const envelopeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("probar"), token: tokenSchema, region: z.enum(["auto", "global", "us", "cn", "au"]), organizationId: z.uuid(), idempotencyKey: z.string() }).strict(),
  z.object({ action: z.literal("conectar"), token: tokenSchema, base: z.string().url(), plant_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    plant_name: z.string().max(200).optional(), site_id: z.uuid(), organizationId: z.uuid(), idempotencyKey: z.string() }).strict(),
]);
const headers = { "Cache-Control": "private, no-store" } as const;

export async function POST(request: Request): Promise<NextResponse> {
  const context = await getMutationContext(request);
  if (!context.ok) return context.response;
  const parsed = await parseOperationsMutationInput({ request, schema: envelopeSchema, trustedValues: { organizationId: context.organizationId } });
  if (!parsed.ok) return parsed.response;
  const input = parsed.data;
  try {
    if (input.action === "probar") {
      const result = await growattPlants(input.token, input.region);
      return NextResponse.json({ ok: true, base: result.base, plants: result.plants }, { status: 200, headers });
    }
    if (!isGrowattHost(input.base)) return operationsRpcRejected("GROWATT_HOST_INVALID", 400);
    const config = getRuntimeConfig();
    if (!config.directLaneVaultKey) return operationsRpcRejected("ENERGY_VAULT_UNAVAILABLE");
    const devices = await growattDevices(input.base, input.token, input.plant_id);
    const sealed = sealDirectLaneSecret(input.token, config.directLaneVaultKey);
    const { data, error } = await context.client.rpc("energy_command", {
      target_organization_id: context.organizationId, target_op: "GROWATT_GUARDAR",
      target_payload: {
        site_id: input.site_id, api_base: input.base, token_ciphertext: sealed.ciphertext, token_key_id: sealed.keyId,
        token_hint: `…${input.token.slice(-4)}`, plant_id: input.plant_id, plant_name: input.plant_name ?? null,
        devices: devices.map((d) => ({ sn: d.sn, name: d.name, model: d.model })),
      },
      target_idempotency_key: input.idempotencyKey,
    });
    if (error) return operationsRpcRejected(rpcErrorCode(error));
    return NextResponse.json(data, { status: 200, headers });
  } catch (error) {
    return operationsRpcRejected(error instanceof GrowattError ? error.code : "GROWATT_UNAVAILABLE", 409);
  }
}
