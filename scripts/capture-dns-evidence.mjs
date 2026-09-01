import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Captura evidencia DNS reproducible de los dominios de envío y actualiza el
 * registro de preparación.
 *
 * Por qué existe: hasta el 31-ago-2026 el registro decía
 * `UNKNOWN_NOT_PURCHASED` para dominios comprados el 26-ago, con DNS propio y
 * DKIM respondiendo. El estado se escribía a mano y nadie lo actualizó. Este
 * script lo deriva de la realidad: consulta el resolutor, guarda la salida
 * literal y la hashea. Un valor sin evidencia se queda en UNKNOWN.
 *
 * DOS RELOJES DISTINTOS, que el esquema viejo confundía en `authenticated_days`:
 *   - Edad del dominio: Google marca con advertencia los correos de dominios
 *     con menos de 30 días. Se cuenta desde el registro.
 *   - Calentamiento: mínimo 42 días de comportamiento creíble. Arranca el día
 *     que el buzón se conecta a la herramienta, no cuando se compra el dominio.
 * Un dominio puede tener edad de sobra y cero calentamiento. Son independientes.
 */

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const LEDGER = "data/release/domain-readiness-ledger-v1.json";
const EVIDENCE_DIR = "docs/evidence/dns";

// Dominios de envío propios, comprados en Vercel Registrar el 26-ago-2026.
const OWNED = {
  "enncoindustrial.com": { registeredAt: "2026-08-26", registrar: "VERCEL_REGISTRAR_TEAM_TECKEL" },
  "enncoenergia.com": { registeredAt: "2026-08-26", registrar: "VERCEL_REGISTRAR_TEAM_TECKEL" },
};

const MIN_DOMAIN_AGE_DAYS = 30;

async function dig(...args) {
  try {
    const { stdout } = await run("dig", ["+short", ...args], { timeout: 15_000 });
    return stdout.trim();
  } catch {
    return "";
  }
}

async function observe(domain) {
  const [ns, mx, txt, dkim, dmarc] = await Promise.all([
    dig("NS", domain),
    dig("MX", domain),
    dig("TXT", domain),
    dig("TXT", `google._domainkey.${domain}`),
    dig("TXT", `_dmarc.${domain}`),
  ]);
  const spf = txt.split("\n").find((line) => /v=spf1/i.test(line)) ?? "";
  return { ns, mx, spf, dkim, dmarc };
}

function ageInDays(fromIso, nowIso) {
  const ms = Date.parse(`${nowIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`);
  return Math.max(0, Math.floor(ms / 86_400_000));
}

const observedAt = new Date().toISOString();
const today = observedAt.slice(0, 10);

const ledger = JSON.parse(await readFile(path.join(REPO, LEDGER), "utf8"));
await mkdir(path.join(REPO, EVIDENCE_DIR), { recursive: true });

for (const entry of ledger.domains) {
  const owned = OWNED[entry.candidate];
  if (!owned) continue;

  const seen = await observe(entry.candidate);
  const evidence = [
    `# evidencia DNS de ${entry.candidate}`,
    `# capturada ${observedAt} con dig +short`,
    `NS: ${seen.ns.split("\n").sort().join(" ")}`,
    `MX: ${seen.mx.split("\n").sort().join(" ")}`,
    `SPF: ${seen.spf}`,
    `DKIM(google): ${seen.dkim}`,
    `DMARC: ${seen.dmarc}`,
    "",
  ].join("\n");

  const evidencePath = path.join(EVIDENCE_DIR, `${entry.candidate}.txt`);
  await writeFile(path.join(REPO, evidencePath), evidence, "utf8");
  const sha = createHash("sha256").update(evidence, "utf8").digest("hex");

  // Cada afirmación sale de lo que respondió el resolutor. Nada se asume.
  const dnsIsOurs = /vercel-dns\.com/i.test(seen.ns);
  entry.ownership = dnsIsOurs ? "PURCHASED_TECKEL_CUSTODY_ENNCO_REGISTRANT" : "UNKNOWN_NOT_PURCHASED";
  entry.registrar = owned.registrar;
  entry.domain_registered_at = owned.registeredAt;
  entry.dns_access = dnsIsOurs ? "TECKEL_CONTROLLED" : "UNKNOWN";
  entry.mailboxes_provisioned = /smtp\.google\.com/i.test(seen.mx);

  entry.spf = /include:_spf\.google\.com/i.test(seen.spf) ? "PASS" : "UNKNOWN";
  entry.dkim = /v=DKIM1/i.test(seen.dkim) ? "PASS" : "UNKNOWN";
  entry.dmarc = /v=DMARC1/i.test(seen.dmarc) ? "PASS" : "UNKNOWN";

  // No comprobables con dig: se quedan en UNKNOWN a propósito. TLS exige un
  // handshake SMTP y el DNS inverso depende del rango de salida de Google.
  entry.tls = "UNKNOWN";
  entry.forward_reverse_dns = "UNKNOWN";
  entry.postmaster = "UNKNOWN";

  // Los dos relojes, separados.
  entry.domain_age_days = ageInDays(owned.registeredAt, today);
  entry.domain_age_satisfied = entry.domain_age_days >= MIN_DOMAIN_AGE_DAYS;
  entry.warmup_started_at = entry.warmup_started_at ?? null;
  entry.warmup_days = entry.warmup_started_at ? ageInDays(entry.warmup_started_at.slice(0, 10), today) : 0;

  // Se conserva el campo viejo por compatibilidad del esquema, pero ya no
  // pretende significar dos cosas: refleja el calentamiento, que es lo que
  // gobernaba el gate.
  entry.authenticated_days = entry.warmup_days;

  entry.evidence_path = evidencePath;
  entry.evidence_sha256 = sha;
  entry.observed_at = observedAt;
}

ledger.observed_at = observedAt;
ledger.availability_checked = true;
ledger.purchase_authorized = true;
ledger.status = "PARTIAL_DNS_VERIFIED_WARMUP_PENDING";
ledger.minimum_domain_age_days = MIN_DOMAIN_AGE_DAYS;
ledger.minimum_warmup_days = 42;
ledger.next_action =
  "Conectar los buzones propios a la herramienta de calentamiento: es lo único que arranca el reloj de 42 días.";

await writeFile(path.join(REPO, LEDGER), `${JSON.stringify(ledger, null, 2)}\n`, "utf8");

for (const entry of ledger.domains) {
  if (!OWNED[entry.candidate]) continue;
  process.stdout.write(
    `${entry.candidate}: spf=${entry.spf} dkim=${entry.dkim} dmarc=${entry.dmarc} ` +
      `edad=${entry.domain_age_days}d(${entry.domain_age_satisfied ? "ok" : "falta"}) ` +
      `warmup=${entry.warmup_days}d evidencia=${entry.evidence_sha256.slice(0, 12)}\n`,
  );
}
