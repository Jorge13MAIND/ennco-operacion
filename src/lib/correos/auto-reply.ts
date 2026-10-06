/**
 * Respuestas automáticas: "fuera de la oficina" y "ya no trabajo aquí" (6-oct-2026, Grant).
 *
 * Outlook manda estas respuestas como correo nuevo ("Automatic reply: …"), sin el hilo original,
 * así que el sync no las podía vincular y quedaban en recuperación sin que nadie las viera. Este
 * módulo las reconoce por encabezados, asunto o texto, y saca la fecha de regreso si la hay.
 *
 *  · OOO  (fuera de la oficina): la secuencia se pausa y retoma el día hábil siguiente al regreso;
 *         sin fecha, 7 días después (lo calcula la base, con fines de semana y festivos).
 *  · GONE (ya no trabaja ahí o la cuenta está deshabilitada): se detiene y se suprime; los correos
 *         que mencione quedan como referidos para que Paco los revise.
 */

export type AutoReplyKind = "OOO" | "GONE";
export type AutoReply = { kind: AutoReplyKind; returnDate: string | null; referrals: string[] };

type Header = { name: string; value: string };

const OUR_DOMAINS = /@(ennco\.com\.mx|enncoenergia\.com|enncoindustrial\.com|teckel-ai\.com)$/i;

function normalized(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

const SUBJECT_AUTO = /^\s*(automatic reply|auto[- ]?reply|autoreply|auto:|respuesta automatica|respuesta automatica|out of (the )?office|fuera de (la )?oficina|ausente|ausencia|vacaciones|reponse automatique|resposta automatica|risposta automatica|abwesenheit|automatische antwort)/;

const GONE = new RegExp([
  "ya no (trabajo|laboro|colaboro|pertenezco|formo parte|estoy) (con|en|para|a)",
  "ya no (trabaja|labora|colabora|forma parte|pertenece)",
  "deje de (laborar|trabajar|colaborar)",
  "dejo de (laborar|trabajar|colaborar)",
  "no longer (with|work|works|working|employed|part of|at)",
  "(has|have) left the (company|organization)",
  "(cuenta|buzon|correo)( de correo| electronico)? (ha sido |fue |se encuentra |esta |a sido )?(actualmente |permanentemente )?(deshabilitad|inhabilitad|desactivad|dad[oa] de baja|cerrad)",
  "(this |the )?(email |e-mail |mail )?(account|mailbox|address)( has been| is)? (currently |permanently )?(disabled|deactivated|closed|no longer (available|monitored|active|in use))",
].join("|"));

// Sin encabezado ni asunto de respuesta automática solo cuentan frases inequívocas de ausencia.
const OOO = new RegExp([
  "fuera de (la )?oficina", "estare fuera", "me encuentro fuera de", "estoy de vacaciones", "me encuentro de vacaciones",
  "acceso limitado", "limitado acceso", "regreso a la oficina", "estare de regreso", "a mi regreso",
  "incapacidad", "licencia (medica|de maternidad|de paternidad)",
  "out of (the )?office", "(i am|i'm|currently) on (vacation|holiday|leave|pto|annual leave|parental leave|medical leave)",
  "away from (the |my )?(office|desk)", "limited access", "i will be back", "i will return", "i will be out",
  "back in the office", "automatic reply", "respuesta automatica",
].join("|"));

// Una persona que de verdad quiere hablar no es una respuesta automática, aunque diga "estaré fuera".
const HUMAN_INTEREST = /\b(me interesa|nos interesa|podemos (hablar|platicar|vernos)|agend|cotiza|llamame|marcame|hablemos|platiquemos|mandame|enviame|me (mandas|envias))|[?¿]/;

function headerMap(headers: Header[]): Map<string, string> {
  return new Map(headers.map((h) => [h.name.toLowerCase(), h.value]));
}

export function isAutomatedByHeaders(headers: Header[]): boolean {
  const h = headerMap(headers);
  const autoSubmitted = h.get("auto-submitted")?.toLowerCase();
  const precedence = h.get("precedence")?.toLowerCase();
  return Boolean((autoSubmitted && autoSubmitted !== "no") || precedence === "auto_reply"
    || h.has("x-autoreply") || h.has("x-autorespond"));
}

export function referralsIn(body: string, senderEmail: string): string[] {
  const found = body.toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/g) ?? [];
  const sender = senderEmail.toLowerCase();
  return [...new Set(found)].filter((e) => e !== sender && !OUR_DOMAINS.test(e)).slice(0, 5);
}

export function detectAutoReply(input: { subject: string | null; headers: Header[]; body: string | null; senderEmail: string; receivedAt: Date }): AutoReply | null {
  const subject = normalized(input.subject ?? "");
  const body = normalized(input.body ?? "");
  const byHeader = isAutomatedByHeaders(input.headers);
  const bySubject = SUBJECT_AUTO.test(subject);
  const automated = byHeader || bySubject;
  if (GONE.test(body)) return { kind: "GONE", returnDate: null, referrals: referralsIn(input.body ?? "", input.senderEmail) };
  const oooText = OOO.test(body) || OOO.test(subject);
  if (!automated && (!oooText || HUMAN_INTEREST.test(body))) return null;
  if (!automated && body.split(/\s+/).filter(Boolean).length > 150) return null;
  return { kind: "OOO", returnDate: parseReturnDate(`${input.subject ?? ""}\n${input.body ?? ""}`, input.receivedAt), referrals: [] };
}

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9,
  octubre: 10, noviembre: 11, diciembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10,
  november: 11, december: 12, jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  ene: 1, abr: 4, ago: 8, dic: 12,
};
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
const WEEKDAY_RE = "lunes|martes|miercoles|jueves|viernes|sabado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday";

function ymd(y: number, m: number, d: number): Date | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
}

/**
 * La fecha más lejana que menciona el texto entre 2 días antes y 120 días después de recibirlo:
 * el regreso ("regreso el 12", "back on October 12th") o el último día fuera ("hasta el 10").
 * La base retoma el día hábil siguiente a esa fecha.
 */
export function parseReturnDate(raw: string, receivedAt: Date): string | null {
  const text = normalized(raw);
  const english = /\b(the|will|office|until|return|back)\b/.test(text) && !/\b(el|de|la|hasta|regreso)\b/.test(text);
  const base = Date.UTC(receivedAt.getUTCFullYear(), receivedAt.getUTCMonth(), receivedAt.getUTCDate());
  const min = base - 2 * 86_400_000;
  const max = base + 120 * 86_400_000;
  const candidates: Date[] = [];
  const add = (y: number | null, m: number, d: number) => {
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return;
    const years = y ? [y < 100 ? 2000 + y : y] : [receivedAt.getUTCFullYear(), receivedAt.getUTCFullYear() + 1];
    for (const year of years) {
      const date = ymd(year, m, d);
      if (date && date.getTime() >= min && date.getTime() <= max) { candidates.push(date); return; }
    }
  };
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:\\s*de)?\\s+(${MONTH_RE})\\.?(?:\\s+(?:de(?:l)?\\s+)?(\\d{4}))?\\b`, "g"))) add(m[3] ? Number(m[3]) : null, MONTHS[m[2]!]!, Number(m[1]));
  for (const m of text.matchAll(new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, "g"))) add(m[3] ? Number(m[3]) : null, MONTHS[m[1]!]!, Number(m[2]));
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)\\s+(?:of\\s+)?(${MONTH_RE})\\b(?:,?\\s+(\\d{4}))?`, "g"))) add(m[3] ? Number(m[3]) : null, MONTHS[m[2]!]!, Number(m[1]));
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) add(Number(m[1]), Number(m[2]), Number(m[3]));
  for (const m of text.matchAll(/(?<![\d:])(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?(?![\d:])/g)) {
    const a = Number(m[1]); const b = Number(m[2]); const y = m[3] ? Number(m[3]) : null;
    if (a > 12) add(y, b, a); else if (b > 12) add(y, a, b); else if (english) add(y, a, b); else add(y, b, a);
  }
  // "regreso el lunes 5": día del mes sin mes, la siguiente ocurrencia desde que llegó.
  for (const m of text.matchAll(new RegExp(`\\b(?:${WEEKDAY_RE})\\s+(\\d{1,2})\\b(?!\\s*(?:de\\s+)?(?:${MONTH_RE}))`, "g"))) {
    const day = Number(m[1]);
    for (let k = 0; k < 2; k += 1) {
      const date = ymd(receivedAt.getUTCFullYear(), receivedAt.getUTCMonth() + 1 + k, day);
      if (date && date.getTime() >= min && date.getTime() <= max) { candidates.push(date); break; }
    }
  }
  if (!candidates.length) return null;
  const latest = candidates.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b));
  return latest.toISOString().slice(0, 10);
}
