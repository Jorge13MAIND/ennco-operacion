import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Compuerta de la lista objetivo de los primeros 500 correos.
// Nace el 3-sep-2026 despues de encontrar, al construirla, un contacto asignado
// a la empresa equivocada y dos ids de Apollo inventados al transcribir. Un id
// inventado no falla ruidosamente: falla el dia del envio, contra una persona
// que no existe. Por eso el formato y la unicidad se verifican aqui.

const repoArgument = process.argv.indexOf("--repo");
const repo = resolve(repoArgument >= 0 ? process.argv[repoArgument + 1] : ".");
const path = resolve(repo, "data/imports/research/target-list-2026-09-03/target-list-v1.json");
const list = JSON.parse((await readFile(path)).toString("utf8"));

const checks = [];
const check = (id, ok, observed) => checks.push({ id, status: ok ? "PASS" : "FAIL", observed });

const seleccion = list.seleccion_por_ola ?? [];
const empresas = list.empresas_priorizadas ?? [];

check("RESEARCH_ONLY_HOLD", list.authorization_state === "RESEARCH_ONLY_HOLD" && list.external_effects_executed === false, list.authorization_state);

const ids = seleccion.map((c) => c.apollo_person_id);
check("APOLLO_ID_SHAPE", ids.every((id) => /^[0-9a-f]{24}$/.test(id)), ids.filter((id) => !/^[0-9a-f]{24}$/.test(id)));
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
check("NO_DUPLICATE_CONTACTS", dupes.length === 0, dupes);

// Cada contacto de la seleccion debe existir en el inventario de su empresa.
const inventory = new Map(empresas.map((e) => [e.empresa, new Set(e.contactos.map((c) => c.apollo_person_id))]));
const orphans = seleccion.filter((c) => !inventory.get(c.empresa)?.has(c.apollo_person_id));
check("EVERY_CONTACT_BELONGS_TO_ITS_COMPANY", orphans.length === 0, orphans.map((o) => `${o.empresa}:${o.apollo_person_id}`));

const perCompany = new Map();
for (const c of seleccion) perCompany.set(c.empresa, (perCompany.get(c.empresa) ?? 0) + 1);
const overloaded = [...perCompany.entries()].filter(([, n]) => n > 3);
check("MAX_THREE_CONTACTS_PER_COMPANY", overloaded.length === 0, overloaded);

const VARIANTS = new Set(["MANTENIMIENTO", "DIRECCION", "SEGURIDAD", "COMPRAS"]);
check("EVERY_CONTACT_HAS_A_COPY_VARIANT", seleccion.every((c) => VARIANTS.has(c.variante_copy)), seleccion.filter((c) => !VARIANTS.has(c.variante_copy)).length);

// Anexo A: ninguna de las tres razones sociales ni sus alias puede aparecer.
const ANNEX = ["posco", "mpe plastic", "materias plasticas", "laproba", "tejas el aguila"];
const hits = empresas.filter((e) => ANNEX.some((a) => e.empresa.toLowerCase().includes(a)));
check("NO_ANNEX_A_COMPANIES", hits.length === 0, hits.map((h) => h.empresa));
check("ANNEX_A_EXCLUSIONS_DOCUMENTED", Array.isArray(list.excluidas) && list.excluidas.length > 0, (list.excluidas ?? []).length);

// El presupuesto es de 500 correos: la seleccion por 3 toques no puede pasarse.
const correos = seleccion.length * (list.plan_envio?.toques_por_contacto ?? 3);
check("WITHIN_500_EMAIL_BUDGET", correos <= 500, correos);
check("USES_AT_LEAST_80_PERCENT_OF_BUDGET", correos >= 400, correos);

// La ola 1 es la prueba de entrega: pocas cuentas, un contacto cada una.
const ola1 = seleccion.filter((c) => c.ola === "1");
check("WAVE_ONE_IS_A_PROBE", ola1.length <= 12 && new Set(ola1.map((c) => c.empresa)).size === ola1.length, ola1.length);

const failures = checks.filter((c) => c.status === "FAIL");
const result = {
  status: failures.length === 0 ? "PASS" : "FAIL",
  companies: empresas.length,
  contacts: seleccion.length,
  estimated_emails: correos,
  check_count: checks.length,
  pass_count: checks.length - failures.length,
  checks,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;
