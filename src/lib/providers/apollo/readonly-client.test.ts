import { describe, expect, it, vi } from "vitest";
import {
  ApolloReadonlyClient,
  ApolloReadonlyError,
  buildApolloReadonlyPreflight,
  mapApolloExactContactSearch,
} from "@/lib/providers/apollo/readonly-client";
import { reconcileApolloExactPausedEnrollment } from "@/lib/providers/apollo/reconciliation";

const observedAt = "2026-08-20T18:00:00.000Z";
const profile = {
  id: "user-francisco",
  team_id: "team-teckel-dedicated-ennco",
  first_name: "Francisco",
  last_name: "Cuellar",
  email: "george@teckel-ai.com",
  num_credits_remaining: 4_010,
  effective_num_lead_credits: 4_010,
  num_lead_credits_used: 0,
};

const mailboxEmails = [
  "contacto@ennco.com.mx",
  "francisco@enncoindustrial.test",
  "fcuellar@enncoindustrial.test",
  "francisco@enncoenergia.test",
];

const emailAccounts = mailboxEmails.map((email, index) => ({
  id: `mailbox-${index + 1}`,
  user_id: "user-francisco",
  email,
  type: "gmail",
  active: true,
  last_synced_at: "2026-08-20T17:59:30.000Z",
  revoked_at: null,
  inactive_reason: null,
  email_daily_threshold: 2,
  is_opted_in_mailwarming: email !== "contacto@ennco.com.mx",
  mailwarming_status: email === "contacto@ennco.com.mx" ? null : "running",
  true_warmup_enabled: email !== "contacto@ennco.com.mx",
  true_warmup_status: email === "contacto@ennco.com.mx" ? null : "active",
}));

function expected() {
  return {
    observed_at: observedAt,
    expected_profile_name: "Francisco Cuellar",
    expected_admin_email: "george@teckel-ai.com",
    expected_team_id: "team-teckel-dedicated-ennco",
    primary_mailbox: "contacto@ennco.com.mx",
    expected_mailboxes: mailboxEmails,
    research_credit_cap: 300,
    maximum_sync_age_seconds: 300,
    maximum_daily_limit: 20,
  };
}

describe("Apollo read-only client", () => {
  it("uses only the official read endpoints and never exposes the key", async () => {
    const apiKey = "apollo-test-key-never-log-this";
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      expect(init?.headers).toMatchObject({ "x-api-key": apiKey });
      if (url.endsWith("/users/api_profile?include_credit_usage=true")) {
        return new Response(JSON.stringify(profile), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/email_accounts")) {
        return new Response(JSON.stringify({ email_accounts: emailAccounts }), { status: 200 });
      }
      throw new Error("unexpected endpoint");
    });
    const client = new ApolloReadonlyClient({ apiKey, fetchImpl });
    await expect(client.getCurrentProfile()).resolves.toMatchObject({ id: "user-francisco" });
    await expect(client.listEmailAccounts()).resolves.toHaveLength(4);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(await client.getCurrentProfile())).not.toContain(apiKey);
  });

  it("maps the exact contact and paused sequence status without trusting aggregate counters", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        q_keywords: "buyer@example.test",
        page: 1,
        per_page: 100,
      });
      return new Response(JSON.stringify({
        contacts: [{
          id: "contact-1",
          email: "buyer@example.test",
          email_status: "verified",
          email_unsubscribed: false,
          contact_campaign_statuses: [{
            id: "enrollment-1",
            emailer_campaign_id: "sequence-1",
            status: "paused",
            added_at: "2026-08-20T17:55:00.000Z",
            paused_at: "2026-08-20T17:56:00.000Z",
          }],
        }],
        pagination: { page: 1, per_page: 100, total_entries: 1, total_pages: 1 },
      }), { status: 200 });
    });
    const client = new ApolloReadonlyClient({ apiKey: "apollo-test-key-never-log-this", fetchImpl });
    const contacts = await client.searchSavedContactsExactEmail("BUYER@example.test");
    const mapped = mapApolloExactContactSearch({
      contacts,
      expectedEmail: "buyer@example.test",
      expectedSequenceId: "sequence-1",
      observedAt,
    });
    const result = reconcileApolloExactPausedEnrollment({
      expected_email: "buyer@example.test",
      expected_sequence_id: "sequence-1",
      contacts: mapped.contacts,
      enrollments: mapped.enrollments,
      aggregate_campaign_contact_count: 0,
      evaluated_at: observedAt,
      maximum_observation_age_seconds: 300,
    });
    expect(result.status).toBe("VERIFIED_PAUSED");
    expect(result.aggregateCountersTrusted).toBe(false);
  });

  it("produces a sanitized deterministic snapshot and always holds activation", () => {
    const first = buildApolloReadonlyPreflight({ profile, emailAccountsResponse: { email_accounts: emailAccounts }, expected: expected() });
    const second = buildApolloReadonlyPreflight({ profile, emailAccountsResponse: { email_accounts: emailAccounts }, expected: expected() });
    expect(first.connection_status).toBe("READ_ONLY_VERIFIED");
    expect(first.external_send_allowed).toBe(false);
    expect(first.provider_mutations_allowed).toBe(false);
    expect(first.activation_state).toBe("HOLD");
    expect(first.snapshot_sha256).toBe(second.snapshot_sha256);
    expect(first.blockers).toContain("APOLLO_LIVE_ACTIVATION_GATES_NOT_EVALUATED");
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain("Francisco");
    expect(serialized).not.toContain("george@teckel-ai.com");
    expect(serialized).not.toContain("enncoindustrial.test");
  });

  it("searches organizations and people without revealing phones, then enriches one email", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({ url, body });
      if (url.endsWith("/mixed_companies/search")) {
        return new Response(JSON.stringify({
          organizations: [{ id: "org-1", name: "Industrial Example", primary_domain: "industrial.example" }],
          pagination: { page: 1, per_page: 100, total_entries: 1, total_pages: 1 },
        }), { status: 200 });
      }
      if (url.endsWith("/mixed_people/api_search")) {
        return new Response(JSON.stringify({
          people: [{ id: "person-1", first_name: "Ana", last_name: "López", title: "Gerente de planta", organization_id: "org-1" }],
          pagination: { page: 1, per_page: 100, total_entries: 1, total_pages: 1 },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        person: { id: "person-1", first_name: "Ana", last_name: "López", email: "ana@industrial.example", email_status: "verified" },
      }), { status: 200 });
    });
    const client = new ApolloReadonlyClient({ apiKey: "apollo-test-key-never-log-this", fetchImpl });
    await expect(client.searchOrganizations({ locations: ["Guanajuato, Mexico"], keywordTags: ["manufacturing"], page: 1 }))
      .resolves.toMatchObject({ organizations: [{ id: "org-1" }] });
    await expect(client.searchPeople({
      organizationDomains: ["industrial.example"],
      titles: ["gerente de planta"],
      seniorities: ["manager"],
      page: 1,
    })).resolves.toMatchObject({ people: [{ id: "person-1" }] });
    await expect(client.enrichPersonEmailOnly({ personId: "person-1" }))
      .resolves.toMatchObject({ email: "ana@industrial.example" });
    expect(requests[1]?.body).toMatchObject({ contact_email_status: ["verified"] });
    expect(requests[2]?.body).toEqual({
      id: "person-1",
      reveal_personal_emails: false,
      reveal_phone_number: false,
    });
    expect(JSON.stringify(requests)).not.toContain("phone_number_callback_url");
  });

  it("fails closed on identity drift, mailbox drift, stale sync, or missing credit evidence", () => {
    const result = buildApolloReadonlyPreflight({
      profile: { ...profile, first_name: "Paco", num_lead_credits_used: undefined },
      emailAccountsResponse: { email_accounts: emailAccounts.slice(0, 2).map((account) => ({
        ...account,
        last_synced_at: "2026-08-19T17:00:00.000Z",
      })) },
      expected: expected(),
    });
    expect(result.activation_state).toBe("HOLD");
    expect(result.blockers).toEqual(expect.arrayContaining([
      "APOLLO_ACTING_ADMIN_IDENTITY_DRIFT",
      "APOLLO_MAILBOX_SET_DRIFT",
      "APOLLO_MAILBOX_SYNC_NOT_FRESH",
      "APOLLO_CREDIT_USAGE_UNAVAILABLE",
    ]));
  });

  it("maps provider authorization failures to stable codes without returning the response body", async () => {
    const secretBody = "provider body with sensitive material";
    const client = new ApolloReadonlyClient({
      apiKey: "apollo-test-key-never-log-this",
      fetchImpl: async () => new Response(secretBody, { status: 403 }),
    });
    await expect(client.getCurrentProfile()).rejects.toEqual(new ApolloReadonlyError("APOLLO_API_SCOPE_OR_PLAN_FORBIDDEN"));
    try {
      await client.getCurrentProfile();
    } catch (error) {
      expect(String(error)).not.toContain(secretBody);
    }
  });
});
