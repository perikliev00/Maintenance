// Real edge/monitoring regression checks. No working database or external webhook.
// API_IMAGE=... WEB_IMAGE=... node scripts/verify-containers.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { request as httpsRequest } from "node:https";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiImage = process.env.API_IMAGE;
const webImage = process.env.WEB_IMAGE;
assert.ok(apiImage && webImage, "Set API_IMAGE and WEB_IMAGE to locally built images");
const tag = `maintenance-smoke-${process.pid}-${Date.now()}`;
const tempRoot = resolve(tmpdir());
const temp = mkdtempSync(join(tempRoot, "maintenance-smoke-"));
// Initialize an array used by subsequent logic.
const containers = [];
let networkCreated = false;

// Define function docker and its behavior.
function docker(...args) {
  const result = spawnSync("docker", args, { encoding: "utf8", timeout: 30000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`docker ${args[0]} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
// Define function run and its behavior.
function run(name, args) {
  containers.push(name);
  return docker("run", "-d", "--name", name, "--network", tag, ...args);
}
// Define function waitFor and its behavior.
async function waitFor(check) {
  const until = Date.now() + 30000;
  let last;
  do {
    try { return await check(); } catch (error) { last = error; }
    await new Promise(r => setTimeout(r, 500));
  // Support the surrounding logic for this step.
  } while (Date.now() < until);
  // Abort this path by throwing an error to callers.
  throw last;
}

try {
  docker("network", "create", tag);
  networkCreated = true;
  const api = `${tag}-api`, web = `${tag}-web`, alerts = `${tag}-alerts`;
  // Actual application and validation middleware; health dependency is injected
  // so this smoke cannot touch a working database. Receiver stays on this network.
  const bootstrap = `
    // Bind a local value for the following logic.
    const {createApp,setBootstrapComplete}=require('./dist/app');
    // Update React state so the UI reflects the new value.
    setBootstrapComplete(true);
    // Invoke createApp to perform this step.
    createApp({probeDatabase:async()=>{}}).listen(4000,'0.0.0.0');
    // Bind received for use in the following logic.
    let received=0;
    // Invoke require to perform this step.
    require('node:http').createServer((req,res)=>{
      // Conditional branch for the case described by this guard.
      if(req.method==='POST' && req.url.startsWith('/hooks?')) {
        // Bind body for use in the following logic.
        let body=''; req.on('data',b=>body+=b); req.on('end',()=>{
          // Begin guarded block to catch runtime failures.
          try { if(JSON.parse(body).alerts?.length) received++; res.end('ok'); }
          // Support the surrounding logic for this step.
          catch {res.statusCode=400;res.end();}
        });
      // Support the surrounding logic for this step.
      } else {res.end(JSON.stringify({received}));}
    // Support the surrounding logic for this step.
    }).listen(9094,'0.0.0.0');`;
  run(api, ["--network-alias", "api", "--entrypoint", "node",
    "-e", "NODE_ENV=test", "-e", "E2E_DISABLE_RATE_LIMIT=1",
    "-e", "JWT_SECRET=container-smoke-secret-at-least-32-characters",
    "-e", "DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/unused",
    apiImage, "-e", bootstrap]);
  run(web, ["-p", "127.0.0.1::8080", "-e", "APP_DOMAIN=:8080", webImage]);
  const address = docker("port", web, "8080/tcp");
  const base = `http://${address}`;
  await waitFor(async () => {
    // Capture remote/API result needed by this flow.
    const res = await fetch(`${base}/api/health/ready`, { signal: AbortSignal.timeout(3000) });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /application\/json/);
    assert.deepEqual(await res.json(), { ok: true, ready: true });
  });
  // Capture remote/API result needed by this flow.
  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(login.status, 400);
  assert.equal((await login.json()).error, "validation");
  // Iterate a collection or counted range.
  for (const path of ["/api/metrics", "/api/metrics/", "/api/METRICS/", "/api/%6detrics", "/api/metrics%2f", "/api/metrics?probe=1"]) {
    assert.equal((await fetch(`${base}${path}`)).status, 404, path);
  }
  // Capture remote/API result needed by this flow.
  const home = await fetch(`${base}/`);
  const html = await home.text();
  assert.match(html, /<html/);
  assert.match(home.headers.get("cache-control"), /no-store/);
  assert.equal(home.headers.get("x-frame-options"), "DENY");
  assert.match(home.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  const asset = html.match(/(?:src|href)="(\/assets\/[^"?]+\.js)"/)?.[1];
  assert.ok(asset, "built SPA JavaScript asset");
  // Capture remote/API result needed by this flow.
  const js = await fetch(`${base}${asset}`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get("cache-control"), /immutable/);
  assert.equal(await (await fetch(`${base}/a/deep/spa/path`)).text(), html);
  docker("exec", api, "node", "-e", "fetch('http://127.0.0.1:4000/metrics').then(async r=>{if(!r.ok||!(await r.text()).includes('http_requests_total'))process.exit(1)})");
  // Emit diagnostic output for debugging this path.
  console.log("PASS edge: JSON readiness, POST validation, metrics variants, SPA/assets/security/cache, internal scrape");

  const tlsWeb = `${tag}-https`;
  run(tlsWeb, ["-p", "127.0.0.1::443", "-e", "APP_DOMAIN=localhost",
    "--health-interval=1s", "--health-start-period=1s", "--health-timeout=3s", webImage]);
  // Parse JSON payload into a usable object.
  const compose = JSON.parse(docker("compose", "--env-file", join(root, ".env.production.example"),
    "-f", join(root, "compose.prod.yml"), "config", "--format", "json"));
  assert.deepEqual(JSON.parse(docker("inspect", "--format", "{{json .Config.Healthcheck.Test}}", tlsWeb)), compose.services.web.healthcheck.test);
  await waitFor(() => assert.equal(docker("inspect", "--format", "{{.State.Health.Status}}", tlsWeb), "healthy"));
  assert.equal(docker("exec", tlsWeb, "id", "-u"), "1000");
  const ca = docker("exec", tlsWeb, "cat", "/data/caddy/pki/authorities/local/root.crt");
  const tlsPort = Number(docker("port", tlsWeb, "443/tcp").split(":").at(-1));
  // Define function secureGet and its behavior.
  function secureGet(path) {
    return new Promise((resolve, reject) => {
      const req = httpsRequest({ hostname: "127.0.0.1", port: tlsPort, path,
        // Provide servername field/parameter used by this structure.
        servername: "localhost", ca, headers: { Host: "localhost" }, timeout: 3000 }, res => {
        let body = ""; res.on("data", chunk => { body += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      });
      req.on("error", reject); req.on("timeout", () => req.destroy(new Error("HTTPS probe timed out"))); req.end();
    });
  }
  await waitFor(async () => {
    const ready = await secureGet("/api/health/ready");
    assert.equal(ready.status, 200);
    assert.deepEqual(JSON.parse(ready.body), { ok: true, ready: true });
    assert.equal(ready.headers["x-frame-options"], "DENY");
  });
  // Iterate a collection or counted range.
  for (const path of ["/api/metrics", "/api/metrics/", "/api/METRICS/"]) assert.equal((await secureGet(path)).status, 404);
  // Emit diagnostic output for debugging this path.
  console.log("PASS HTTPS: exact Compose healthcheck, healthy non-root container, trusted hostname/SNI, API and metrics");

  // Production config and entrypoint; only shorten grouping delays for the local receiver.
  writeFileSync(join(temp, "alertmanager.yml"), readFileSync(join(root, "infra/monitoring/alertmanager.yml"), "utf8").replace("group_wait: 30s", "group_wait: 0s"));
  run(alerts, ["--network-alias", "alerts", "--entrypoint", "/bin/sh",
    "--mount", `type=bind,source=${join(root, "infra/monitoring/start-alertmanager.sh")},target=/etc/alertmanager/start.sh,readonly`,
    "--mount", `type=bind,source=${join(temp, "alertmanager.yml")},target=/etc/alertmanager/alertmanager.yml,readonly`,
    "-e", "ALERT_WEBHOOK_URL=http://api:9094/hooks?first=1&second=two%20words",
    "prom/alertmanager:v0.28.1", "/etc/alertmanager/start.sh", "--storage.path=/alertmanager", "--cluster.listen-address="]);
  await waitFor(() => docker("exec", alerts, "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:9093/-/ready"));
  docker("exec", alerts, "/bin/amtool", "check-config", "/etc/alertmanager/alertmanager.yml");
  docker("exec", api, "node", "-e", `fetch('http://alerts:9093/api/v2/alerts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify([{labels:{alertname:'LocalContainerSmoke',service:'maintenance'},endsAt:new Date(Date.now()+60000).toISOString()}])}).then(r=>{if(!r.ok)process.exit(1)})`);
  await waitFor(() => docker("exec", api, "node", "-e", "fetch('http://127.0.0.1:9094/status').then(r=>r.json()).then(v=>{if(v.received<1)process.exit(1)})"));
  // Emit diagnostic output for debugging this path.
  console.log("PASS monitoring: startup, readiness, config validation and delivery to local-only webhook");
// Support the surrounding logic for this step.
} catch (error) {
  // Iterate a collection or counted range.
  for (const name of containers) {
    try { console.error(`${name}:\n${docker("logs", "--tail", "20", name)}`); } catch { /* failed startup */ }
  }
  // Abort this path by throwing an error to callers.
  throw error;
// Support the surrounding logic for this step.
} finally {
  for (const name of containers.reverse()) { try { docker("rm", "-f", name); } catch { /* already absent */ } }
  if (networkCreated) docker("network", "rm", tag);
  assert.equal(dirname(resolve(temp)), tempRoot, "cleanup must stay in the temporary directory");
  assert.ok(temp.startsWith(join(tempRoot, "maintenance-smoke-")));
  rmSync(temp, { recursive: true, force: true });
}
