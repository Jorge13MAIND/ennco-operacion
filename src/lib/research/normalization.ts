const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const WHITESPACE = /\s+/gu;
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const EMAIL_LOCAL_PART = /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/u;

const LEGAL_SUFFIXES = [
  /\b(?:sociedad\s+anonima\s+de\s+capital\s+variable|s\s*a\s+de\s+c\s*v)\b$/u,
  /\b(?:sociedad\s+de\s+responsabilidad\s+limitada\s+de\s+capital\s+variable|s\s+de\s+r\s*l\s+de\s+c\s*v)\b$/u,
  /\b(?:sociedad\s+de\s+responsabilidad\s+limitada|s\s+de\s+r\s*l)\b$/u,
  /\b(?:sociedad\s+por\s+acciones\s+simplificada|s\s*a\s+s)\b$/u,
  /\b(?:incorporated|corporation|company|limited|inc|corp|llc|ltd|co)\b$/u,
] as const;

export class ResearchNormalizationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ResearchNormalizationError";
  }
}

function assertText(value: string, code: string, maximumLength: number): string {
  const normalized = value.normalize("NFKC").replace(WHITESPACE, " ").trim();
  if (!normalized || normalized.length > maximumLength || CONTROL_CHARACTERS.test(normalized)) {
    throw new ResearchNormalizationError(code);
  }
  return normalized;
}

function removeDiacritics(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}+/gu, "");
}

function normalizeHostname(value: string, stripWww: boolean): string {
  const candidate = assertText(value, "DOMAIN_INVALID", 2_048).toLowerCase();
  if (candidate.includes("@")) throw new ResearchNormalizationError("DOMAIN_INVALID");

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//iu.test(candidate)
    ? candidate
    : `https://${candidate}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new ResearchNormalizationError("DOMAIN_INVALID");
  }

  if (!['http:', 'https:'].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || parsed.port
    || (parsed.pathname !== "/" && parsed.pathname !== "")
    || parsed.search
    || parsed.hash) {
    throw new ResearchNormalizationError("DOMAIN_INVALID");
  }

  let hostname = parsed.hostname.toLowerCase().replace(/\.$/u, "");
  if (stripWww && hostname.startsWith("www.")) hostname = hostname.slice(4);
  if (hostname.length > 253 || hostname.includes(":") || /^\d+(?:\.\d+){3}$/u.test(hostname)) {
    throw new ResearchNormalizationError("DOMAIN_INVALID");
  }

  const labels = hostname.split(".");
  if (labels.length < 2
    || labels.some((label) => !DOMAIN_LABEL.test(label))
    || (labels.at(-1)?.length ?? 0) < 2) {
    throw new ResearchNormalizationError("DOMAIN_INVALID");
  }
  return hostname;
}

export function normalizeLegalName(value: string): string {
  return assertText(value, "LEGAL_NAME_INVALID", 240);
}

export function legalNameMatchKey(value: string): string {
  let key = removeDiacritics(normalizeLegalName(value))
    .toLowerCase()
    .replace(/&/gu, " y ")
    .replace(/\band\b/gu, " y ")
    .replace(/[^a-z0-9]+/gu, " ")
    .replace(WHITESPACE, " ")
    .trim();

  let previous = "";
  while (key !== previous) {
    previous = key;
    for (const suffix of LEGAL_SUFFIXES) key = key.replace(suffix, "").trim();
  }
  if (!key) throw new ResearchNormalizationError("LEGAL_NAME_KEY_EMPTY");
  return key.replace(/\s+/gu, "-");
}

export function normalizeDomain(value: string): string {
  return normalizeHostname(value, true);
}

export function normalizeEmail(value: string): string {
  const candidate = assertText(value, "EMAIL_INVALID", 320).toLowerCase();
  if (candidate.includes(" ") || candidate.includes("<") || candidate.includes(">")) {
    throw new ResearchNormalizationError("EMAIL_INVALID");
  }
  const separator = candidate.lastIndexOf("@");
  if (separator <= 0 || separator !== candidate.indexOf("@")) {
    throw new ResearchNormalizationError("EMAIL_INVALID");
  }

  const localPart = candidate.slice(0, separator);
  const domainPart = candidate.slice(separator + 1);
  if (localPart.length > 64
    || !EMAIL_LOCAL_PART.test(localPart)
    || localPart.startsWith(".")
    || localPart.endsWith(".")
    || localPart.includes("..")) {
    throw new ResearchNormalizationError("EMAIL_INVALID");
  }
  try {
    return `${localPart}@${normalizeHostname(domainPart, false)}`;
  } catch {
    throw new ResearchNormalizationError("EMAIL_INVALID");
  }
}

export function canNormalizeLegalName(value: string): boolean {
  try {
    normalizeLegalName(value);
    legalNameMatchKey(value);
    return true;
  } catch {
    return false;
  }
}

export function canNormalizeDomain(value: string): boolean {
  try {
    normalizeDomain(value);
    return true;
  } catch {
    return false;
  }
}

export function canNormalizeEmail(value: string): boolean {
  try {
    normalizeEmail(value);
    return true;
  } catch {
    return false;
  }
}
