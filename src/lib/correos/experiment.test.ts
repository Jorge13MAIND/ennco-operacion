import { describe, expect, it } from "vitest";
import { prepareEmailExperiment, type ExperimentCandidate } from "@/lib/correos/experiment";
const contact = (n: number): ExperimentCandidate => ({ contact_id: String(n), company_id: "company-" + n, profile: n % 2 ? "MAINTENANCE" : "MANAGEMENT", plant_verified: true, person_location_verified: true, role_verified: true, email_verified: true, prior_contact: false, suppressed: false, evidence_urls: ["https://example.test/evidence"] });
describe("controlled email experiment", () => {
  it("assigns reproducible balanced groups of 50 without enabling enrollment", () => {
    const candidates = Array.from({ length: 100 }, (_, n) => contact(n));
    const result = prepareEmailExperiment(candidates);
    expect(result.state).toBe("SAMPLE_PREPARED"); expect(result.launch_allowed).toBe(false);
    expect(result.cohorts.A).toHaveLength(50); expect(result.cohorts.B).toHaveLength(50);
    expect(prepareEmailExperiment([...candidates].reverse())).toEqual(result);
  });
  it("holds missing personal location evidence even when email is verified", () => {
    const result = prepareEmailExperiment([{ ...contact(1), person_location_verified: false }]);
    expect(result.held).toEqual(["1"]); expect(result.state).toBe("INCOMPLETE");
  });
  it("never divides one company between arms or fills missing sample with contacted people", () => {
    const candidates = Array.from({ length: 102 }, (_, n) => ({ ...contact(n), company_id: "company-" + Math.floor(n / 2), prior_contact: n > 99 }));
    const result = prepareEmailExperiment(candidates);
    const companiesA = new Set(result.cohorts.A.map(c => c.company_id));
    expect(result.cohorts.B.some(c => companiesA.has(c.company_id))).toBe(false);
    expect(result.held).toContain("100"); expect(result.held).toContain("101");
  });
  it("rejects duplicate contacts", () => expect(() => prepareEmailExperiment([contact(1), contact(1)])).toThrow("EXPERIMENT_DUPLICATE_CONTACT"));
});
