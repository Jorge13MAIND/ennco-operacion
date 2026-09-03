import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Compuerta del copy VIVO de la secuencia (el markdown que se envia), distinta
// de verify:campaign, que valida el artefacto sintetico JSON del canary.
//
// Nace el 3-sep-2026, cuando el copy paso a la voz aprobada por Francisco
// Cuellar. Vigila lo que ese cambio puso en riesgo: el tope de palabras del
// motor (120, migracion M042), las prohibiciones del contrato, la baja
// obligatoria del toque 8 y que ningun prospecto reciba dos asuntos iguales.

const repoArgument = process.argv.indexOf("--repo");
const repo = resolve(repoArgument >= 0 ? process.argv[repoArgument + 1] : ".");
const path = resolve(repo, "docs/external/secuencia-ennco-copy.md");
const source = (await readFile(path)).toString("utf8");

const WORD_LIMIT = 120;            // igual al trigger de la base (M042)
const CTA_MIN_WORDS = 35;          // el registro aprobado por el cliente es corto: 40-75 palabras
                                   // del toque 2 en adelante. Por debajo de 35 ya no dice nada.
const PROHIBITED = /garantiz|descuento|precio final|\bahorro de \d|\d+\s*%|https?:\/\/|<[a-z/]|[—–]/i;
const JARGON = /termograf|dron\b|kWp|curva IV|NOM-\d|arco el[eé]ctrico/i;

const bodies = [...source.matchAll(/```\n([\s\S]*?)\n```/g)].map((m) => m[1]);
const subjects = [...source.matchAll(/\*\*Asunto:\*\* (.+)/g)].map((m) => m[1].trim());

// La seccion de segunda vuelta juega con otras reglas: el acuse al referidor es
// un agradecimiento, no un CTA, asi que no se le exige pregunta.
const followUpStart = source.indexOf("# Segunda vuelta");
const sequenceSource = followUpStart > 0 ? source.slice(0, followUpStart) : source;
const sequenceCount = [...sequenceSource.matchAll(/```\n([\s\S]*?)\n```/g)].length;

const checks = [];
const check = (id, ok, observed) => checks.push({ id, status: ok ? "PASS" : "FAIL", observed });

// Un cierre (toque 8) no lleva pregunta: es un cierre, no un CTA. Se identifica
// por la baja explicita, que es justamente lo que lo define.
const isClosing = (body) => /respóndeme la palabra baja|responde la palabra baja/i.test(body);

check("SEQUENCE_FILE_PARSED", bodies.length >= 32 && subjects.length >= 32, { bodies: bodies.length, subjects: subjects.length });

const tooLong = bodies.map((b, i) => ({ i: i + 1, w: b.trim().split(/\s+/).length })).filter((x) => x.w > WORD_LIMIT);
check("BODY_WITHIN_ENGINE_WORD_LIMIT", tooLong.length === 0, tooLong.length ? tooLong : `max ${Math.max(...bodies.map((b) => b.trim().split(/\s+/).length))}`);

const tooShort = bodies.map((b, i) => ({ i: i + 1, w: b.trim().split(/\s+/).length, closing: isClosing(b) }))
  .filter((x) => !x.closing && x.w < CTA_MIN_WORDS && x.w > 40);
check("CTA_BODIES_NOT_HOLLOW", tooShort.length === 0, tooShort);

const ctaCounts = bodies.map((b, i) => ({ i: i + 1, q: (b.match(/\?/g) ?? []).length, closing: isClosing(b) }));
check("AT_MOST_TWO_CTAS", ctaCounts.every((x) => x.q <= 2), ctaCounts.filter((x) => x.q > 2));
const sequenceCtas = ctaCounts.slice(0, sequenceCount);
// Un CTA puede ser pregunta ("¿Cuando podemos platicar?") o peticion directa
// ("Avisame si puedo llamarte"), que es como cierra su toque 2.
const SOFT_CTA = /av[ií]same|me dices|dime|me confirmas|quedo a tus/i;
const hasCta = (i) => sequenceCtas[i].q >= 1 || SOFT_CTA.test(bodies[i]);
const noCta = sequenceCtas.map((x, i) => ({ ...x, i: i + 1 })).filter((x, i) => !x.closing && !hasCta(i));
check("EVERY_NON_CLOSING_HAS_A_CTA", noCta.length === 0, noCta);
check("THIRTY_TWO_SEQUENCE_EMAILS", sequenceCount === 32, sequenceCount);

const openingMarks = bodies.map((b, i) => {
  const opens = (b.match(/¿/g) ?? []).length;
  const closes = (b.match(/\?/g) ?? []).length;
  return { i: i + 1, opens, closes };
}).filter((x) => x.opens !== x.closes);
check("SPANISH_QUESTION_MARKS_BALANCED", openingMarks.length === 0, openingMarks);

const prohibited = bodies.map((b, i) => ({ i: i + 1, hit: (b.match(PROHIBITED) ?? [])[0] })).filter((x) => x.hit);
check("NO_PROHIBITED_CLAIMS", prohibited.length === 0, prohibited);

const jargon = bodies.map((b, i) => ({ i: i + 1, hit: (b.match(JARGON) ?? [])[0] })).filter((x) => x.hit);
check("NO_TECHNICAL_JARGON_IN_FRANCISCO_VOICE", jargon.length === 0, jargon);

check("NO_EXCLAMATION_MARKS", bodies.every((b) => !b.includes("!")), bodies.map((b, i) => i + 1).filter((i) => bodies[i - 1].includes("!")));
check("SIGNED_BY_FRANCISCO", bodies.every((b) => b.includes("Francisco")), true);

const closings = bodies.filter(isClosing).length;
check("FOUR_CLOSING_TOUCHES_CARRY_OPT_OUT", closings === 4, closings);

// Un prospecto recibe UNA variante completa: el duplicado que le llegaria dos
// veces es el que se repite dentro de su propia secuencia de 8.
const perVariant = [0, 8, 16, 24].map((start) => subjects.slice(start, start + 8));
const dupInVariant = perVariant.flatMap((set, v) =>
  set.filter((s, i) => set.indexOf(s) !== i).map((s) => ({ variante: v + 1, asunto: s })));
check("NO_DUPLICATE_SUBJECTS_WITHIN_VARIANT", dupInVariant.length === 0, dupInVariant);
check("SUBJECTS_UNDER_70_CHARS", subjects.every((s) => s.length <= 70), Math.max(...subjects.map((s) => s.length)));

const badTags = [...source.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1])
  .filter((t) => !["first_name", "company", "referidor", "referido"].includes(t));
check("ONLY_KNOWN_MERGE_TAGS", badTags.length === 0, [...new Set(badTags)]);

// El correo aprobado por el cliente es intocable: se verifica por sus frases ancla.
const APPROVED_ANCHORS = [
  "Soy Francisco Cuellar, Director General de ENNCO.",
  "tenemos clientes muy similares a ustedes que han obtenido increíbles resultados en la reducción de costos y en servicios eléctricos",
  "Nuestros proyectos aportan resultados visibles desde el momento de la entrega",
  "¿Cuándo podrías recibirme en tus oficinas para darte un análisis real de esto y mostrarte una estrategia de primer nivel para lograr esto?",
  "Si tú no te encargas de llevar esto, ¿podrías dirigirme con la persona encargada por favor?",
  "Saludos y espero saber de ti pronto.",
];
const missing = APPROVED_ANCHORS.filter((a) => !source.includes(a));
check("CLIENT_APPROVED_TOUCH1_INTACT", missing.length === 0, missing);

const failures = checks.filter((c) => c.status === "FAIL");
const result = {
  status: failures.length === 0 ? "PASS" : "FAIL",
  source: "docs/external/secuencia-ennco-copy.md",
  emails: bodies.length,
  word_limit: WORD_LIMIT,
  max_words: Math.max(...bodies.map((b) => b.trim().split(/\s+/).length)),
  check_count: checks.length,
  pass_count: checks.length - failures.length,
  failure_count: failures.length,
  checks,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failures.length > 0) process.exitCode = 1;
