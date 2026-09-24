import { createHash } from "node:crypto";
import { z } from "zod";
const candidateSchema = z.object({
  contact_id: z.string().min(1), company_id: z.string().min(1), profile: z.string().min(1),
  plant_verified: z.boolean(), person_location_verified: z.boolean(), role_verified: z.boolean(),
  email_verified: z.boolean(), prior_contact: z.boolean(), suppressed: z.boolean(),
  evidence_urls: z.array(z.url()),
}).strict();
export type ExperimentCandidate = z.infer<typeof candidateSchema>;
export function prepareEmailExperiment(raw: unknown, seed = "ENNCO-2026-09-23") {
  const candidates = z.array(candidateSchema).parse(raw);
  if (new Set(candidates.map(c => c.contact_id)).size !== candidates.length) throw new Error("EXPERIMENT_DUPLICATE_CONTACT");
  const held: string[] = []; const companies = new Map<string, ExperimentCandidate[]>();
  for (const c of candidates) {
    if (!c.plant_verified || !c.person_location_verified || !c.role_verified || !c.email_verified || c.prior_contact || c.suppressed || c.evidence_urls.length === 0) { held.push(c.contact_id); continue; }
    companies.set(c.company_id, [...companies.get(c.company_id) ?? [], c]);
  }
  const cohorts: Record<"A" | "B", ExperimentCandidate[]> = { A: [], B: [] };
  const profileCounts: Record<"A" | "B", Record<string, number>> = { A: {}, B: {} };
  const digest = (id: string) => createHash("sha256").update(seed + ":" + id).digest("hex");
  const groups = [...companies.entries()].sort((a, b) => b[1].length - a[1].length || digest(a[0]).localeCompare(digest(b[0])));
  for (const [, contacts] of groups) {
    const options = (["A", "B"] as const).filter(g => cohorts[g].length + contacts.length <= 50);
    if (!options.length) { held.push(...contacts.map(c => c.contact_id)); continue; }
    const cost = (g: "A" | "B") => contacts.reduce((sum, c) => sum + (profileCounts[g][c.profile] ?? 0), 0) + cohorts[g].length;
    const chosen = options.sort((a, b) => cost(a) - cost(b))[0]!;
    cohorts[chosen].push(...contacts);
    for (const c of contacts) profileCounts[chosen][c.profile] = (profileCounts[chosen][c.profile] ?? 0) + 1;
  }
  const profileImbalance = Object.fromEntries([...new Set(candidates.map(c => c.profile))].map(p => [p, Math.abs((profileCounts.A[p] ?? 0) - (profileCounts.B[p] ?? 0))]));
  return { state: cohorts.A.length === 50 && cohorts.B.length === 50 && Object.values(profileImbalance).every(n => n <= 2) ? "SAMPLE_PREPARED" : "INCOMPLETE",
    launch_allowed: false, seed, cohorts, held, profile_counts: profileCounts, profile_imbalance: profileImbalance,
    remaining_gates: ["DELIVERY_CORRECTED", "APPROVED_CLAIMS_EVIDENCE", "CURRENT_CAPACITY_WITHIN_CAPS", "BASELINE_AND_FOLLOWUPS_FROZEN"],
    evaluation: "Seven business days for both complete cohorts. Report unique contacts, bounces, human replies, context requests, explicit interest and human-accepted leads. No winner from opens; sparse interest is provisional." };
}
