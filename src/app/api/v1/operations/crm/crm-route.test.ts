import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMutationContext, rpc } = vi.hoisted(() => ({ getMutationContext: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/operations/route", () => ({ getMutationContext }));

import { POST } from "@/app/api/v1/operations/crm/route";

const organizationId = "41000000-0000-4000-8000-000000000001";
const recordId = "51000000-0000-4000-8000-000000000001";
const post = (body: unknown, key = "b".repeat(64)) => new Request("https://hub.example.test/api/v1/operations/crm", {
  method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body),
});

describe("POST /api/v1/operations/crm", () => {
  beforeEach(() => {
    rpc.mockReset();
    getMutationContext.mockResolvedValue({ ok: true, organizationId, client: { rpc } });
  });
  it("manda el comando a crm_command con la organización de la sesión", async () => {
    rpc.mockResolvedValue({ data: { ok: true, record_id: recordId, message: "Etapa actualizada." }, error: null });
    const response = await POST(post({ op: "MOVER", payload: { record_id: recordId, stage: "CALIFICADO" } }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("crm_command", { target_organization_id: organizationId, target_op: "MOVER",
      target_payload: { record_id: recordId, stage: "CALIFICADO" }, target_idempotency_key: "b".repeat(64) });
  });
  it("devuelve el código de la base para que la pantalla diga qué falta", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "CRM_CALIFICACION_INCOMPLETA", code: "P0001" } });
    const response = await POST(post({ op: "MOVER", payload: { record_id: recordId, stage: "CALIFICADO" } }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("CRM_CALIFICACION_INCOMPLETA");
  });
  it("rechaza la organización en el cuerpo y comandos desconocidos sin llamar a la base", async () => {
    expect((await POST(post({ op: "MOVER", payload: {}, organizationId }))).status).toBe(400);
    expect((await POST(post({ op: "BORRAR", payload: { record_id: recordId } }))).status).toBe(400);
    expect((await POST(post({ op: "NOTA", payload: { record_id: recordId, kind: "NOTA", body: "x" } }, "nope"))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
