import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";
import type { Request, Response, NextFunction } from "express";

const requestCounts = new Map<string, number>();
const latencyBuckets = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
const latencyCounts = new Map<string, number>();
const latencySums = new Map<string, number>();
const syncCounts = new Map<string, number>();
let activeSse = 0;
let jobCycles = 0;
let failedJobCycles = 0;
let lastJobCycleSuccess = 0;
const jobCounts = new Map<string, { runs: number; failures: number; lastSuccess: number; durationSeconds: number }>();
let sseOpenedTotal = 0;
let sseDeliveryErrors = 0;
const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelay.enable();

function label(value: string) { return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]/g, ""); }
export function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s]+@/gi, "$1[redacted]@")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[redacted]")
    .replace(/\b(password|token|secret|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]");
}
export function sseOpened() { activeSse += 1; sseOpenedTotal += 1; }
export function sseClosed() { activeSse = Math.max(0, activeSse - 1); }
export function sseDeliveryFailed() { sseDeliveryErrors += 1; }
export function jobRunFinished(failed: boolean) { jobCycles += 1; if (failed) failedJobCycles += 1; else lastJobCycleSuccess = Date.now() / 1000; }
export function jobExecutionFinished(job: string, failed: boolean, durationSeconds: number) {
  const current = jobCounts.get(job) ?? { runs: 0, failures: 0, lastSuccess: 0, durationSeconds: 0 };
  current.runs += 1;
  current.durationSeconds = durationSeconds;
  if (failed) current.failures += 1;
  else current.lastSuccess = Date.now() / 1000;
  jobCounts.set(job, current);
}

export function requestObservability(req: Request, res: Response, next: NextFunction) {
  const supplied = req.header("x-request-id") ?? "";
  const requestId = /^[A-Za-z0-9._-]{1,80}$/.test(supplied) ? supplied : randomUUID();
  res.setHeader("X-Request-Id", requestId);
  const started = process.hrtime.bigint();
  res.on("finish", () => {
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : "unmatched";
    const method = req.method;
    const status = String(res.statusCode);
    const key = `${method}|${route}|${status}`;
    requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1);
    latencySums.set(key, (latencySums.get(key) ?? 0) + seconds);
    if (route.startsWith("/sync")) {
      const syncKey = `${route}|${status}`;
      syncCounts.set(syncKey, (syncCounts.get(syncKey) ?? 0) + 1);
    }
    for (const boundary of latencyBuckets) {
      if (seconds <= boundary) {
        const bucketKey = `${key}|${boundary}`;
        latencyCounts.set(bucketKey, (latencyCounts.get(bucketKey) ?? 0) + 1);
      }
    }
    const log = {
      timestamp: new Date().toISOString(), level: res.statusCode >= 500 ? "error" : "info",
      service: "maintenance-api", release: process.env.RELEASE_SHA ?? "unknown", requestId,
      method, route, status: res.statusCode, durationSeconds: Number(seconds.toFixed(6)),
    };
    (res.statusCode >= 500 ? console.error : console.log)(JSON.stringify(log));
  });
  next();
}

export function renderMetrics(): string {
  const lines = [
    "# HELP http_requests_total Completed HTTP requests.", "# TYPE http_requests_total counter",
  ];
  for (const [key, count] of requestCounts) {
    const [method, route, status] = key.split("|");
    lines.push(`http_requests_total{method="${label(method)}",route="${label(route)}",status="${status}"} ${count}`);
  }
  lines.push("# HELP http_request_duration_seconds HTTP request duration buckets.", "# TYPE http_request_duration_seconds histogram");
  for (const [key, count] of latencyCounts) {
    const [method, route, status, bound] = key.split("|");
    lines.push(`http_request_duration_seconds_bucket{method="${label(method)}",route="${label(route)}",status="${status}",le="${bound}"} ${count}`);
  }
  for (const [method, route, status] of [...requestCounts.keys()].map((k) => k.split("|"))) {
    const count = requestCounts.get(`${method}|${route}|${status}`) ?? 0;
    lines.push(`http_request_duration_seconds_count{method="${label(method)}",route="${label(route)}",status="${status}"} ${count}`);
    lines.push(`http_request_duration_seconds_sum{method="${label(method)}",route="${label(route)}",status="${status}"} ${latencySums.get(`${method}|${route}|${status}`) ?? 0}`);
    lines.push(`http_request_duration_seconds_bucket{method="${label(method)}",route="${label(route)}",status="${status}",le="+Inf"} ${count}`);
  }
  lines.push("# HELP sync_requests_total Requests to offline synchronization endpoints.", "# TYPE sync_requests_total counter");
  for (const [route, status] of [...syncCounts.keys()].map((key) => key.split("|"))) lines.push(`sync_requests_total{route="${label(route)}",status="${status}"} ${syncCounts.get(`${route}|${status}`)}`);
  lines.push("# HELP sse_connections_active Active authorized SSE streams.", "# TYPE sse_connections_active gauge", `sse_connections_active ${activeSse}`);
  lines.push("# TYPE sse_connections_opened_total counter", `sse_connections_opened_total ${sseOpenedTotal}`, "# TYPE sse_delivery_errors_total counter", `sse_delivery_errors_total ${sseDeliveryErrors}`);
  lines.push("# HELP background_job_runs_total Scheduler cycles completed.", "# TYPE background_job_runs_total counter", `background_job_runs_total ${jobCycles}`);
  lines.push("# HELP background_job_failures_total Scheduler cycles with reported failures.", "# TYPE background_job_failures_total counter", `background_job_failures_total ${failedJobCycles}`);
  lines.push("# TYPE background_job_last_success_timestamp_seconds gauge", `background_job_last_success_timestamp_seconds ${lastJobCycleSuccess}`);
  lines.push("# HELP background_job_execution_total Individual background job executions.", "# TYPE background_job_execution_total counter");
  for (const [job, stat] of jobCounts) {
    lines.push(`background_job_execution_total{job="${label(job)}"} ${stat.runs}`);
    lines.push(`background_job_execution_failures_total{job="${label(job)}"} ${stat.failures}`);
    lines.push(`background_job_last_success_timestamp_seconds{job="${label(job)}"} ${stat.lastSuccess}`);
    lines.push(`background_job_last_duration_seconds{job="${label(job)}"} ${stat.durationSeconds}`);
  }
  lines.push("# HELP process_uptime_seconds Process uptime in seconds.", "# TYPE process_uptime_seconds gauge", `process_uptime_seconds ${process.uptime()}`);
  const memory = process.memoryUsage();
  lines.push("# TYPE process_resident_memory_bytes gauge", `process_resident_memory_bytes ${memory.rss}`);
  lines.push("# TYPE nodejs_heap_used_bytes gauge", `nodejs_heap_used_bytes ${memory.heapUsed}`);
  lines.push("# TYPE nodejs_eventloop_lag_seconds gauge", `nodejs_eventloop_lag_seconds ${Number.isFinite(eventLoopDelay.mean) ? eventLoopDelay.mean / 1e9 : 0}`);
  return `${lines.join("\n")}\n`;
}
