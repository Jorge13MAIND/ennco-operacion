import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Compuerta del plan de olas. Vigila lo que haria daño de verdad: que se dispare
// mas de lo presupuestado, que una ola salga sin criterio de alto, que el copy
// referenciado no sea el aprobado, o que el artefacto pierda su estado de HOLD.

const repoArgument = process.argv.indexOf("--repo");
const repo = resolve(repoArgument >= 0 ? process.argv[repoArgument + 1] : ".");
const waves = JSON.parse((await readFile(resolve(repo, "data/campaigns/waves-2026-09-03.json"))).toString("utf8"));
const copy = JSON.parse((await readFile(resolve(repo, "data/campaigns/direct-lane-sequence-v1.json"))).toString("utf8"));
const list = JSON.parse((await readFile(resolve(repo, "data/imports/research/target-list-2026-09-03/target-list-v1.json"))).toString("utf8"));

const checks = [];
const check = (id, ok, observed) => checks.push({ id, status: ok ? "PASS" : "FAIL", observed });

check("HOLD_UNTIL_APPROVED", waves.authorization_state === "RESEARCH_ONLY_HOLD" && waves.external_effects_executed === false, waves.authorization_state);
check("PREREQUISITES_DECLARED", (waves.requiere_antes_de_disparar ?? []).length >= 3, (waves.requiere_antes_de_disparar ?? []).length);

const total = waves.olas.reduce((sum, o) => sum + o.correos_estimados, 0);
check("WITHIN_EMAIL_BUDGET", total <= waves.totales.presupuesto, { total, presupuesto: waves.totales.presupuesto });
check("TOTALS_MATCH_WAVES", total === waves.totales.correos_estimados, { declarado: waves.totales.correos_estimados, sumado: total });

// El copy referenciado tiene que ser el vigente, no una copia vieja.
check("COPY_IS_THE_APPROVED_ONE", waves.copy.source_sha256 === copy.source_sha256, { plan: waves.copy.source_sha256?.slice(0, 12), copy: copy.source_sha256?.slice(0, 12) });
check("SENDER_IS_FRANCISCO", waves.copy.remitente.includes("Francisco Cuellar") && waves.copy.remitente.includes("Director General"), waves.copy.remitente);

// Ninguna ola puede salir sin condicion de alto: una ola sin freno es un envio a ciegas.
const sinFreno = waves.olas.filter((o) => !(o.para_si?.length >= 1) || !(o.avanza_si?.length >= 1));
check("EVERY_WAVE_HAS_STOP_AND_GO_CRITERIA", sinFreno.length === 0, sinFreno.map((o) => o.ola));
check("EVERY_WAVE_HAS_OBSERVATION_WINDOW", waves.olas.every((o) => o.observacion_horas_antes_de_la_siguiente >= 24), waves.olas.map((o) => o.observacion_horas_antes_de_la_siguiente));

// La ola 1 es una sonda: si crece, deja de ser barata de equivocarse.
const ola1 = waves.olas.find((o) => o.ola === 1);
check("WAVE_ONE_STAYS_A_PROBE", ola1.contactos <= 12 && ola1.empresas === ola1.contactos, { contactos: ola1.contactos, empresas: ola1.empresas });

// Las olas crecen, no se encogen: cada una apuesta mas que la anterior.
const creciente = waves.olas.every((o, i, arr) => i === 0 || o.contactos >= arr[i - 1].contactos);
check("WAVES_ESCALATE", creciente, waves.olas.map((o) => o.contactos));

// Todo contacto del plan debe existir en la lista objetivo verificada.
const enLista = new Set(list.seleccion_por_ola.map((c) => c.apollo_person_id));
const fuera = waves.olas.flatMap((o) => o.contactos_detalle).filter((c) => !enLista.has(c.apollo_person_id));
check("EVERY_CONTACT_COMES_FROM_THE_VERIFIED_LIST", fuera.length === 0, fuera.length);

const planned = waves.olas.reduce((sum, o) => sum + o.contactos, 0);
check("NO_CONTACT_LEFT_BEHIND", planned === list.seleccion_por_ola.length, { plan: planned, lista: list.seleccion_por_ola.length });

const failures = checks.filter((c) => c.status === "FAIL");
const result = {
  status: failures.length === 0 ? "PASS" : "FAIL",
  waves: waves.olas.length,
  contacts: planned,
  emails: total,
  check_count: checks.length,
  pass_count: checks.length - failures.length,
  checks,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;
