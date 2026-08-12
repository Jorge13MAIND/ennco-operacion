export type DnsReadinessInput = {
  domain: string;
  spfRecords: string[];
  dkimRecords: Array<{ selector: string; value: string }>;
  dmarcRecords: string[];
  mxRecords: string[];
  forwardReverseDnsPass: boolean;
  tlsSeedPass: boolean;
};

export type DnsReadinessResult = {
  decision: "PASS" | "EXTEND";
  checks: Record<string, boolean>;
  reasons: string[];
};

export function evaluateDnsReadiness(input: DnsReadinessInput): DnsReadinessResult {
  const checks = {
    domain_shape: /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(input.domain),
    single_spf: input.spfRecords.length === 1 && /^v=spf1\s/i.test(input.spfRecords[0] ?? ""),
    dkim_present: input.dkimRecords.length > 0 && input.dkimRecords.every((record) => /^[a-z0-9._-]{1,63}$/i.test(record.selector) && /^v=DKIM1;.*\bp=/i.test(record.value)),
    single_dmarc: input.dmarcRecords.length === 1 && /^v=DMARC1;.*\bp=(none|quarantine|reject)\b/i.test(input.dmarcRecords[0] ?? ""),
    mx_present: input.mxRecords.length > 0,
    forward_reverse_dns: input.forwardReverseDnsPass,
    tls_seed: input.tlsSeedPass,
  };
  const reasons = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => `DNS_CHECK_FAILED:${name}`);
  return { decision: reasons.length === 0 ? "PASS" : "EXTEND", checks, reasons };
}

