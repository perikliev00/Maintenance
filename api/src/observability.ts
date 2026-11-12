// Cryptographically random request ids when clients omit X-Request-Id.
import { randomUUID } from "node:crypto";
// Histogram of event-loop delay for lag metrics.
import { monitorEventLoopDelay } from "node:perf_hooks";
// Express types for the requestObservability middleware.
import type { Request, Response, NextFunction } from "express";

// Counters keyed by method|route|status for Prometheus http_requests_total.
const requestCounts = new Map<string, number>();
// Upper bounds (seconds) for http_request_duration_seconds buckets.
const latencyBuckets = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
// Counts per method|route|status|le boundary.
const latencyCounts = new Map<string, number>();
// Sum of durations per method|route|status for histogram _sum.
const latencySums = new Map<string, number>();
// Separate counter for /sync* traffic.
const syncCounts = new Map<string, number>();
// Currently open authorized SSE connections (gauge).
let activeSse = 0;
// Completed scheduler cycles (success or failure).
let jobCycles = 0;
// Scheduler cycles that reported failure.
let failedJobCycles = 0;
// Unix seconds of the last successful scheduler cycle.
let lastJobCycleSuccess = 0;
// Per-job run/failure/duration stats for labeled metrics.
const jobCounts = new Map<string, { runs: number; failures: number; lastSuccess: number; durationSeconds: number }>();
// Lifetime count of SSE streams opened.
let sseOpenedTotal = 0;
// Count of SSE write/delivery failures.
let sseDeliveryErrors = 0;
// Sample event-loop delay at 20ms resolution for lag gauge.
const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
// Start collecting delay samples for the process lifetime.
eventLoopDelay.enable();

// Escape label values so Prometheus text format stays valid.
function label(value: string) { return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]/g, ""); }

// Supported structured log severity levels.
// Declare type alias LogLevel.
type LogLevel = "info" | "warn" | "error" | "fatal";

// Emit one JSON log line to the appropriate console stream.
function writeLog(
  // Provide level field/parameter used by this structure.
  level: LogLevel,
  // Provide event field/parameter used by this structure.
  event: string,
  // Provide fields field/parameter used by this structure.
  fields?: Record<string, unknown>,
// Support the surrounding logic for this step.
): void {
  // Stable envelope so log aggregators can parse every line the same way.
  const line = JSON.stringify({
    // Provide timestamp field/parameter used by this structure.
    timestamp: new Date().toISOString(),
    // List item in import/export/params.
    level,
    // Provide service field/parameter used by this structure.
    service: "maintenance-api",
    // List item in import/export/params.
    event,
    // Spread prior fields/items so overrides can layer cleanly.
    ...fields,
  });
  // Route warn/error/fatal to stderr-style streams; info to stdout.
  if (level === "warn") console.warn(line);
  // Alternate branch when the previous guards did not match.
  else if (level === "error" || level === "fatal") console.error(line);
  // Fallback branch when earlier conditions were false.
  else console.log(line);
}

/** Structured JSON logs shared by entrypoints, jobs, and SSE. */
export const log = {
  // Provide info field/parameter used by this structure.
  info: (event: string, fields?: Record<string, unknown>) =>
    // Invoke writeLog to perform this step.
    writeLog("info", event, fields),
  // Provide warn field/parameter used by this structure.
  warn: (event: string, fields?: Record<string, unknown>) =>
    // Invoke writeLog to perform this step.
    writeLog("warn", event, fields),
  // Provide error field/parameter used by this structure.
  error: (event: string, fields?: Record<string, unknown>) =>
    // Invoke writeLog to perform this step.
    writeLog("error", event, fields),
  // Provide fatal field/parameter used by this structure.
  fatal: (event: string, fields?: Record<string, unknown>) =>
    // Invoke writeLog to perform this step.
    writeLog("fatal", event, fields),
};

// Strip credentials from Error messages before they hit logs/metrics.
export function safeErrorMessage(error: unknown): string {
  // Prefer Error.message; stringify unknown throwables.
  const message = error instanceof Error ? error.message : String(error);
  // Return early result or rendered output from this path.
  return message
    // Redact password segment inside postgres URLs.
    .replace(/(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s]+@/gi, "$1[redacted]@")
    // Redact Bearer tokens.
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[redacted]")
    // Redact common secret key=value fragments.
    .replace(/\b(password|token|secret|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]");
}
// Track a newly opened SSE stream for gauges/counters.
export function sseOpened() { activeSse += 1; sseOpenedTotal += 1; }
// Decrement active SSE gauge without going below zero.
export function sseClosed() { activeSse = Math.max(0, activeSse - 1); }
// Increment SSE delivery-error counter when a write fails.
export function sseDeliveryFailed() { sseDeliveryErrors += 1; }
// Record one scheduler cycle outcome (and last-success timestamp on success).
export function jobRunFinished(failed: boolean) { jobCycles += 1; if (failed) failedJobCycles += 1; else lastJobCycleSuccess = Date.now() / 1000; }
// Record a single named background job execution for labeled metrics.
export function jobExecutionFinished(job: string, failed: boolean, durationSeconds: number) {
  // Create a zeroed stat row on first sight of this job name.
  const current = jobCounts.get(job) ?? { runs: 0, failures: 0, lastSuccess: 0, durationSeconds: 0 };
  // Support the surrounding logic for this step.
  current.runs += 1;
  // Support the surrounding logic for this step.
  current.durationSeconds = durationSeconds;
  // Conditional branch for the case described by this guard.
  if (failed) current.failures += 1;
  // Fallback branch when earlier conditions were false.
  else current.lastSuccess = Date.now() / 1000;
  // Invoke jobCounts.set to perform this step.
  jobCounts.set(job, current);
}

// Middleware: assign request id, time the response, update counters/logs.
export function requestObservability(req: Request, res: Response, next: NextFunction) {
  // Honor a well-formed client-supplied id; otherwise mint a UUID.
  const supplied = req.header("x-request-id") ?? "";
  // Bind requestId for use in the following logic.
  const requestId = /^[A-Za-z0-9._-]{1,80}$/.test(supplied) ? supplied : randomUUID();
  // Invoke res.setHeader to perform this step.
  res.setHeader("X-Request-Id", requestId);
  // High-resolution start time for durationSeconds.
  const started = process.hrtime.bigint();
  // Update metrics/logs only after the response fully finishes.
  res.on("finish", () => {
    // Bind seconds for use in the following logic.
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    // Prefer matched route path; unmatched traffic buckets as "unmatched".
    const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : "unmatched";
    // Bind method for use in the following logic.
    const method = req.method;
    // Bind status for use in the following logic.
    const status = String(res.statusCode);
    // Bind key for use in the following logic.
    const key = `${method}|${route}|${status}`;
    // Invoke requestCounts.set to perform this step.
    requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1);
    // Invoke latencySums.set to perform this step.
    latencySums.set(key, (latencySums.get(key) ?? 0) + seconds);
    // Extra counter for offline sync endpoints.
    if (route.startsWith("/sync")) {
      // Bind syncKey for use in the following logic.
      const syncKey = `${route}|${status}`;
      // Invoke syncCounts.set to perform this step.
      syncCounts.set(syncKey, (syncCounts.get(syncKey) ?? 0) + 1);
    }
    // Cumulative histogram: count every bucket whose le >= observed seconds.
    for (const boundary of latencyBuckets) {
      // Conditional branch for the case described by this guard.
      if (seconds <= boundary) {
        // Bind bucketKey for use in the following logic.
        const bucketKey = `${key}|${boundary}`;
        // Invoke latencyCounts.set to perform this step.
        latencyCounts.set(bucketKey, (latencyCounts.get(bucketKey) ?? 0) + 1);
      }
    }
    // Initialize an object holding related fields.
    const fields = {
      // Provide release field/parameter used by this structure.
      release: process.env.RELEASE_SHA ?? "unknown",
      // List item in import/export/params.
      requestId,
      // List item in import/export/params.
      method,
      // List item in import/export/params.
      route,
      // Provide status field/parameter used by this structure.
      status: res.statusCode,
      // Provide durationSeconds field/parameter used by this structure.
      durationSeconds: Number(seconds.toFixed(6)),
    };
    // 5xx as error so alerts can filter; everything else as info.
    if (res.statusCode >= 500) log.error("http_request", fields);
    // Fallback branch when earlier conditions were false.
    else log.info("http_request", fields);
  });
  // Invoke next to perform this step.
  next();
}

// Render the in-memory counters as Prometheus exposition text.
export function renderMetrics(): string {
  // Help/type headers then per-series samples for HTTP counters.
  const lines = [
    // Support the surrounding logic for this step.
    "# HELP http_requests_total Completed HTTP requests.", "# TYPE http_requests_total counter",
  // Support the surrounding logic for this step.
  ];
  // Iterate a collection or counted range.
  for (const [key, count] of requestCounts) {
    // Bind a local value for the following logic.
    const [method, route, status] = key.split("|");
    // Invoke lines.push to perform this step.
    lines.push(`http_requests_total{method="${label(method)}",route="${label(route)}",status="${status}"} ${count}`);
  }
  // Invoke lines.push to perform this step.
  lines.push("# HELP http_request_duration_seconds HTTP request duration buckets.", "# TYPE http_request_duration_seconds histogram");
  // Iterate a collection or counted range.
  for (const [key, count] of latencyCounts) {
    // Bind a local value for the following logic.
    const [method, route, status, bound] = key.split("|");
    // Invoke lines.push to perform this step.
    lines.push(`http_request_duration_seconds_bucket{method="${label(method)}",route="${label(route)}",status="${status}",le="${bound}"} ${count}`);
  }
  // Emit _count, _sum, and +Inf bucket for each observed series.
  for (const [method, route, status] of [...requestCounts.keys()].map((k) => k.split("|"))) {
    // Capture remote/API result needed by this flow.
    const count = requestCounts.get(`${method}|${route}|${status}`) ?? 0;
    // Invoke lines.push to perform this step.
    lines.push(`http_request_duration_seconds_count{method="${label(method)}",route="${label(route)}",status="${status}"} ${count}`);
    // Invoke lines.push to perform this step.
    lines.push(`http_request_duration_seconds_sum{method="${label(method)}",route="${label(route)}",status="${status}"} ${latencySums.get(`${method}|${route}|${status}`) ?? 0}`);
    // Invoke lines.push to perform this step.
    lines.push(`http_request_duration_seconds_bucket{method="${label(method)}",route="${label(route)}",status="${status}",le="+Inf"} ${count}`);
  }
  // Invoke lines.push to perform this step.
  lines.push("# HELP sync_requests_total Requests to offline synchronization endpoints.", "# TYPE sync_requests_total counter");
  // Iterate a collection or counted range.
  for (const [route, status] of [...syncCounts.keys()].map((key) => key.split("|"))) lines.push(`sync_requests_total{route="${label(route)}",status="${status}"} ${syncCounts.get(`${route}|${status}`)}`);
  // Invoke lines.push to perform this step.
  lines.push("# HELP sse_connections_active Active authorized SSE streams.", "# TYPE sse_connections_active gauge", `sse_connections_active ${activeSse}`);
  // Invoke lines.push to perform this step.
  lines.push("# TYPE sse_connections_opened_total counter", `sse_connections_opened_total ${sseOpenedTotal}`, "# TYPE sse_delivery_errors_total counter", `sse_delivery_errors_total ${sseDeliveryErrors}`);
  // Invoke lines.push to perform this step.
  lines.push("# HELP background_job_runs_total Scheduler cycles completed.", "# TYPE background_job_runs_total counter", `background_job_runs_total ${jobCycles}`);
  // Invoke lines.push to perform this step.
  lines.push("# HELP background_job_failures_total Scheduler cycles with reported failures.", "# TYPE background_job_failures_total counter", `background_job_failures_total ${failedJobCycles}`);
  // Invoke lines.push to perform this step.
  lines.push("# TYPE background_job_last_success_timestamp_seconds gauge", `background_job_last_success_timestamp_seconds ${lastJobCycleSuccess}`);
  // Invoke lines.push to perform this step.
  lines.push("# HELP background_job_execution_total Individual background job executions.", "# TYPE background_job_execution_total counter");
  // Iterate a collection or counted range.
  for (const [job, stat] of jobCounts) {
    // Invoke lines.push to perform this step.
    lines.push(`background_job_execution_total{job="${label(job)}"} ${stat.runs}`);
    // Invoke lines.push to perform this step.
    lines.push(`background_job_execution_failures_total{job="${label(job)}"} ${stat.failures}`);
    // Invoke lines.push to perform this step.
    lines.push(`background_job_last_success_timestamp_seconds{job="${label(job)}"} ${stat.lastSuccess}`);
    // Invoke lines.push to perform this step.
    lines.push(`background_job_last_duration_seconds{job="${label(job)}"} ${stat.durationSeconds}`);
  }
  // Invoke lines.push to perform this step.
  lines.push("# HELP process_uptime_seconds Process uptime in seconds.", "# TYPE process_uptime_seconds gauge", `process_uptime_seconds ${process.uptime()}`);
  // Bind memory for use in the following logic.
  const memory = process.memoryUsage();
  // Invoke lines.push to perform this step.
  lines.push("# TYPE process_resident_memory_bytes gauge", `process_resident_memory_bytes ${memory.rss}`);
  // Invoke lines.push to perform this step.
  lines.push("# TYPE nodejs_heap_used_bytes gauge", `nodejs_heap_used_bytes ${memory.heapUsed}`);
  // Invoke lines.push to perform this step.
  lines.push("# TYPE nodejs_eventloop_lag_seconds gauge", `nodejs_eventloop_lag_seconds ${Number.isFinite(eventLoopDelay.mean) ? eventLoopDelay.mean / 1e9 : 0}`);
  // Return early result or rendered output from this path.
  return `${lines.join("\n")}\n`;
}
