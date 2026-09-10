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

const rawBodies = [...source.matchAll(/```\n([\s\S]*?)\n```/g)].map((m) => m[1]);
// Las negritas se marcan con **asi** (Grant, 10-sep); el motor las quita del
// texto plano y las convierte en <strong> en el HTML. Aqui se cuentan palabras y
// frases sin los marcadores, y aparte se vigila que esten bien puestas.
const stripBold = (text) => text.replace(/\*\*([^*\n]+)\*\*/gu, "$1");
const bodies = rawBodies.map(stripBold);
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

const boldProblems = rawBodies.map((b, i) => {
  const spans = (b.match(/\*\*[^*\n]+\*\*/gu) ?? []).length;
  const markers = (b.match(/\*\*/gu) ?? []).length;
  const inGreetingOrSignature = /^Hola[^\n]*\*\*|\*\*[^\n]*\n*Francisco[^\n]*$|Saludos[^\n]*\*\*/mu.test(b);
  return { i: i + 1, spans, markers, inGreetingOrSignature };
}).filter((x) => x.markers !== x.spans * 2 || x.spans > 2 || x.inGreetingOrSignature);
check("BOLD_AT_MOST_TWO_PER_EMAIL_AND_BALANCED", boldProblems.length === 0, boldProblems);
check("NO_BOLD_IN_SUBJECTS", subjects.every((s) => !s.includes("**")), subjects.filter((s) => s.includes("**")));

// El asunto personalizado es una decision de Grant (8-sep), no un adorno: si un
// asunto pierde el nombre, el prospecto recibe un correo mas frio que el resto
// de su secuencia. La segunda vuelta va aparte porque saluda al referido.
const sequenceSubjects = subjects.slice(0, 32);
const withoutName = sequenceSubjects.map((s, i) => ({ i: i + 1, asunto: s })).filter((x) => !x.asunto.includes("{{first_name}}"));
check("EVERY_SUBJECT_OPENS_WITH_FIRST_NAME", withoutName.length === 0, withoutName);

const badTags = [...source.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1])
  .filter((t) => !["first_name", "company", "referidor", "referido"].includes(t));
check("ONLY_KNOWN_MERGE_TAGS", badTags.length === 0, [...new Set(badTags)]);

// El correo aprobado por el cliente es intocable: se verifica por sus frases ancla.
// Cambios autorizados sobre el texto aprobado (cada uno con quien lo pidio y cuando):
//  - 2026-09-07, Jorge, tras leer el correo recibido: se retira "Nuestros
//    proyectos aportan resultados visibles desde el momento de la entrega"
//    de los toques 1 de DIRECCION y MANTENIMIENTO. Motivo: lenguaje de
//    folleto que no aporta y ocupa 11 palabras del tope de 120.
//  - 2026-09-07, Grant: la primera frase de las cuatro variantes del toque 1
//    pasa de "clientes muy similares... resultados" a que hace ENNCO y que
//    entrega; en DIRECCION se retira "estrategia de primer nivel" del cierre.
//  - 2026-09-08, Grant: el asunto se personaliza. Los 32 abren con
//    {{first_name}} y el toque 1 de las cuatro variantes dice
//    "{{first_name}}, sobre tu instalacion electrica." El cuerpo no se toca.
//  - 2026-09-10, Grant: negritas con **asi**, maximo dos por correo, en el
//    beneficio y la peticion (y en "baja" del toque 8). El texto no cambia.
//  - 2026-09-10, Paco (junta del 9-sep): el negocio es solar. Sale "acometidas"
//    del toque 1 de MANTENIMIENTO ("instalaciones fotovoltaicas" en su lugar) y
//    la lista de servicios del toque 2 abre en las cuatro variantes con
//    "instalaciones y mantenimiento fotovoltaico".
const APPROVED_ANCHORS = [
  "Soy Francisco Cuellar, Director General de ENNCO.",
  "Si tú no te encargas de llevar esto, ¿podrías dirigirme con la persona encargada por favor?",
  "Saludos y espero saber de ti pronto.",
  // 2026-09-07, Grant aprueba las cuatro primeras frases concretas (propuesta de Atlas):
  "trabajamos con plantas industriales en el mantenimiento de su instalación eléctrica",
  "trabajamos con plantas industriales en la parte eléctrica",
  "trabajamos con plantas industriales revisando y documentando su instalación eléctrica",
  "trabajamos con plantas industriales en servicios eléctricos",
];
// Frases retiradas por peticion del cliente: el gate ahora exige que NO vuelvan
// solas (una regresion del copy seria tan grave como una edicion no autorizada).
const RETIRED_PHRASES = [
  "Nuestros proyectos aportan resultados visibles desde el momento de la entrega",
  // 2026-09-07, Grant: la apertura generica y el cierre con superlativo salen del toque 1.
  "tenemos clientes muy similares a ustedes",
  "increíbles resultados",
  "estrategia de primer nivel",
  // 2026-09-10, Paco: el negocio es solar; "acometidas" no vuelve.
  "acometidas",
];
// Se vigila lo que SALE (cuerpos y asuntos), no la prosa del markdown: el
// documento explica por que se retiro cada frase y tiene que poder nombrarla.
const outgoing = [...bodies, ...subjects].join("\n");
const regressed = RETIRED_PHRASES.filter((a) => outgoing.includes(a));
check("RETIRED_PHRASES_STAY_OUT", regressed.length === 0, regressed);
// Las palabras del cliente sobre su propio negocio (junta del 9-sep) tienen que
// seguir en la lista de servicios de las cuatro variantes.
const SOLAR_SERVICES = "Instalaciones y mantenimiento fotovoltaico";
const servicesLines = (source.match(/^Hacemos esto:\n/gmu) ?? []).length;
const solarServicesLines = (source.match(new RegExp(`^Hacemos esto:\\n${SOLAR_SERVICES}`, "gmu")) ?? []).length;
check("SERVICES_LEAD_WITH_SOLAR", servicesLines === 4 && solarServicesLines === 4, { servicios: servicesLines, solares: solarServicesLines });
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
