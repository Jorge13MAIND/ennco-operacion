import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  ApolloReadonlyClient,
  ApolloReadonlyError,
  buildApolloReadonlyPreflight,
  type ApolloReadonlyPreflightInput,
} from "../src/lib/providers/apollo/readonly-client.ts";

type Fixture = {
  profile: unknown;
  email_accounts: unknown[];
  expected: Omit<ApolloReadonlyPreflightInput, "profile" | "email_accounts">;
};

function argumentValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? null : value;
}

function splitMailboxEnvironment(value: string | undefined): string[] {
  if (value === undefined || value.trim() === "") return [];
  return value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
}

function fail(code: string, exitCode = 2): never {
  process.stdout.write(`${JSON.stringify({
    gate_status: "HOLD",
    provider: "Apollo",
    connection_status: "HOLD",
    activation_state: "HOLD",
    external_send_allowed: false,
    provider_mutations_allowed: false,
    blocker: code,
  }, null, 2)}\n`);
  process.exit(exitCode);
}

async function main(): Promise<void> {
  const fixturePath = argumentValue("--fixture");
  const live = process.argv.includes("--live");
  const writeEvidence = process.argv.includes("--write-evidence");
  if ((fixturePath === null) === !live) fail("APOLLO_PREFLIGHT_MODE_REQUIRED");

  let snapshot;
  let evidenceClass: "synthetic_demo" | "live";
  if (fixturePath !== null) {
    evidenceClass = "synthetic_demo";
    const fixture = JSON.parse(await readFile(path.resolve(fixturePath), "utf8")) as Fixture;
    snapshot = buildApolloReadonlyPreflight({
      profile: fixture.profile,
      emailAccountsResponse: { email_accounts: fixture.email_accounts },
      expected: fixture.expected,
    });
  } else {
    evidenceClass = "live";
    const apiKey = process.env.APOLLO_API_KEY?.trim();
    if (apiKey === undefined || apiKey === "") fail("APOLLO_API_KEY_NOT_CONFIGURED");
    const expectedMailboxes = splitMailboxEnvironment(process.env.APOLLO_EXPECTED_MAILBOXES);
    if (expectedMailboxes.length !== 4) {
      fail("APOLLO_EXPECTED_MAILBOXES_MUST_BE_FOUR");
    }
    const expectedTeamId = process.env.APOLLO_EXPECTED_TEAM_ID?.trim();
    if (expectedTeamId === undefined || expectedTeamId === "") fail("APOLLO_EXPECTED_TEAM_ID_NOT_CONFIGURED");
    const client = new ApolloReadonlyClient({ apiKey });
    try {
      const [profile, emailAccounts] = await Promise.all([
        client.getCurrentProfile(),
        client.listEmailAccounts(),
      ]);
      snapshot = buildApolloReadonlyPreflight({
        profile,
        emailAccountsResponse: { email_accounts: emailAccounts },
        expected: {
          observed_at: new Date().toISOString(),
          expected_profile_name: process.env.APOLLO_EXPECTED_PROFILE_NAME?.trim() || "Francisco Cuellar",
          expected_admin_email: process.env.APOLLO_EXPECTED_ADMIN_EMAIL?.trim().toLowerCase()
            || "george@teckel-ai.com",
          expected_team_id: expectedTeamId,
          primary_mailbox: process.env.APOLLO_PRIMARY_MAILBOX?.trim().toLowerCase()
            || "contacto@ennco.com.mx",
          expected_mailboxes: expectedMailboxes,
          research_credit_cap: Number(process.env.APOLLO_RESEARCH_CREDIT_CAP ?? "300"),
          maximum_sync_age_seconds: 300,
          maximum_daily_limit: 20,
        },
      });
    } catch (error) {
      fail(error instanceof ApolloReadonlyError ? error.code : "APOLLO_PREFLIGHT_UNEXPECTED_FAILURE", 1);
    }
  }

  const report = {
    schema_version: "1.0.0",
    evidence_class: evidenceClass,
    source: evidenceClass === "live" ? "APOLLO_API_READ_ONLY" : "SYNTHETIC_FIXTURE",
    ...snapshot,
  };
  if (writeEvidence) {
    const evidenceDir = path.resolve("evidence/m24-apollo");
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(path.join(evidenceDir, "apollo-readonly-preflight.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (snapshot.connection_status !== "READ_ONLY_VERIFIED" || snapshot.external_send_allowed !== false) {
    process.exitCode = 1;
  }
}

await main();
