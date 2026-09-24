import { describe, expect, it, vi } from "vitest";
import { proposeWithModel } from "@/lib/correos/sdr/model";
import { deterministicProposal } from "@/lib/correos/sdr/policy";
describe("bounded model adapter", () => {
  it("requires dedicated credentials and explicit model selection", async () => {
    const fetchImpl = vi.fn();
    await expect(proposeWithModel({ apiKey: "", model: "", latestReply: "Contexto", conversation: [], fetchImpl })).rejects.toThrow("SDR_MODEL_NOT_CONFIGURED");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("uses strict structured output without tools, storage or recipient fields", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(deterministicProposal("Contexto")) }] }] }));
    await proposeWithModel({ apiKey: "synthetic", model: "synthetic", latestReply: "Contexto", conversation: [],
      commercialContext: { campaignName: "Synthetic campaign", accountName: "Synthetic plant", contactRole: "Maintenance" }, fetchImpl });
    const body = JSON.parse((fetchImpl.mock.calls as unknown as [string, RequestInit][])[0]![1].body as string);
    expect(body.store).toBe(false); expect(body.tools).toBeUndefined(); expect(body.text.format.strict).toBe(true);
    expect(body.text.format.schema.properties.to_email).toBeUndefined();
    const context = JSON.parse(body.input);
    expect(context.untrusted_commercial_context).toEqual({ campaignName: "Synthetic campaign", accountName: "Synthetic plant", contactRole: "Maintenance" });
    expect(context.approved_facts).toHaveLength(2);
  });
  it.each(["refusal", "incomplete", "http", "malformed"])("holds %s without automatic retries", async scenario => {
    const fetchImpl = vi.fn(async () => scenario === "http" ? new Response("", { status: 429 }) : Response.json({ status: scenario === "incomplete" ? "incomplete" : "completed", output: [{ type: "message", content: [{ type: scenario === "refusal" ? "refusal" : "output_text", text: "{}" }] }] }));
    await expect(proposeWithModel({ apiKey: "synthetic", model: "synthetic", latestReply: "Contexto", conversation: [], fetchImpl })).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
