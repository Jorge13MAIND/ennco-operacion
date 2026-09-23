/* Texto de una respuesta de Gmail, sin la cita del correo original.
   Hasta el 22-sep el sync pedía solo encabezados (format=metadata) y guardaba el cuerpo en null:
   el clasificador no tenía con qué distinguir un "sí" de un "no" (caso Hershey). */

type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[] };

const MAX_CHARS = 8000;

function decode(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function findPart(part: Part | undefined, mimeType: string): string | null {
  if (!part) return null;
  if (part.mimeType === mimeType && part.body?.data) return decode(part.body.data);
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found !== null) return found;
  }
  return null;
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Líneas donde empieza la cita del correo anterior en Gmail, Outlook y Apple Mail, en español e inglés. */
const QUOTE_START = [
  /^(el|on)\b.{3,250}\b(escribió|wrote)\s*:?\s*$/i,
  /^-{2,}\s*(original message|mensaje original)\s*-{0,}$/i,
  /^_{5,}\s*$/,
  /^(de|from)\s*:\s*\S/i,
];

/** Corta la cita y las líneas con ">", junta espacios y limita el largo. */
export function stripQuotedReply(text: string): string {
  const kept: string[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (QUOTE_START.some((pattern) => pattern.test(line.trim()))) break;
    if (line.trimStart().startsWith(">")) continue;
    kept.push(line);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_CHARS);
}

/** Texto útil de un mensaje de Gmail en format=full; null si no hay texto que leer. */
export function extractReplyText(message: unknown): string | null {
  const payload = (message as { payload?: Part } | null)?.payload;
  if (!payload) return null;
  const plain = findPart(payload, "text/plain");
  const html = plain === null ? findPart(payload, "text/html") : null;
  const text = plain ?? (html === null ? null : htmlToText(html));
  if (text === null) return null;
  const stripped = stripQuotedReply(text);
  return stripped.length > 0 ? stripped : null;
}
