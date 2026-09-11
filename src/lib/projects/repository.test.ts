import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { OperationsAccessContext } from "@/lib/auth/authorization";

const mocks = vi.hoisted(() => ({
  sessionRpc: vi.fn(),
  signerRpc: vi.fn(),
  createSigner: vi.fn(),
  createSession: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createSigner }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSession,
}));
vi.mock("@/lib/runtime/config", () => ({
  getRuntimeConfig: () => ({
    supabaseUrl: "https://synthetic.example.invalid",
    supabasePublishableKey: "synthetic-public",
    organizationId: "synthetic-org",
  }),
  hasDedicatedSupabase: () => true,
}));
import { appendRecord } from "./repository";

const context: OperationsAccessContext = {
  evidenceClass: "live",
  userId: "synthetic-actor",
  organizationId: "synthetic-org",
  role: "ennco_admin",
};
const proof = "a".repeat(64);

describe("projects server attestation boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-server-key");
    mocks.createSigner.mockReturnValue({ rpc: mocks.signerRpc });
    mocks.createSession.mockResolvedValue({ rpc: mocks.sessionRpc });
    mocks.signerRpc.mockResolvedValue({ data: proof, error: null });
    mocks.sessionRpc.mockResolvedValue({
      data: { project: { id: "synthetic-project" }, records: [] },
      error: null,
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("signs derived output privately but persists with the user session", async () => {
    const data = { input: { value: 3 }, result: { value: 6 } };
    await appendRecord(
      context,
      "synthetic-project",
      4,
      "calculation",
      data,
      "synthetic-command",
    );
    expect(mocks.createSigner).toHaveBeenCalledWith(
      "https://synthetic.example.invalid",
      "synthetic-server-key",
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    );
    expect(mocks.signerRpc).toHaveBeenCalledExactlyOnceWith(
      "ennco_projects_attest",
      {
        target_organization_id: "synthetic-org",
        target_actor_id: "synthetic-actor",
        target_project_id: "synthetic-project",
        expected_version: 4,
        record_kind: "calculation",
        payload: data,
        idempotency_key: "synthetic-command",
      },
    );
    expect(mocks.sessionRpc).toHaveBeenNthCalledWith(
      1,
      "ennco_projects_append",
      {
        target_organization_id: "synthetic-org",
        target_project_id: "synthetic-project",
        expected_version: 4,
        record_kind: "calculation",
        payload: data,
        idempotency_key: "synthetic-command",
        server_attestation: proof,
      },
    );
    expect(mocks.sessionRpc).toHaveBeenNthCalledWith(2, "ennco_projects_get", {
      target_organization_id: "synthetic-org",
      target_project_id: "synthetic-project",
    });
  });

  it.each([
    "calculation",
    "proposal",
    "supplier_quote",
    "document",
    "drive_setup",
  ] as const)("fails closed for %s without a signing key", async (kind) => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    await expect(
      appendRecord(
        context,
        "synthetic-project",
        1,
        kind,
        {},
        "synthetic-command",
      ),
    ).rejects.toMatchObject({
      code: "PROJECT_SERVER_SIGNING_NOT_CONFIGURED",
      status: 503,
    });
    expect(mocks.sessionRpc).not.toHaveBeenCalled();
    expect(mocks.signerRpc).not.toHaveBeenCalled();
  });

  it.each([
    { data: null, error: { message: "provider detail" } },
    { data: "invalid proof", error: null },
  ])(
    "rejects missing or malformed attestation before writing",
    async (response) => {
      mocks.signerRpc.mockResolvedValue(response);
      await expect(
        appendRecord(
          context,
          "synthetic-project",
          1,
          "document",
          {},
          "synthetic-command",
        ),
      ).rejects.toMatchObject({
        code: "PROJECT_SERVER_SIGNING_UNAVAILABLE",
        status: 503,
      });
      expect(mocks.sessionRpc).not.toHaveBeenCalled();
    },
  );

  it("keeps ordinary business records on the user session without a signing key", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    await appendRecord(
      context,
      "synthetic-project",
      1,
      "customer_payment",
      { amountMxn: 10 },
      "synthetic-command",
    );
    expect(mocks.createSigner).not.toHaveBeenCalled();
    expect(mocks.sessionRpc).toHaveBeenCalledWith(
      "ennco_projects_append",
      expect.objectContaining({
        record_kind: "customer_payment",
        expected_version: 1,
      }),
    );
  });
});
