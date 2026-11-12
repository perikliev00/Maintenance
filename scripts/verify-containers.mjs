// Real edge/monitoring regression checks. No working database or external webhook.
// API_IMAGE=... WEB_IMAGE=... node scripts/verify-containers.mjs
import assert from "node:assert/strict";
// Import module dependency from node:child_process.
import { spawnSync } from "node:child_process";
// Import module dependency from node:fs.
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
// Import module dependency from node:os.
import { tmpdir } from "node:os";
// Import module dependency from node:path.
import { dirname, join, resolve } from "node:path";
// Import module dependency from node:url.
import { fileURLToPath } from "node:url";
// Import module dependency from node:https.
import { request as httpsRequest } from "node:https";

// Bind root for use in the following logic.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Bind apiImage for use in the following logic.
const apiImage = process.env.API_IMAGE;
// Bind webImage for use in the following logic.
const webImage = process.env.WEB_IMAGE;
// Assert expected behavior in this test case.
assert.ok(apiImage && webImage, "Set API_IMAGE and WEB_IMAGE to locally built images");
// Bind tag for use in the following logic.
const tag = `maintenance-smoke-${process.pid}-${Date.now()}`;
// Bind tempRoot for use in the following logic.
const tempRoot = resolve(tmpdir());
// Bind temp for use in the following logic.
const temp = mkdtempSync(join(tempRoot, "maintenance-smoke-"));
// Initialize an array used by subsequent logic.
const containers = [];
// Bind networkCreated for use in the following logic.
let networkCreated = false;

// Define function docker and its behavior.
function docker(...args) {
  // Bind result for use in the following logic.
  const result = spawnSync("docker", args, { encoding: "utf8", timeout: 30000 });
  // Conditional branch for the case described by this guard.
  if (result.error) throw result.error;
  // Conditional branch for the case described by this guard.
  if (result.status !== 0) throw new Error(`docker ${args[0]} failed: ${result.stderr || result.stdout}`);
  // Return early result or rendered output from this path.
  return result.stdout.trim();
}
// Define function run and its behavior.
function run(name, args) {
  // Invoke containers.push to perform this step.
  containers.push(name);
  // Return early result or rendered output from this path.
  return docker("run", "-d", "--name", name, "--network", tag, ...args);
}
// Define function waitFor and its behavior.
async function waitFor(check) {
  // Bind until for use in the following logic.
  const until = Date.now() + 30000;
  // Bind last for use in the following logic.
  let last;
  // Support the surrounding logic for this step.
  do {
    // Begin guarded block to catch runtime failures.
    try { return await check(); } catch (error) { last = error; }
    // Wait for an async operation before continuing.
    await new Promise(r => setTimeout(r, 500));
  // Support the surrounding logic for this step.
  } while (Date.now() < until);
  // Abort this path by throwing an error to callers.
  throw last;
}

// Begin guarded block to catch runtime failures.
try {
  // Invoke docker to perform this step.
  docker("network", "create", tag);
  // Support the surrounding logic for this step.
  networkCreated = true;
  // Bind api for use in the following logic.
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
  // Invoke run to perform this step.
  // Invoke run to perform this step.
  run(api, ["--network-alias", "api", "--entrypoint", "node",
    // Support the surrounding logic for this step.
    "-e", "NODE_ENV=test", "-e", "E2E_DISABLE_RATE_LIMIT=1",
    // Support the surrounding logic for this step.
    "-e", "JWT_SECRET=container-smoke-secret-at-least-32-characters",
    // Support the surrounding logic for this step.
    "-e", "DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/unused",
    // Support the surrounding logic for this step.
    apiImage, "-e", bootstrap]);
  // Invoke run to perform this step.
  run(web, ["-p", "127.0.0.1::8080", "-e", "APP_DOMAIN=:8080", webImage]);
  // Bind address for use in the following logic.
  const address = docker("port", web, "8080/tcp");
  // Bind base for use in the following logic.
  const base = `http://${address}`;
  // Wait for an async operation before continuing.
  await waitFor(async () => {
    // Capture remote/API result needed by this flow.
    const res = await fetch(`${base}/api/health/ready`, { signal: AbortSignal.timeout(3000) });
    // Assert expected behavior in this test case.
    assert.equal(res.status, 200);
    // Assert expected behavior in this test case.
    assert.match(res.headers.get("content-type"), /application\/json/);
    // Assert expected behavior in this test case.
    assert.deepEqual(await res.json(), { ok: true, ready: true });
  });
  // Capture remote/API result needed by this flow.
  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  // Assert expected behavior in this test case.
  assert.equal(login.status, 400);
  // Assert expected behavior in this test case.
  assert.equal((await login.json()).error, "validation");
  // Iterate a collection or counted range.
  for (const path of ["/api/metrics", "/api/metrics/", "/api/METRICS/", "/api/%6detrics", "/api/metrics%2f", "/api/metrics?probe=1"]) {
    // Assert expected behavior in this test case.
    assert.equal((await fetch(`${base}${path}`)).status, 404, path);
  }
  // Capture remote/API result needed by this flow.
  const home = await fetch(`${base}/`);
  // Bind html for use in the following logic.
  const html = await home.text();
  // Assert expected behavior in this test case.
  assert.match(html, /<html/);
  // Assert expected behavior in this test case.
  assert.match(home.headers.get("cache-control"), /no-store/);
  // Assert expected behavior in this test case.
  assert.equal(home.headers.get("x-frame-options"), "DENY");
  // Assert expected behavior in this test case.
  assert.match(home.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  // Bind asset for use in the following logic.
  const asset = html.match(/(?:src|href)="(\/assets\/[^"?]+\.js)"/)?.[1];
  // Assert expected behavior in this test case.
  assert.ok(asset, "built SPA JavaScript asset");
  // Capture remote/API result needed by this flow.
  const js = await fetch(`${base}${asset}`);
  // Assert expected behavior in this test case.
  assert.equal(js.status, 200);
  // Assert expected behavior in this test case.
  assert.match(js.headers.get("cache-control"), /immutable/);
  // Assert expected behavior in this test case.
  assert.equal(await (await fetch(`${base}/a/deep/spa/path`)).text(), html);
  // Invoke docker to perform this step.
  docker("exec", api, "node", "-e", "fetch('http://127.0.0.1:4000/metrics').then(async r=>{if(!r.ok||!(await r.text()).includes('http_requests_total'))process.exit(1)})");
  // Emit diagnostic output for debugging this path.
  console.log("PASS edge: JSON readiness, POST validation, metrics variants, SPA/assets/security/cache, internal scrape");

  // Bind tlsWeb for use in the following logic.
  const tlsWeb = `${tag}-https`;
  // Invoke run to perform this step.
  run(tlsWeb, ["-p", "127.0.0.1::443", "-e", "APP_DOMAIN=localhost",
    // Support the surrounding logic for this step.
    "--health-interval=1s", "--health-start-period=1s", "--health-timeout=3s", webImage]);
  // Parse JSON payload into a usable object.
  const compose = JSON.parse(docker("compose", "--env-file", join(root, ".env.production.example"),
    // Support the surrounding logic for this step.
    "-f", join(root, "compose.prod.yml"), "config", "--format", "json"));
  // Assert expected behavior in this test case.
  assert.deepEqual(JSON.parse(docker("inspect", "--format", "{{json .Config.Healthcheck.Test}}", tlsWeb)), compose.services.web.healthcheck.test);
  // Wait for an async operation before continuing.
  await waitFor(() => assert.equal(docker("inspect", "--format", "{{.State.Health.Status}}", tlsWeb), "healthy"));
  // Assert expected behavior in this test case.
  assert.equal(docker("exec", tlsWeb, "id", "-u"), "1000");
  // Bind ca for use in the following logic.
  const ca = docker("exec", tlsWeb, "cat", "/data/caddy/pki/authorities/local/root.crt");
  // Bind tlsPort for use in the following logic.
  const tlsPort = Number(docker("port", tlsWeb, "443/tcp").split(":").at(-1));
  // Define function secureGet and its behavior.
  function secureGet(path) {
    // Return early result or rendered output from this path.
    return new Promise((resolve, reject) => {
      // Bind req for use in the following logic.
      const req = httpsRequest({ hostname: "127.0.0.1", port: tlsPort, path,
        // Provide servername field/parameter used by this structure.
        servername: "localhost", ca, headers: { Host: "localhost" }, timeout: 3000 }, res => {
        // Bind body for use in the following logic.
        let body = ""; res.on("data", chunk => { body += chunk; });
        // Invoke res.on to perform this step.
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      });
      // Invoke req.on to perform this step.
      req.on("error", reject); req.on("timeout", () => req.destroy(new Error("HTTPS probe timed out"))); req.end();
    });
  }
  // Wait for an async operation before continuing.
  await waitFor(async () => {
    // Bind ready for use in the following logic.
    const ready = await secureGet("/api/health/ready");
    // Assert expected behavior in this test case.
    assert.equal(ready.status, 200);
    // Assert expected behavior in this test case.
    assert.deepEqual(JSON.parse(ready.body), { ok: true, ready: true });
    // Assert expected behavior in this test case.
    assert.equal(ready.headers["x-frame-options"], "DENY");
  });
  // Iterate a collection or counted range.
  for (const path of ["/api/metrics", "/api/metrics/", "/api/METRICS/"]) assert.equal((await secureGet(path)).status, 404);
  // Emit diagnostic output for debugging this path.
  console.log("PASS HTTPS: exact Compose healthcheck, healthy non-root container, trusted hostname/SNI, API and metrics");

  // Production config and entrypoint; only shorten grouping delays for the local receiver.
  writeFileSync(join(temp, "alertmanager.yml"), readFileSync(join(root, "infra/monitoring/alertmanager.yml"), "utf8").replace("group_wait: 30s", "group_wait: 0s"));
  // Invoke run to perform this step.
  run(alerts, ["--network-alias", "alerts", "--entrypoint", "/bin/sh",
    // Support the surrounding logic for this step.
    "--mount", `type=bind,source=${join(root, "infra/monitoring/start-alertmanager.sh")},target=/etc/alertmanager/start.sh,readonly`,
    // Support the surrounding logic for this step.
    "--mount", `type=bind,source=${join(temp, "alertmanager.yml")},target=/etc/alertmanager/alertmanager.yml,readonly`,
    // Support the surrounding logic for this step.
    "-e", "ALERT_WEBHOOK_URL=http://api:9094/hooks?first=1&second=two%20words",
    // Support the surrounding logic for this step.
    "prom/alertmanager:v0.28.1", "/etc/alertmanager/start.sh", "--storage.path=/alertmanager", "--cluster.listen-address="]);
  // Wait for an async operation before continuing.
  await waitFor(() => docker("exec", alerts, "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:9093/-/ready"));
  // Invoke docker to perform this step.
  docker("exec", alerts, "/bin/amtool", "check-config", "/etc/alertmanager/alertmanager.yml");
  // Invoke docker to perform this step.
  docker("exec", api, "node", "-e", `fetch('http://alerts:9093/api/v2/alerts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify([{labels:{alertname:'LocalContainerSmoke',service:'maintenance'},endsAt:new Date(Date.now()+60000).toISOString()}])}).then(r=>{if(!r.ok)process.exit(1)})`);
  // Wait for an async operation before continuing.
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
  // Conditional branch for the case described by this guard.
  if (networkCreated) docker("network", "rm", tag);
  // Assert expected behavior in this test case.
  assert.equal(dirname(resolve(temp)), tempRoot, "cleanup must stay in the temporary directory");
  // Assert expected behavior in this test case.
  assert.ok(temp.startsWith(join(tempRoot, "maintenance-smoke-")));
  // Invoke rmSync to perform this step.
  rmSync(temp, { recursive: true, force: true });
}
