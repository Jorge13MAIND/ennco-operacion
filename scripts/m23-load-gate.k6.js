import http from "k6/http";
import { check } from "k6";

const baseUrl = __ENV.BASE_URL || "http://127.0.0.1:3100";
const duration = __ENV.M23_LOAD_DURATION || "10s";
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(baseUrl)) {
  throw new Error("M23_LOAD_GATE_LOCAL_ONLY");
}

const targets = {
  health: { path: "/api/v1/health", contains: '"external_send_allowed":false' },
  home: { path: "/", contains: "De la planta correcta" },
  diagnostic: { path: "/diagnostico", contains: "Con el recibo empieza" },
  portal: { path: "/operacion", contains: "Qué requiere atención" },
};

export const options = {
  scenarios: Object.fromEntries(Object.keys(targets).map((name) => [name, {
    executor: "constant-arrival-rate",
    exec: name,
    rate: 5,
    timeUnit: "1s",
    duration,
    preAllocatedVUs: 4,
    maxVUs: 20,
    tags: { target: name },
  }])),
  thresholds: {
    http_req_failed: ["rate==0"],
    http_req_duration: ["p(95)<800"],
    dropped_iterations: ["count==0"],
  },
  noConnectionReuse: false,
  userAgent: "ENNCO-M023-local-load-gate/1.0",
};

function request(name) {
  const target = targets[name];
  const response = http.get(`${baseUrl}${target.path}`, {
    headers: { Accept: name === "health" ? "application/json" : "text/html", "Cache-Control": "no-cache" },
    tags: { target: name },
  });
  check(response, {
    [`${name} returned 200`]: (result) => result.status === 200,
    [`${name} returned the expected fail-closed surface`]: (result) => result.body.includes(target.contains),
  }, { target: name });
}

export function health() { request("health"); }
export function home() { request("home"); }
export function diagnostic() { request("diagnostic"); }
export function portal() { request("portal"); }
