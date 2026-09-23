type Part = { body?: { data?: string }; parts?: Part[]; headers?: Array<{ name: string; value: string }> };
export function diagnosticText(message: unknown): string {
  const visit = (part?: Part): string => {
    if (!part) return "";
    const body = part.body?.data ? Buffer.from(part.body.data, "base64url").toString("utf8") : "";
    return [body, ...(part.headers ?? []).map(h => h.name + ": " + h.value), ...(part.parts ?? []).map(visit)].join("\n");
  };
  return visit((message as { payload?: Part })?.payload).slice(0, 30000);
}
export function deliveryDiagnostic(message: unknown) {
  const text = diagnosticText(message);
  const codes = [...new Set(text.match(/\b[245]\.\d{1,3}\.\d{1,3}\b/g) ?? [])];
  const status = /\bStatus:\s*([245]\.\d{1,3}\.\d{1,3})/i.exec(text)?.[1] ?? codes.find(c => c.startsWith("5.")) ?? codes.find(c => c.startsWith("4.")) ?? null;
  const category = status?.startsWith("4.") ? "TEMPORARY" : status?.startsWith("5.1.") ? "INVALID_ADDRESS"
    : status?.startsWith("5.7.") ? "SENDER_OR_POLICY" : status?.startsWith("5.") ? "SERVER_REJECTION" : "UNKNOWN";
  return { status, category, text, permanent: category !== "TEMPORARY" && category !== "UNKNOWN" };
}
