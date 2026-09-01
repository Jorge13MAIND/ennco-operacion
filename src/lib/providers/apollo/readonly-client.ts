import { createHash } from "node:crypto";
import { z } from "zod";

const timestampSchema = z.iso.datetime({ offset: true });
const normalizedEmailSchema = z.email().transform((value) => value.trim().toLowerCase());
const providerIdSchema = z.string().trim().min(1).max(200);

const apolloProfileSchema = z.object({
  id: providerIdSchema,
  team_id: providerIdSchema,
  first_name: z.string().trim().min(1).max(120),
  last_name: z.string().trim().min(1).max(120),
  email: normalizedEmailSchema,
  num_credits_remaining: z.number().int().min(0).optional(),
  effective_num_lead_credits: z.number().int().min(0).optional(),
  num_lead_credits_used: z.number().int().min(0).optional(),
  total_unified_credits_used: z.number().int().min(0).optional(),
}).passthrough();

const apolloEmailAccountSchema = z.object({
  id: providerIdSchema,
  user_id: providerIdSchema,
  email: normalizedEmailSchema,
  type: z.string().trim().min(1).max(80),
  active: z.boolean(),
  last_synced_at: timestampSchema.nullable().optional(),
  revoked_at: timestampSchema.nullable().optional(),
  inactive_reason: z.string().trim().max(500).nullable().optional(),
  email_daily_threshold: z.number().int().min(0).optional(),
  is_opted_in_mailwarming: z.boolean().nullable().optional(),
  mailwarming_status: z.string().trim().max(120).nullable().optional(),
  true_warmup_enabled: z.boolean().optional(),
  true_warmup_status: z.string().trim().max(120).nullable().optional(),
}).passthrough();

const apolloEmailAccountsResponseSchema = z.object({
  email_accounts: z.array(apolloEmailAccountSchema).max(100),
}).passthrough();

const apolloCampaignStatusSchema = z.object({
  id: providerIdSchema,
  emailer_campaign_id: providerIdSchema,
  status: z.enum(["active", "failed", "paused", "finished"]),
  added_at: timestampSchema,
  paused_at: timestampSchema.nullable().optional(),
}).passthrough();

const apolloContactSchema = z.object({
  id: providerIdSchema,
  email: normalizedEmailSchema,
  email_status: z.string().trim().max(120).nullable().optional(),
  email_unsubscribed: z.boolean().nullable().optional(),
  updated_at: timestampSchema.nullable().optional(),
  contact_campaign_statuses: z.array(apolloCampaignStatusSchema).max(100).default([]),
}).passthrough();

const apolloContactsSearchResponseSchema = z.object({
  contacts: z.array(apolloContactSchema).max(100),
  pagination: z.object({
    page: z.number().int().min(1),
    per_page: z.number().int().min(1).max(100),
    total_entries: z.number().int().min(0),
    total_pages: z.number().int().min(0),
  }).passthrough().optional(),
}).passthrough();

const apolloOrganizationSchema = z.object({
  id: providerIdSchema,
  name: z.string().trim().min(1).max(300),
  primary_domain: z.string().trim().toLowerCase().max(253).nullable().optional(),
  website_url: z.url().nullable().optional(),
  industry: z.string().trim().max(200).nullable().optional(),
  estimated_num_employees: z.number().int().min(0).nullable().optional(),
  city: z.string().trim().max(200).nullable().optional(),
  state: z.string().trim().max(200).nullable().optional(),
  country: z.string().trim().max(200).nullable().optional(),
}).passthrough();

const apolloOrganizationSearchResponseSchema = z.object({
  organizations: z.array(apolloOrganizationSchema).max(100),
  pagination: z.object({
    page: z.number().int().min(1),
    per_page: z.number().int().min(1).max(100),
    total_entries: z.number().int().min(0),
    total_pages: z.number().int().min(0),
  }).passthrough().optional(),
}).passthrough();

const apolloPersonSearchSchema = z.object({
  id: providerIdSchema,
  first_name: z.string().trim().min(1).max(120),
  last_name: z.string().trim().min(1).max(120),
  title: z.string().trim().max(300).nullable().optional(),
  organization_id: providerIdSchema.nullable().optional(),
  organization: apolloOrganizationSchema.nullable().optional(),
}).passthrough();

const apolloPeopleSearchResponseSchema = z.object({
  people: z.array(apolloPersonSearchSchema).max(100),
  pagination: z.object({
    page: z.number().int().min(1),
    per_page: z.number().int().min(1).max(100),
    total_entries: z.number().int().min(0),
    total_pages: z.number().int().min(0),
  }).passthrough().optional(),
}).passthrough();

const apolloEnrichedPersonSchema = z.object({
  id: providerIdSchema,
  first_name: z.string().trim().min(1).max(120),
  last_name: z.string().trim().min(1).max(120),
  title: z.string().trim().max(300).nullable().optional(),
  email: normalizedEmailSchema.nullable().optional(),
  email_status: z.string().trim().max(120).nullable().optional(),
  organization_id: providerIdSchema.nullable().optional(),
  organization: apolloOrganizationSchema.nullable().optional(),
}).passthrough();

const apolloPeopleMatchResponseSchema = z.object({
  person: apolloEnrichedPersonSchema.nullable(),
}).passthrough();

const apolloReadonlyPreflightInputSchema = z.object({
  profile: apolloProfileSchema,
  email_accounts: z.array(apolloEmailAccountSchema).max(100),
  observed_at: timestampSchema,
  expected_profile_name: z.string().trim().min(1).max(241),
  expected_admin_email: normalizedEmailSchema,
  expected_team_id: providerIdSchema,
  primary_mailbox: normalizedEmailSchema,
  expected_mailboxes: z.array(normalizedEmailSchema).max(4),
  research_credit_cap: z.number().int().min(1).max(300),
  maximum_sync_age_seconds: z.number().int().min(60).max(86_400).default(300),
  maximum_daily_limit: z.number().int().min(1).max(20).default(20),
}).strict();

export type ApolloReadonlyPreflightInput = z.input<typeof apolloReadonlyPreflightInputSchema>;

export type ApolloReadonlyPreflight = {
  gate_status: "PASS" | "HOLD";
  provider: "Apollo";
  connection_status: "READ_ONLY_VERIFIED" | "HOLD";
  activation_state: "HOLD";
  external_send_allowed: false;
  provider_mutations_allowed: false;
  observed_at: string;
  acting_user_ref_sha256: string | null;
  team_ref_sha256: string | null;
  expected_admin_email_sha256: string;
  expected_team_ref_sha256: string;
  identity_state: "MATCH" | "DRIFT" | "UNKNOWN";
  credit_usage: {
    lead_credits_used: number | null;
    lead_credits_remaining: number | null;
    configured_cap: number;
    state: "WITHIN_CAP" | "OVER_CAP" | "UNKNOWN";
  };
  mailbox_summary: {
    expected: 4;
    observed: number;
    exact_set_matches: boolean;
    active: number;
    fresh: number;
    warmup_enabled: number;
    warmup_expected: 3;
    within_daily_limit: number;
    mailbox_ref_sha256: string[];
  };
  allowed_api_operations: readonly [
    "GET_CURRENT_USER_PROFILE",
    "LIST_EMAIL_ACCOUNTS",
    "SEARCH_SAVED_CONTACTS_EXACT_EMAIL",
    "SEARCH_ORGANIZATIONS",
    "SEARCH_PEOPLE",
    "ENRICH_PERSON_EMAIL_ONLY",
  ];
  blockers: string[];
  snapshot_sha256: string;
};

export class ApolloReadonlyError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "ApolloReadonlyError";
  }
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class ApolloReadonlyClient {
  private readonly fetchImpl: FetchLike;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly baseUrl: URL;

  constructor(input: {
    apiKey: string;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
    baseUrl?: string;
  }) {
    this.apiKey = input.apiKey.trim();
    if (this.apiKey.length < 16 || this.apiKey.length > 1_024) {
      throw new ApolloReadonlyError("APOLLO_API_KEY_INVALID");
    }
    this.baseUrl = new URL(input.baseUrl ?? "https://api.apollo.io/api/v1/");
    if (this.baseUrl.protocol !== "https:" || this.baseUrl.hostname !== "api.apollo.io") {
      throw new ApolloReadonlyError("APOLLO_API_ORIGIN_INVALID");
    }
    this.timeoutMs = input.timeoutMs ?? 10_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1_000 || this.timeoutMs > 30_000) {
      throw new ApolloReadonlyError("APOLLO_API_TIMEOUT_INVALID");
    }
    this.fetchImpl = input.fetchImpl ?? fetch;
  }

  async getCurrentProfile(): Promise<z.infer<typeof apolloProfileSchema>> {
    const raw = await this.requestJson("GET", "users/api_profile?include_credit_usage=true");
    const parsed = apolloProfileSchema.safeParse(raw);
    if (!parsed.success) throw new ApolloReadonlyError("APOLLO_PROFILE_SCHEMA_INVALID");
    return parsed.data;
  }

  async listEmailAccounts(): Promise<z.infer<typeof apolloEmailAccountsResponseSchema>["email_accounts"]> {
    const raw = await this.requestJson("GET", "email_accounts");
    const parsed = apolloEmailAccountsResponseSchema.safeParse(raw);
    if (!parsed.success) throw new ApolloReadonlyError("APOLLO_EMAIL_ACCOUNTS_SCHEMA_INVALID");
    return parsed.data.email_accounts;
  }

  async searchSavedContactsExactEmail(email: string): Promise<z.infer<typeof apolloContactSchema>[]> {
    const parsedEmail = normalizedEmailSchema.safeParse(email);
    if (!parsedEmail.success) throw new ApolloReadonlyError("APOLLO_CONTACT_EMAIL_INVALID");
    const raw = await this.requestJson("POST", "contacts/search", {
      q_keywords: parsedEmail.data,
      page: 1,
      per_page: 100,
    });
    const parsed = apolloContactsSearchResponseSchema.safeParse(raw);
    if (!parsed.success) throw new ApolloReadonlyError("APOLLO_CONTACT_SEARCH_SCHEMA_INVALID");
    return parsed.data.contacts.filter((contact) => contact.email === parsedEmail.data);
  }

  async searchOrganizations(input: {
    locations: string[];
    keywordTags: string[];
    page: number;
    perPage?: number;
  }): Promise<z.infer<typeof apolloOrganizationSearchResponseSchema>> {
    const parsed = z.object({
      locations: z.array(z.string().trim().min(2).max(120)).min(1).max(10),
      keywordTags: z.array(z.string().trim().min(2).max(120)).min(1).max(20),
      page: z.number().int().min(1).max(500),
      perPage: z.number().int().min(1).max(100).default(100),
    }).strict().safeParse(input);
    if (!parsed.success) throw new ApolloReadonlyError("APOLLO_ORGANIZATION_SEARCH_INPUT_INVALID");
    const raw = await this.requestJson("POST", "mixed_companies/search", {
      organization_locations: parsed.data.locations,
      q_organization_keyword_tags: parsed.data.keywordTags,
      page: parsed.data.page,
      per_page: parsed.data.perPage,
    });
    const response = apolloOrganizationSearchResponseSchema.safeParse(raw);
    if (!response.success) throw new ApolloReadonlyError("APOLLO_ORGANIZATION_SEARCH_SCHEMA_INVALID");
    return response.data;
  }

  async searchPeople(input: {
    organizationDomains: string[];
    titles: string[];
    seniorities: string[];
    page: number;
    perPage?: number;
  }): Promise<z.infer<typeof apolloPeopleSearchResponseSchema>> {
    const parsed = z.object({
      organizationDomains: z.array(z.string().trim().toLowerCase().min(3).max(253)).min(1).max(1_000),
      titles: z.array(z.string().trim().min(2).max(160)).min(1).max(30),
      seniorities: z.array(z.enum(["owner", "founder", "c_suite", "partner", "vp", "head", "director", "manager", "senior"])).min(1).max(9),
      page: z.number().int().min(1).max(500),
      perPage: z.number().int().min(1).max(100).default(100),
    }).strict().safeParse(input);
    if (!parsed.success) throw new ApolloReadonlyError("APOLLO_PEOPLE_SEARCH_INPUT_INVALID");
    const raw = await this.requestJson("POST", "mixed_people/api_search", {
      q_organization_domains_list: parsed.data.organizationDomains,
      person_titles: parsed.data.titles,
      person_seniorities: parsed.data.seniorities,
      contact_email_status: ["verified"],
      page: parsed.data.page,
      per_page: parsed.data.perPage,
    });
    const response = apolloPeopleSearchResponseSchema.safeParse(raw);
    if (!response.success) throw new ApolloReadonlyError("APOLLO_PEOPLE_SEARCH_SCHEMA_INVALID");
    return response.data;
  }

  async enrichPersonEmailOnly(input: {
    personId: string;
  }): Promise<z.infer<typeof apolloEnrichedPersonSchema> | null> {
    const parsed = z.object({ personId: providerIdSchema }).strict().safeParse(input);
    if (!parsed.success) throw new ApolloReadonlyError("APOLLO_PERSON_ENRICH_INPUT_INVALID");
    const raw = await this.requestJson("POST", "people/match", {
      id: parsed.data.personId,
      reveal_personal_emails: false,
      reveal_phone_number: false,
    });
    const response = apolloPeopleMatchResponseSchema.safeParse(raw);
    if (!response.success) throw new ApolloReadonlyError("APOLLO_PERSON_ENRICH_SCHEMA_INVALID");
    return response.data.person;
  }

  private async requestJson(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<unknown> {
    const allowed = (method === "GET" && (path === "users/api_profile?include_credit_usage=true" || path === "email_accounts"))
      || (method === "POST" && [
        "contacts/search",
        "mixed_companies/search",
        "mixed_people/api_search",
        "people/match",
      ].includes(path));
    if (!allowed) throw new ApolloReadonlyError("APOLLO_API_OPERATION_NOT_ALLOWED");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(new URL(path, this.baseUrl), {
        method,
        headers: {
          accept: "application/json",
          "cache-control": "no-cache",
          "content-type": "application/json",
          "x-api-key": this.apiKey,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new ApolloReadonlyError("APOLLO_API_TIMEOUT");
      }
      throw new ApolloReadonlyError("APOLLO_API_UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      if (response.status === 401) throw new ApolloReadonlyError("APOLLO_API_UNAUTHORIZED");
      if (response.status === 403) throw new ApolloReadonlyError("APOLLO_API_SCOPE_OR_PLAN_FORBIDDEN");
      if (response.status === 429) throw new ApolloReadonlyError("APOLLO_API_RATE_LIMITED");
      throw new ApolloReadonlyError(response.status >= 500 ? "APOLLO_API_PROVIDER_ERROR" : "APOLLO_API_REQUEST_REJECTED");
    }

    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 2_000_000) {
      throw new ApolloReadonlyError("APOLLO_API_RESPONSE_TOO_LARGE");
    }
    const text = await response.text();
    if (text.length > 2_000_000) throw new ApolloReadonlyError("APOLLO_API_RESPONSE_TOO_LARGE");
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new ApolloReadonlyError("APOLLO_API_RESPONSE_NOT_JSON");
    }
  }
}

function normalizeIdentity(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("es-MX");
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

export function evaluateApolloReadonlyPreflight(rawInput: ApolloReadonlyPreflightInput): ApolloReadonlyPreflight {
  const parsed = apolloReadonlyPreflightInputSchema.safeParse(rawInput);
  const expectedAdminEmail = typeof rawInput.expected_admin_email === "string"
    ? rawInput.expected_admin_email.trim().toLowerCase()
    : "invalid@invalid.local";
  const expectedTeamId = typeof rawInput.expected_team_id === "string"
    ? rawInput.expected_team_id.trim()
    : "invalid-team";
  const unknownSnapshot = (blocker: string): ApolloReadonlyPreflight => {
    const base = {
      gate_status: "HOLD" as const,
      provider: "Apollo" as const,
      connection_status: "HOLD" as const,
      activation_state: "HOLD" as const,
      external_send_allowed: false as const,
      provider_mutations_allowed: false as const,
      observed_at: typeof rawInput.observed_at === "string" ? rawInput.observed_at : new Date(0).toISOString(),
      acting_user_ref_sha256: null,
      team_ref_sha256: null,
      expected_admin_email_sha256: sha256(expectedAdminEmail),
      expected_team_ref_sha256: sha256(expectedTeamId),
      identity_state: "UNKNOWN" as const,
      credit_usage: { lead_credits_used: null, lead_credits_remaining: null, configured_cap: 300, state: "UNKNOWN" as const },
      mailbox_summary: {
        expected: 4 as const, observed: 0, exact_set_matches: false, active: 0, fresh: 0,
        warmup_enabled: 0, warmup_expected: 3 as const, within_daily_limit: 0, mailbox_ref_sha256: [],
      },
      allowed_api_operations: [
        "GET_CURRENT_USER_PROFILE",
        "LIST_EMAIL_ACCOUNTS",
        "SEARCH_SAVED_CONTACTS_EXACT_EMAIL",
        "SEARCH_ORGANIZATIONS",
        "SEARCH_PEOPLE",
        "ENRICH_PERSON_EMAIL_ONLY",
      ] as const,
      blockers: [blocker],
    };
    return { ...base, snapshot_sha256: sha256(base) };
  };
  if (!parsed.success) return unknownSnapshot("APOLLO_PREFLIGHT_INPUT_INVALID");

  const input = parsed.data;
  const blockers: string[] = [];
  const expectedMailboxSet = new Set(input.expected_mailboxes);
  const observedMailboxSet = new Set(input.email_accounts.map((account) => account.email));
  if (expectedMailboxSet.size !== 4 || !expectedMailboxSet.has(input.primary_mailbox)) {
    blockers.push("APOLLO_EXPECTED_MAILBOX_SET_NOT_CONFIGURED");
  }
  const exactSetMatches = expectedMailboxSet.size === 4
    && observedMailboxSet.size === 4
    && [...expectedMailboxSet].every((email) => observedMailboxSet.has(email));
  if (!exactSetMatches) blockers.push("APOLLO_MAILBOX_SET_DRIFT");

  const identityMatches = normalizeIdentity(`${input.profile.first_name} ${input.profile.last_name}`)
      === normalizeIdentity(input.expected_profile_name)
    && input.profile.email === input.expected_admin_email
    && input.profile.team_id === input.expected_team_id;
  if (!identityMatches) blockers.push("APOLLO_ACTING_ADMIN_IDENTITY_DRIFT");

  const observedAt = Date.parse(input.observed_at);
  const relevantMailboxes = input.email_accounts.filter((account) => expectedMailboxSet.has(account.email));
  const active = relevantMailboxes.filter((account) => account.active && account.revoked_at == null).length;
  const fresh = relevantMailboxes.filter((account) => {
    if (account.last_synced_at == null) return false;
    const age = observedAt - Date.parse(account.last_synced_at);
    return age >= -30_000 && age <= input.maximum_sync_age_seconds * 1_000;
  }).length;
  const isolatedMailboxes = relevantMailboxes.filter((account) => account.email !== input.primary_mailbox);
  const warmupEnabled = isolatedMailboxes.filter((account) => (
    account.true_warmup_enabled === true || account.is_opted_in_mailwarming === true
  )).length;
  const withinDailyLimit = relevantMailboxes.filter((account) => (
    account.email_daily_threshold !== undefined && account.email_daily_threshold <= input.maximum_daily_limit
  )).length;
  if (active !== 4) blockers.push("APOLLO_MAILBOXES_NOT_ACTIVE");
  if (fresh !== 4) blockers.push("APOLLO_MAILBOX_SYNC_NOT_FRESH");
  if (warmupEnabled !== 3) blockers.push("APOLLO_MAILBOX_WARMUP_NOT_ENABLED");
  if (withinDailyLimit !== 4) blockers.push("APOLLO_MAILBOX_DAILY_LIMIT_INVALID");

  const leadCreditsUsed = input.profile.num_lead_credits_used ?? null;
  const leadCreditsRemaining = input.profile.num_credits_remaining ?? null;
  const creditState = leadCreditsUsed === null
    ? "UNKNOWN" as const
    : leadCreditsUsed > input.research_credit_cap ? "OVER_CAP" as const : "WITHIN_CAP" as const;
  if (creditState === "UNKNOWN") blockers.push("APOLLO_CREDIT_USAGE_UNAVAILABLE");
  if (creditState === "OVER_CAP") blockers.push("APOLLO_RESEARCH_CREDIT_CAP_EXCEEDED");
  blockers.push("APOLLO_SENDER_DISPLAY_REQUIRES_SEED_EVIDENCE");
  blockers.push("WARMUP_42_DAYS_REQUIRES_PLATFORM_EVIDENCE");
  blockers.push("APOLLO_LIVE_ACTIVATION_GATES_NOT_EVALUATED");

  const coreBlockers = blockers.filter((blocker) => ![
    "APOLLO_SENDER_DISPLAY_REQUIRES_SEED_EVIDENCE",
    "WARMUP_42_DAYS_REQUIRES_PLATFORM_EVIDENCE",
    "APOLLO_LIVE_ACTIVATION_GATES_NOT_EVALUATED",
  ].includes(blocker));
  const readVerified = coreBlockers.length === 0;
  const base = {
    gate_status: readVerified ? "PASS" as const : "HOLD" as const,
    provider: "Apollo" as const,
    connection_status: readVerified ? "READ_ONLY_VERIFIED" as const : "HOLD" as const,
    activation_state: "HOLD" as const,
    external_send_allowed: false as const,
    provider_mutations_allowed: false as const,
    observed_at: input.observed_at,
    acting_user_ref_sha256: sha256(input.profile.id),
    team_ref_sha256: sha256(input.profile.team_id),
    expected_admin_email_sha256: sha256(input.expected_admin_email),
    expected_team_ref_sha256: sha256(input.expected_team_id),
    identity_state: identityMatches ? "MATCH" as const : "DRIFT" as const,
    credit_usage: {
      lead_credits_used: leadCreditsUsed,
      lead_credits_remaining: leadCreditsRemaining,
      configured_cap: input.research_credit_cap,
      state: creditState,
    },
    mailbox_summary: {
      expected: 4 as const,
      observed: input.email_accounts.length,
      exact_set_matches: exactSetMatches,
      active,
      fresh,
      warmup_enabled: warmupEnabled,
      warmup_expected: 3 as const,
      within_daily_limit: withinDailyLimit,
      mailbox_ref_sha256: relevantMailboxes.map((account) => sha256({ id: account.id, email: account.email })).sort(),
    },
    allowed_api_operations: [
      "GET_CURRENT_USER_PROFILE",
      "LIST_EMAIL_ACCOUNTS",
      "SEARCH_SAVED_CONTACTS_EXACT_EMAIL",
      "SEARCH_ORGANIZATIONS",
      "SEARCH_PEOPLE",
      "ENRICH_PERSON_EMAIL_ONLY",
    ] as const,
    blockers: [...new Set(blockers)].sort(),
  };
  return { ...base, snapshot_sha256: sha256(base) };
}

export function buildApolloReadonlyPreflight(input: {
  profile: unknown;
  emailAccountsResponse: unknown;
  expected: Omit<ApolloReadonlyPreflightInput, "profile" | "email_accounts">;
}): ApolloReadonlyPreflight {
  const profile = apolloProfileSchema.safeParse(input.profile);
  const emailAccounts = apolloEmailAccountsResponseSchema.safeParse(input.emailAccountsResponse);
  if (!profile.success || !emailAccounts.success) {
    return evaluateApolloReadonlyPreflight({
      ...input.expected,
      profile: input.profile,
      email_accounts: emailAccounts.success ? emailAccounts.data.email_accounts : [],
    } as ApolloReadonlyPreflightInput);
  }
  return evaluateApolloReadonlyPreflight({
    ...input.expected,
    profile: profile.data,
    email_accounts: emailAccounts.data.email_accounts,
  });
}

export function mapApolloExactContactSearch(input: {
  contacts: unknown;
  expectedEmail: string;
  expectedSequenceId: string;
  observedAt: string;
}): {
  contacts: Array<{
    contact_id: string;
    normalized_email: string;
    lifecycle_status: "VERIFIED" | "PAUSED" | "ENROLLED" | "UNSUBSCRIBED";
    observed_at: string;
    evidence_sha256: string;
  }>;
  enrollments: Array<{
    enrollment_id: string;
    sequence_id: string;
    contact_id: string;
    normalized_email: string;
    status: "PAUSED" | "ACTIVE" | "FINISHED" | "FAILED";
    observed_at: string;
    evidence_sha256: string;
  }>;
} {
  const parsedContacts = z.array(apolloContactSchema).max(100).safeParse(input.contacts);
  const email = normalizedEmailSchema.safeParse(input.expectedEmail);
  const sequenceId = providerIdSchema.safeParse(input.expectedSequenceId);
  const observedAt = timestampSchema.safeParse(input.observedAt);
  if (!parsedContacts.success || !email.success || !sequenceId.success || !observedAt.success) {
    throw new ApolloReadonlyError("APOLLO_EXACT_READBACK_INPUT_INVALID");
  }
  const exact = parsedContacts.data.filter((contact) => contact.email === email.data);
  return {
    contacts: exact.map((contact) => {
      const campaignStates = contact.contact_campaign_statuses.map((status) => status.status);
      const lifecycle = contact.email_unsubscribed === true
        ? "UNSUBSCRIBED" as const
        : campaignStates.includes("paused") ? "PAUSED" as const
          : campaignStates.includes("active") ? "ENROLLED" as const : "VERIFIED" as const;
      return {
        contact_id: contact.id,
        normalized_email: contact.email,
        lifecycle_status: lifecycle,
        observed_at: observedAt.data,
        evidence_sha256: sha256(contact),
      };
    }),
    enrollments: exact.flatMap((contact) => contact.contact_campaign_statuses
      .filter((status) => status.emailer_campaign_id === sequenceId.data)
      .map((status) => ({
        enrollment_id: status.id,
        sequence_id: status.emailer_campaign_id,
        contact_id: contact.id,
        normalized_email: contact.email,
        status: ({ active: "ACTIVE", failed: "FAILED", paused: "PAUSED", finished: "FINISHED" } as const)[status.status],
        observed_at: observedAt.data,
        evidence_sha256: sha256(status),
      }))),
  };
}
