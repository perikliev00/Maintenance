#!/usr/bin/env node
/**
 * Insert English // comments above uncommented source lines in api/tests and e2e.
 * NEVER modifies existing lines — only inserts new comment lines.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const TARGET_GLOBS = [
  { dir: path.join(ROOT, "api", "tests"), exclude: () => false },
  {
    dir: path.join(ROOT, "e2e"),
    exclude: (p) => p.includes(`${path.sep}node_modules${path.sep}`),
  },
];

function walkTsFiles(dir, exclude, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (exclude(full)) continue;
    if (ent.isDirectory()) walkTsFiles(full, exclude, out);
    else if (/\.tsx?$/.test(ent.name)) out.push(full);
  }
  return out;
}

function indentOf(line) {
  const m = line.match(/^(\s*)/);
  return m ? m[1] : "";
}

function trim(line) {
  return line.trim();
}

function isBlank(line) {
  return trim(line) === "";
}

function isPureCloser(line) {
  const t = trim(line);
  return /^(}|}\)|}\];?|]\);?|\];?|\);?|,|};?|\],?|\},?|\}\)[,;]?|\.catch\([^)]*\)[,;]?)$/.test(t)
    || /^(}\)|}\];|}\];)$/.test(t)
    || /^(\}|\]|\);?|\],?|\},?)$/.test(t)
    || /^(}\s*,?|]\s*,?|\);\s*|]\s*;\s*|}\s*;\s*)$/.test(t)
    || /^(}\)|\]\)|\)|;|,)$/.test(t)
    || /^(\}\s*\)\s*;?|\}\s*,|\]\s*,|\]\s*;|\}\s*;|\);)$/.test(t);
}

function isCommentLine(line) {
  const t = trim(line);
  return t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t.endsWith("*/");
}

function hasInlineComment(line) {
  // crude: // outside strings — good enough for skip decision
  let inS = null;
  let esc = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inS) {
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === inS) inS = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") { inS = c; continue; }
    if (c === "/" && line[i + 1] === "/") return true;
    if (c === "/" && line[i + 1] === "*") return true;
  }
  return false;
}

function stripStringsForScan(line) {
  let out = "";
  let inS = null;
  let esc = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inS) {
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === inS) { inS = null; out += " "; continue; }
      out += " ";
      continue;
    }
    if (c === "'" || c === '"' || c === "`") { inS = c; out += " "; continue; }
    out += c;
  }
  return out;
}

function generateComment(line, ctx) {
  const t = trim(line);
  const raw = line;

  // Imports
  if (/^import\s+type\s+/.test(t)) {
    const m = t.match(/from\s+["']([^"']+)["']/);
    return m ? `Type-only import from ${m[1]} for compile-time contracts.` : `Type-only import for compile-time contracts.`;
  }
  if (/^import\s+/.test(t)) {
    if (t.includes("preloadIsolatedTestEnv")) return `Load isolated P1 test env before any Prisma/DB clients connect.`;
    if (t.includes("assertTestDatabase")) return `Guard that mutating suites only run against the isolated test database.`;
    if (t.includes("dbBarrier") || t.includes("orderedDatabaseRace")) return `Concurrency helpers to order/observe PostgreSQL lock waiters.`;
    if (t.includes("httpHarness") || t.includes("listenApp")) return `HTTP harness to listen an in-process API for request-level tests.`;
    if (t.includes("fixtures") || t.includes("/fixtures")) return `Shared test fixtures for seeding users, locations, and domain entities.`;
    if (t.includes("@playwright/test")) return `Playwright test runner APIs for browser E2E scenarios.`;
    if (t.includes("node:test") || t.includes("node:assert")) return `Node test runner and strict assertions for API suite checks.`;
    if (t.includes("@prisma/client")) return `Prisma client types/runtime for DB setup and assertions.`;
    const m = t.match(/from\s+["']([^"']+)["']/);
    return m ? `Import bindings from ${m[1]}.` : `Import module bindings used by this suite.`;
  }

  // Exports / declarations
  if (/^export\s+default\s+/.test(t)) return `Default export of this module's primary configuration or suite entry.`;
  if (/^export\s+(async\s+)?function\s+(\w+)/.test(t)) {
    const name = t.match(/function\s+(\w+)/)[1];
    return `Export helper ${name} for reuse across related tests.`;
  }
  if (/^export\s+(const|let|type|interface|class|enum)\s+(\w+)/.test(t)) {
    const name = t.match(/(?:const|let|type|interface|class|enum)\s+(\w+)/)[1];
    return `Export ${name} for shared test/setup consumers.`;
  }
  if (/^export\s*\{/.test(t)) return `Re-export selected symbols for suite consumers.`;

  if (/^(async\s+)?function\s+(\w+)/.test(t)) {
    const name = t.match(/function\s+(\w+)/)[1];
    if (/login|auth|cookie|csrf/i.test(name)) return `Helper ${name}: auth/session setup for the scenario.`;
    if (/race|barrier|lock|concurrent|parallel|waitFor/i.test(name)) return `Helper ${name}: concurrency/isolation coordination.`;
    if (/seed|create|fixture|setup|prepare/i.test(name)) return `Helper ${name}: arrange fixture data for the case.`;
    if (/assert|expect|check|verify/i.test(name)) return `Helper ${name}: assert expected post-condition.`;
    return `Local helper ${name} used by cases in this file.`;
  }

  if (/^(const|let|var)\s+(\w+)\s*=/.test(t)) {
    const name = t.match(/^(?:const|let|var)\s+(\w+)/)[1];
    if (name === "prisma" || /PrismaClient/.test(t)) return `Shared Prisma client bound to the isolated test database.`;
    if (/REPS|ITER|ROUNDS|ATTEMPTS/i.test(name)) return `${name}: repetition count to amplify race windows.`;
    if (/PASSWORD|TOKEN|SECRET|CSRF/i.test(name)) return `${name}: credential/token material for auth flows.`;
    if (/baseURL|apiUrl|apiHealth|apiDir|webDir|rootDir/i.test(name)) return `${name}: path/URL used to reach the system under test.`;
    if (/timeout|deadline|TIMEOUT/i.test(name)) return `${name}: bound how long the wait/poll may run.`;
    if (/stamp|uuid|suffix|id$/i.test(name) || /randomUUID|nanoid/.test(t)) return `${name}: unique stamp so parallel runs do not collide.`;
    if (/server|app|listener/i.test(name)) return `${name}: in-process HTTP server handle for this suite.`;
    if (/jar|cookie|session/i.test(name)) return `${name}: session cookie jar for authenticated requests.`;
    if (/startServers|workers|retries/.test(name)) return `${name}: runner isolation/stability setting.`;
    if (/Promise\.all|Promise\.allSettled/.test(t)) return `${name}: capture concurrent outcomes for race assertions.`;
    if (/await\s+/.test(t) && /create|seed|insert|upsert/i.test(t)) return `${name}: seeded entity required before the mutation under test.`;
    if (/await\s+/.test(t) && /fetch|request|post|get|put|patch|delete/i.test(t)) return `${name}: HTTP response captured for status/body checks.`;
    if (/await\s+/.test(t) && /lock|barrier|race|wait/i.test(t)) return `${name}: synchronize actors so the race window is observable.`;
    return `Bind ${name} for later setup or assertions in this scope.`;
  }

  if (/^type\s+\w+/.test(t) || /^interface\s+\w+/.test(t)) {
    const name = t.match(/^(?:type|interface)\s+(\w+)/)[1];
    return `Shape ${name} documents the fixture/response fields this suite touches.`;
  }

  // Test structure
  if (/^(test\.)?describe(\.|)\s*\(/.test(t) || /^describe(\.\w+)?\s*\(/.test(t)) {
    const m = t.match(/["'`]([^"'`]+)["'`]/);
    return m ? `Suite: ${m[1]}.` : `Group related cases that share setup and isolation rules.`;
  }
  if (/^(test|it)(\.\w+)?\s*\(/.test(t)) {
    const m = t.match(/["'`]([^"'`]+)["'`]/);
    if (m) {
      const title = m[1];
      if (/concurr|race|parallel|simultan|vs\b|lock/i.test(title)) return `Case probes concurrency/isolation: ${title}.`;
      if (/idempoten/i.test(title)) return `Case checks idempotent replay safety: ${title}.`;
      if (/auth|forbid|deny|permission|csrf|logout/i.test(title)) return `Case checks authz/session policy: ${title}.`;
      return `Case: ${title}.`;
    }
    return `Define an individual test case.`;
  }
  if (/^before(All|Each)?\s*\(/.test(t)) return `Arrange shared preconditions before cases run.`;
  if (/^after(All|Each)?\s*\(/.test(t)) return `Release servers/DB clients so later suites stay isolated.`;

  // Assertions
  if (/^assert\.(equal|strictEqual|deepEqual|ok|fail|rejects|throws|match|notEqual)/.test(t) || /\bassert\.(equal|ok|fail)/.test(t)) {
    if (/status/.test(t)) return `Assert HTTP status matches the contract for this path.`;
    if (/current_database|expected|TEST_DATABASE|maintenance_p1/.test(t)) return `Assert we are on the isolated test DB, not a seed/prod database.`;
    if (/length|count/.test(t)) return `Assert collection size matches the expected post-condition.`;
    if (/idempoten|same|unchanged|replay/.test(t)) return `Assert replay/idempotent path did not create duplicates.`;
    if (/fail\(/.test(t)) return `Fail fast when the expected race/waiter condition never appears.`;
    return `Assert the observed value matches the intended post-condition.`;
  }
  if (/^expect\s*\(/.test(t) || /\bexpect\s*\(/.test(t) && /to(Be|Equal|Have|Contain|Match|Throw)/i.test(t)) {
    if (/toBeVisible|toBeHidden|toHaveCount|getByRole|getByText/.test(t)) return `Assert UI visibility/state after the user action.`;
    if (/status|toBe\(\s*\d+/.test(t)) return `Assert response/page reached the expected status.`;
    return `Assert browser/UI outcome matches the scenario intent.`;
  }

  // Control / concurrency
  if (/^for\s*\(/.test(t) || /^while\s*\(/.test(t)) {
    if (/REPS|rep|i\s*<|Date\.now|deadline|timeout/i.test(t)) return `Repeat/poll to widen the race window or wait for lock waiters.`;
    return `Iterate to cover variants or wait until a condition holds.`;
  }
  if (/^if\s*\(/.test(t)) {
    if (/TEST_DATABASE|DATABASE_URL|process\.env/.test(t)) return `Branch on env so isolation settings win over ambient config.`;
    if (/server|jar|token|status/.test(t)) return `Guard optional cleanup or alternate assertion paths.`;
    return `Conditional path for setup, cleanup, or alternate outcomes.`;
  }
  if (/^try\s*\{/.test(t)) return `Try path where partial failure must not leak suite state.`;
  if (/^catch\s*(\(|\{)/.test(t)) return `Swallow/record expected errors without abandoning isolation cleanup.`;
  if (/^finally\s*\{/.test(t)) return `Always run cleanup to preserve DB/server isolation across cases.`;
  if (/^return\s+/.test(t)) return `Return the arranged value/result to the caller.`;
  if (/^throw\s+/.test(t)) return `Surface a hard failure when isolation or contract is violated.`;

  // Awaits / calls
  if (/await\s+assertTestDatabase/.test(t)) return `Refuse to mutate unless connected to the isolated test database.`;
  if (/await\s+orderedDatabaseRace|waitForBlockedBehind|listBlockedBehind|holdBarrier/.test(t)) return `Coordinate DB lock waiters so the concurrent race is deterministic.`;
  if (/await\s+listenApp|closeServer/.test(t)) return `Start or stop the in-process API server for this suite.`;
  if (/await\s+.*\$disconnect|prisma\.\$disconnect/.test(t)) return `Disconnect Prisma so the pool does not leak across suites.`;
  if (/await\s+Promise\.all(Settled)?\s*\(/.test(t) || /Promise\.all(Settled)?\s*\(/.test(t)) return `Run actors together to expose races and serialization bugs.`;
  if (/await\s+fetch\(/.test(t) || /void\s+fetch\(/.test(t) || /fetch\(/.test(t) && /method:\s*["']POST/.test(ctx.window || "")) {
    if (/logout|refresh|login|csrf/i.test(t + (ctx.window || ""))) return `Issue auth session HTTP call under test.`;
    return `Issue HTTP request against the in-process or E2E API.`;
  }
  if (/await\s+uiLogin|page\.goto|page\.click|page\.fill|getByRole/.test(t)) return `Drive the browser through the user-visible workflow step.`;
  if (/await\s+new\s+Promise\(.*setTimeout/.test(t) || /setTimeout\(/.test(t)) return `Brief yield so lock waiters/UI can settle before asserting.`;
  if (/await\s+createEmployee|createLocation|seed|fixture|upsert|create\w+\(/.test(t)) return `Seed prerequisite rows so the mutation under test has a realistic baseline.`;
  if (/await\s+/.test(t)) return `Await async work before asserting or releasing locks.`;

  // process.env / config
  if (/process\.env\./.test(t)) return `Override env for isolation, rate-limit disable, or scheduler quieting.`;
  if (/defineConfig\s*\(/.test(t)) return `Playwright runner config: workers, servers, and isolation knobs.`;
  if (/testDir:|workers:|fullyParallel:|forbidOnly:|retries:|timeout:|use:|projects:|webServer:/.test(t)) {
    if (/workers:\s*1|fullyParallel:\s*false/.test(t)) return `Serialize workers to avoid cross-test DB/UI interference.`;
    if (/webServer:/.test(t)) return `Optionally boot API+Vite with P1 test DB env for local E2E.`;
    return `Runner option controlling stability or isolation of the suite.`;
  }

  // Object fields / property assignments common in tests
  if (/^(method|headers|body|cwd|url|command|env|baseURL|trace|screenshot|video)\s*:/.test(t)) {
    return `Configure ${t.split(":")[0]} for the request/server under test.`;
  }
  if (/^(role|email|password|fullName|employeeNumber|status|name)\s*:/.test(t)) {
    return `Fixture field ${t.split(":")[0]} for the seeded actor/entity.`;
  }

  // Class / decorator-ish
  if (/^class\s+\w+/.test(t)) return `Test helper class encapsulating repeated arrangement steps.`;

  // Switch / case
  if (/^switch\s*\(/.test(t)) return `Branch on discriminant for variant-specific assertions.`;
  if (/^case\s+/.test(t)) return `Handle this variant of the scenario matrix.`;
  if (/^default\s*:/.test(t)) return `Fallback branch when no matrix case matched.`;

  // Opening braces alone after previous commented statement — still a source line
  if (t === "{" || t === "({" || t === "[{") return null; // skip pure openers that add no intent

  // Continuation call chains
  if (/^\./.test(t)) {
    if (/toBeVisible|toHaveCount|toBeHidden|toContain|toEqual|toBe\(/.test(t)) return `Chained expectation refining the UI/API assertion.`;
    if (/catch\(|finally\(/.test(t)) return `Handle rejection/cleanup on the preceding promise.`;
    return `Continue the call chain for setup or assertion detail.`;
  }

  // Ternary / assignment continuations
  if (/^\?/.test(t) || /^:/.test(t)) return null;

  // Spread / rest in objects
  if (/^\.\.\./.test(t)) return `Spread prior env/config so overrides layer cleanly.`;

  // Generic expression statements
  if (/^(void|await)\s+/.test(t)) return `Fire-and-await side effect required before the next assertion.`;

  // Default: contextual but not restating
  if (t.length < 3) return null;
  if (/^[{}\[\](),;]+$/.test(t)) return null;

  // SQL-ish inside template — usually mid-query
  if (/^(SELECT|WITH|FROM|WHERE|AND|OR|JOIN|INNER|LEFT|UNION|INSERT|UPDATE|DELETE|RETURNING)\b/i.test(t)) {
    return `SQL fragment used to observe locks or assert DB state.`;
  }

  if (ctx.inSql) return `Continue SQL used for lock diagnostics or state checks.`;

  // Fallback meaningful-ish comment from keywords
  if (/concurr|race|parallel|barrier|lock|isolat/i.test(t)) return `Concurrency/isolation step for the race under test.`;
  if (/idempoten/i.test(t)) return `Idempotency-related step to ensure safe retries.`;
  if (/csrf|cookie|session|refresh|logout|login/i.test(t)) return `Session/CSRF step exercising auth lifecycle.`;
  if (/paginat|cursor|offset|limit/i.test(t)) return `Pagination step for list/contract coverage.`;
  if (/notif|sse|outbox|replay/i.test(t)) return `Delivery/replay step for async notification paths.`;

  return `Execute the next setup or assertion step for this scenario.`;
}

function processFile(filePath) {
  const original = fs.readFileSync(filePath, "utf8");
  const nl = original.includes("\r\n") ? "\r\n" : "\n";
  const lines = original.split(/\r?\n/);
  const out = [];
  let commentsAdded = 0;
  let skippedSafety = 0;
  const skipReasons = [];

  let inBlockComment = false;
  let inTemplate = false;
  let templateDepth = 0; // simplistic
  let inSql = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = trim(line);

    // Track block comments
    if (inBlockComment) {
      out.push(line);
      if (t.includes("*/")) inBlockComment = false;
      continue;
    }
    if (t.startsWith("/*") && !t.includes("*/")) {
      inBlockComment = true;
      out.push(line);
      continue;
    }
    if (t.startsWith("/*") && t.includes("*/")) {
      out.push(line);
      continue;
    }

    // Track template literal state across lines (best-effort)
    const tickCount = (line.match(/`/g) || []).length;
    // Ignore ticks in comments
    if (!isCommentLine(line)) {
      if (tickCount % 2 === 1) inTemplate = !inTemplate;
    }
    if (inTemplate && /SELECT|WITH RECURSIVE|pg_stat_activity|INSERT INTO/i.test(line)) inSql = true;
    if (!inTemplate) inSql = false;

    if (isBlank(line)) {
      out.push(line);
      continue;
    }
    if (isCommentLine(line)) {
      out.push(line);
      continue;
    }
    if (isPureCloser(line) || t === "{" || t === "({" || t === "})(" || t === "}) {") {
      out.push(line);
      continue;
    }
    // Skip lines that are only opening brace variants
    if (/^(\{|\[\s*|\(\s*|\{\s*)$/.test(t)) {
      out.push(line);
      continue;
    }

    // Already has adequate comment immediately above (in output or original prev)
    const prevOut = [...out].reverse().find((l) => !isBlank(l));
    if (prevOut && isCommentLine(prevOut)) {
      out.push(line);
      continue;
    }
    // Also check original previous non-blank if we haven't inserted yet — same
    // Inline explanatory comment on the line itself
    if (hasInlineComment(line) && /\/\/\s+\w+/.test(line)) {
      out.push(line);
      continue;
    }

    // Unsafe: inside template literal body (SQL/strings)
    if (inTemplate && !t.includes("`")) {
      // Still allow commenting the line that opens with code before a template?
      // Mid-template: skip for safety
      skippedSafety++;
      skipReasons.push({
        file: path.relative(ROOT, filePath).replace(/\\/g, "/"),
        lineHint: t.slice(0, 80),
        reason: "inside_template_literal",
      });
      out.push(line);
      continue;
    }

    // Skip shebang
    if (t.startsWith("#!")) {
      out.push(line);
      continue;
    }

    const window = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 3)).join(" ");
    const commentText = generateComment(line, { window, inSql });
    if (!commentText) {
      skippedSafety++;
      skipReasons.push({
        file: path.relative(ROOT, filePath).replace(/\\/g, "/"),
        lineHint: t.slice(0, 80),
        reason: "no_safe_meaningful_comment",
      });
      out.push(line);
      continue;
    }

    const ind = indentOf(line);
    out.push(`${ind}// ${commentText}`);
    commentsAdded++;
    out.push(line);
  }

  const next = out.join(nl) + (original.endsWith("\n") || original.endsWith("\r\n") ? (original.endsWith("\r\n") ? "\r\n" : "\n") : "");
  // Normalize: if original had trailing newline, keep; split/join may drop final empty
  let finalText = out.join(nl);
  if (original.endsWith("\r\n")) {
    if (!finalText.endsWith("\r\n")) finalText += "\r\n";
  } else if (original.endsWith("\n")) {
    if (!finalText.endsWith("\n")) finalText += "\n";
  }

  const modified = finalText !== original;
  if (modified) fs.writeFileSync(filePath, finalText, "utf8");

  return {
    file: path.relative(ROOT, filePath).replace(/\\/g, "/"),
    modified,
    commentsAdded,
    linesSkippedForSafety: skippedSafety,
    skipReasons,
  };
}

function main() {
  const files = [];
  for (const g of TARGET_GLOBS) {
    walkTsFiles(g.dir, g.exclude, files);
  }
  files.sort();

  let filesModified = 0;
  let commentsAdded = 0;
  let linesSkippedForSafety = 0;
  const skipReasons = [];
  const errors = [];

  for (const f of files) {
    try {
      const r = processFile(f);
      if (r.modified) filesModified++;
      commentsAdded += r.commentsAdded;
      linesSkippedForSafety += r.linesSkippedForSafety;
      // keep a sample of skip reasons (cap later)
      skipReasons.push(...r.skipReasons);
    } catch (e) {
      errors.push({ file: path.relative(ROOT, f).replace(/\\/g, "/"), error: String(e?.stack || e) });
    }
  }

  const report = {
    batch: "tests-e2e",
    filesInspected: files.length,
    filesModified,
    commentsAdded,
    linesSkippedForSafety,
    skipReasons: skipReasons.slice(0, 200),
    errors,
  };

  const reportPath = path.join(ROOT, ".comment-batches", "reports", "tests-e2e.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main();
