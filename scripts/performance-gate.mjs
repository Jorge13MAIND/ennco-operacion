#!/usr/bin/env node
import { performance } from "node:perf_hooks";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const baseUrl = new URL(argument("--base-url", "http://127.0.0.1:3000"));
const durationSeconds = Number(argument("--duration-seconds", "10"));
const requestsPerSecond = Number(argument("--rps", "20"));
const p95BudgetMs = Number(argument("--p95-budget-ms", "500"));
const maxErrorRate = Number(argument("--max-error-rate", "0"));

if (!["localhost", "127.0.0.1", "::1"].includes(baseUrl.hostname)) {
  throw new Error("PERFORMANCE_GATE_LOCAL_ONLY");
}
if (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 300) {
  throw new Error("PERFORMANCE_GATE_DURATION_INVALID");
}
if (!Number.isInteger(requestsPerSecond) || requestsPerSecond < 1 || requestsPerSecond > 100) {
  throw new Error("PERFORMANCE_GATE_RPS_INVALID");
}

const intervalMs = 1000 / requestsPerSecond;
const targetRequests = durationSeconds * requestsPerSecond;
const latencies = [];
const failures = [];
const startedAt = performance.now();

async function requestOnce(sequence) {
  const scheduledAt = startedAt + sequence * intervalMs;
  const delay = scheduledAt - performance.now();
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  const requestStartedAt = performance.now();
  try {
    const response = await fetch(new URL("/api/v1/health", baseUrl), {
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(Math.max(2_000, p95BudgetMs * 4)),
    });
    const body = await response.json();
    if (!response.ok || body?.external_send_allowed !== false || body?.global_kill_switch !== true) {
      failures.push({ sequence, status: response.status, code: "HEALTH_RESPONSE_INVALID" });
    }
  } catch (error) {
    failures.push({ sequence, status: null, code: error instanceof Error ? error.name : "REQUEST_FAILED" });
  } finally {
    latencies.push(performance.now() - requestStartedAt);
  }
}

await Promise.all(Array.from({ length: targetRequests }, (_, index) => requestOnce(index)));
const sorted = [...latencies].sort((a, b) => a - b);
const percentile = (value) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)] ?? null;
const errorRate = failures.length / targetRequests;
const report = {
  schema_version: "1.0.0",
  evidence_class: "synthetic_demo",
  target: `${baseUrl.origin}/api/v1/health`,
  external_side_effects: 0,
  duration_seconds: durationSeconds,
  requests_per_second: requestsPerSecond,
  target_requests: targetRequests,
  completed_requests: latencies.length,
  failed_requests: failures.length,
  error_rate: errorRate,
  latency_ms: {
    min: sorted[0] ?? null,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: sorted.at(-1) ?? null,
  },
  budgets: { p95_ms: p95BudgetMs, max_error_rate: maxErrorRate },
  status: errorRate <= maxErrorRate && (percentile(0.95) ?? Infinity) <= p95BudgetMs ? "PASS" : "FAIL",
  failures: failures.slice(0, 20),
  limitations: [
    "local synthetic health endpoint only",
    "does not prove managed database, queue, provider or production capacity",
    "five-minute gate is required before a production release",
  ],
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.status !== "PASS") process.exitCode = 1;
