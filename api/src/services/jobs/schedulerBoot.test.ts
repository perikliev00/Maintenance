// Import module node:assert/strict for this service.
import assert from "node:assert/strict";
// Import module node:fs for this service.
import { readFileSync } from "node:fs";
// Import module node:path for this service.
import { join } from "node:path";
// Import module node:test for this service.
import { afterEach, describe, it } from "node:test";
// Import module typescript for this service.
import ts from "typescript";
// Import module ./scheduler for this service.
import { startJobScheduler } from "./scheduler";
// Import module dependency for this service.
import {
  // Run next step: JOB_SCHEDULER_DISABLED_EVENT,
  JOB_SCHEDULER_DISABLED_EVENT,
  // Run next step: afterBootstrapStartJobs,
  afterBootstrapStartJobs,
  // Run next step: getJobSchedulerWireBindings,
  getJobSchedulerWireBindings,
  // Run next step: wireJobSchedulerAfterBootstrap,
  wireJobSchedulerAfterBootstrap,
// Run next step: } from "./schedulerBoot";
} from "./schedulerBoot";

// Define withFlag — core behavior for this module.
function withFlag(value: string | undefined, run: () => void): void {
  // Capture prev for use in this scope.
  const prev = process.env.DISABLE_JOB_SCHEDULER;
  // Branch when this condition holds so the right path runs.
  if (value === undefined) delete process.env.DISABLE_JOB_SCHEDULER;
  // Run next step: else process.env.DISABLE_JOB_SCHEDULER = value;
  else process.env.DISABLE_JOB_SCHEDULER = value;
  // Attempt the fallible work so errors can be handled below.
  try {
    // Run next step: run();
    run();
  // Run next step: } finally {
  } finally {
    // Branch when this condition holds so the right path runs.
    if (prev === undefined) delete process.env.DISABLE_JOB_SCHEDULER;
    // Run next step: else process.env.DISABLE_JOB_SCHEDULER = prev;
    else process.env.DISABLE_JOB_SCHEDULER = prev;
  }
}

// Define calleeName — core behavior for this module.
function calleeName(expr: ts.Expression): string | null {
  // Branch when this condition holds so the right path runs.
  if (ts.isIdentifier(expr)) return expr.text;
  // Branch when this condition holds so the right path runs.
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) {
    // Return the computed result to the caller.
    return expr.name.text;
  }
  // Return the computed result to the caller.
  return null;
}

// Define parseTs — core behavior for this module.
function parseTs(filePath: string, raw: string): ts.SourceFile {
  // Return the computed result to the caller.
  return ts.createSourceFile(
    // Run next step: filePath,
    filePath,
    // Run next step: raw,
    raw,
    // Run next step: ts.ScriptTarget.Latest,
    ts.ScriptTarget.Latest,
    // Run next step: true,
    true,
    // Run next step: ts.ScriptKind.TS,
    ts.ScriptKind.TS,
  );
}

// Run next step: describe("afterBootstrapStartJobs", () => {
describe("afterBootstrapStartJobs", () => {
  // Run next step: afterEach(() => {
  afterEach(() => {
    // Run next step: delete process.env.DISABLE_JOB_SCHEDULER;
    delete process.env.DISABLE_JOB_SCHEDULER;
  });

  // Run next step: it("warns and skips start when DISABLE_JOB_SCHEDULER=1 on pr…
  it("warns and skips start when DISABLE_JOB_SCHEDULER=1 on process.env", () => {
    // Run next step: withFlag("1", () => {
    withFlag("1", () => {
      // Capture started for use in this scope.
      let started = 0;
      // Capture warnings for use in this scope.
      const warnings: Record<string, unknown>[] = [];
      // Run next step: afterBootstrapStartJobs({
      afterBootstrapStartJobs({
        // Set closing on the structure being built.
        closing: false,
        // Set start on the structure being built.
        start: () => {
          // Run next step: started += 1;
          started += 1;
        },
        // Set warn on the structure being built.
        warn: (payload) => {
          // Append an entry to the accumulating collection.
          warnings.push(payload);
        },
        // Set now on the structure being built.
        now: () => new Date("2026-11-01T12:00:00.000Z"),
      });
      // Run next step: assert.equal(started, 0);
      assert.equal(started, 0);
      // Run next step: assert.equal(warnings.length, 1);
      assert.equal(warnings.length, 1);
      // Run next step: assert.equal(warnings[0]?.event, JOB_SCHEDULER_DISABLED_EVEN…
      assert.equal(warnings[0]?.event, JOB_SCHEDULER_DISABLED_EVENT);
      // Run next step: assert.equal(warnings[0]?.level, "warn");
      assert.equal(warnings[0]?.level, "warn");
      // Run next step: assert.equal(warnings[0]?.reason, "DISABLE_JOB_SCHEDULER=1")…
      assert.equal(warnings[0]?.reason, "DISABLE_JOB_SCHEDULER=1");
    });
  });

  // Run next step: it("starts the scheduler when the flag is unset", () => {
  it("starts the scheduler when the flag is unset", () => {
    // Run next step: withFlag(undefined, () => {
    withFlag(undefined, () => {
      // Capture started for use in this scope.
      let started = 0;
      // Capture warnings for use in this scope.
      const warnings: unknown[] = [];
      // Run next step: afterBootstrapStartJobs({
      afterBootstrapStartJobs({
        // Set closing on the structure being built.
        closing: false,
        // Set start on the structure being built.
        start: () => {
          // Run next step: started += 1;
          started += 1;
        },
        // Set warn on the structure being built.
        warn: (payload) => {
          // Append an entry to the accumulating collection.
          warnings.push(payload);
        },
      });
      // Run next step: assert.equal(started, 1);
      assert.equal(started, 1);
      // Run next step: assert.equal(warnings.length, 0);
      assert.equal(warnings.length, 0);
    });
  });

  // Run next step: it("skips start and warn while closing", () => {
  it("skips start and warn while closing", () => {
    // Run next step: withFlag("1", () => {
    withFlag("1", () => {
      // Capture started for use in this scope.
      let started = 0;
      // Capture warnings for use in this scope.
      const warnings: unknown[] = [];
      // Run next step: afterBootstrapStartJobs({
      afterBootstrapStartJobs({
        // Set closing on the structure being built.
        closing: true,
        // Set start on the structure being built.
        start: () => {
          // Run next step: started += 1;
          started += 1;
        },
        // Set warn on the structure being built.
        warn: (payload) => {
          // Append an entry to the accumulating collection.
          warnings.push(payload);
        },
      });
      // Run next step: assert.equal(started, 0);
      assert.equal(started, 0);
      // Run next step: assert.equal(warnings.length, 0);
      assert.equal(warnings.length, 0);
    });
  });

  // Run next step: it("ignores a fake env bag — only process.env controls the f…
  it("ignores a fake env bag — only process.env controls the flag", () => {
    // Run next step: withFlag("1", () => {
    withFlag("1", () => {
      // Capture started for use in this scope.
      let started = 0;
      // Run next step: afterBootstrapStartJobs({
      afterBootstrapStartJobs({
        // Set closing on the structure being built.
        closing: false,
        // Set start on the structure being built.
        start: () => {
          // Run next step: started += 1;
          started += 1;
        },
        // Set warn on the structure being built.
        warn: () => undefined,
      });
      // Run next step: assert.equal(started, 0);
      assert.equal(started, 0);
    });
  });
});

// Run next step: describe("getJobSchedulerWireBindings / wire internals", () …
describe("getJobSchedulerWireBindings / wire internals", () => {
  // Run next step: it("pins start identity to startJobScheduler", () => {
  it("pins start identity to startJobScheduler", () => {
    // Capture bindings for use in this scope.
    const bindings = getJobSchedulerWireBindings();
    // Run next step: assert.equal(bindings.start, startJobScheduler);
    assert.equal(bindings.start, startJobScheduler);
    // Run next step: assert.equal(typeof bindings.warn, "function");
    assert.equal(typeof bindings.warn, "function");
  });

  // Run next step: it("wire AST body is a single afterBootstrapStartJobs({ ...b…
  it("wire AST body is a single afterBootstrapStartJobs({ ...bindings(), closing })", () => {
    // Capture file path for use in this scope.
    const filePath = join(__dirname, "schedulerBoot.ts");
    // Capture raw for use in this scope.
    const raw = readFileSync(filePath, "utf8");
    // Capture source for use in this scope.
    const source = parseTs(filePath, raw);

    // Capture wire fn for use in this scope.
    let wireFn: ts.FunctionDeclaration | undefined;
    // Define visit as a callable used by this flow.
    const visit = (node: ts.Node) => {
      // Branch when this condition holds so the right path runs.
      if (
        // Run next step: ts.isFunctionDeclaration(node) &&
        ts.isFunctionDeclaration(node) &&
        // Run next step: node.name?.text === "wireJobSchedulerAfterBootstrap"
        node.name?.text === "wireJobSchedulerAfterBootstrap"
      // Run next step: ) {
      ) {
        // Update wire fn as control flow progresses.
        wireFn = node;
      }
      // Run next step: ts.forEachChild(node, visit);
      ts.forEachChild(node, visit);
    };
    // Run next step: visit(source);
    visit(source);

    // Run next step: assert.ok(wireFn, "wireJobSchedulerAfterBootstrap declaratio…
    assert.ok(wireFn, "wireJobSchedulerAfterBootstrap declaration missing");
    // Run next step: assert.ok(wireFn.body && ts.isBlock(wireFn.body));
    assert.ok(wireFn.body && ts.isBlock(wireFn.body));
    // Run next step: assert.equal(
    assert.equal(
      // Run next step: wireFn.body.statements.length,
      wireFn.body.statements.length,
      // Run next step: 1,
      1,
      // Run next step: "wire body must be exactly one statement (no early return / …
      "wire body must be exactly one statement (no early return / locals)",
    );
    // Capture stmt for use in this scope.
    const stmt = wireFn.body.statements[0]!;
    // Run next step: assert.ok(ts.isExpressionStatement(stmt));
    assert.ok(ts.isExpressionStatement(stmt));
    // Run next step: assert.ok(ts.isCallExpression(stmt.expression));
    assert.ok(ts.isCallExpression(stmt.expression));
    // Run next step: assert.equal(calleeName(stmt.expression.expression), "afterB…
    assert.equal(calleeName(stmt.expression.expression), "afterBootstrapStartJobs");
    // Run next step: assert.equal(stmt.expression.arguments.length, 1);
    assert.equal(stmt.expression.arguments.length, 1);
    // Capture arg for use in this scope.
    const arg = stmt.expression.arguments[0]!;
    // Run next step: assert.ok(ts.isObjectLiteralExpression(arg));
    assert.ok(ts.isObjectLiteralExpression(arg));
    // Run next step: assert.equal(
    assert.equal(
      // Run next step: arg.properties.length,
      arg.properties.length,
      // Run next step: 2,
      2,
      // Run next step: "object must be exactly spread(bindings) + closing shorthand…
      "object must be exactly spread(bindings) + closing shorthand",
    );

    // Destructure value fields needed locally.
    const [first, second] = arg.properties;
    // Run next step: assert.ok(first && ts.isSpreadAssignment(first));
    assert.ok(first && ts.isSpreadAssignment(first));
    // Run next step: assert.ok(ts.isCallExpression(first.expression));
    assert.ok(ts.isCallExpression(first.expression));
    // Run next step: assert.equal(
    assert.equal(
      // Run next step: calleeName(first.expression.expression),
      calleeName(first.expression.expression),
      // Run next step: "getJobSchedulerWireBindings",
      "getJobSchedulerWireBindings",
    );
    // Run next step: assert.ok(
    assert.ok(
      // Run next step: second &&
      second &&
        // Run next step: ts.isShorthandPropertyAssignment(second) &&
        ts.isShorthandPropertyAssignment(second) &&
        // Run next step: second.name.text === "closing",
        second.name.text === "closing",
      // Run next step: "second property must be shorthand closing",
      "second property must be shorthand closing",
    );
  });

  // Run next step: it("wireJobSchedulerAfterBootstrap accepts a single closing …
  it("wireJobSchedulerAfterBootstrap accepts a single closing argument", () => {
    // Run next step: assert.equal(typeof wireJobSchedulerAfterBootstrap, "functio…
    assert.equal(typeof wireJobSchedulerAfterBootstrap, "function");
    // Run next step: assert.equal(wireJobSchedulerAfterBootstrap.length, 1);
    assert.equal(wireJobSchedulerAfterBootstrap.length, 1);
  });
});

// Run next step: describe("index.ts job-scheduler wiring contract (AST)", () …
describe("index.ts job-scheduler wiring contract (AST)", () => {
  // Run next step: it("then-callback live-wires closing with shutdown assign an…
  it("then-callback live-wires closing with shutdown assign and no shadows", () => {
    // Capture file path for use in this scope.
    const filePath = join(__dirname, "../../index.ts");
    // Capture raw for use in this scope.
    const raw = readFileSync(filePath, "utf8");
    // Capture source for use in this scope.
    const source = parseTs(filePath, raw);

    // Capture wire calls for use in this scope.
    const wireCalls: ts.CallExpression[] = [];
    // Capture forbidden callees for use in this scope.
    const forbiddenCallees: string[] = [];
    // Capture closing var decls for use in this scope.
    const closingVarDecls: ts.VariableDeclaration[] = [];
    // Capture closing params for use in this scope.
    const closingParams: ts.ParameterDeclaration[] = [];
    // Capture closing bindings for use in this scope.
    const closingBindings: ts.BindingElement[] = [];
    // Capture shutdown assigns closing true for use in this scope.
    let shutdownAssignsClosingTrue = 0;
    // Capture delete disable flag for use in this scope.
    let deleteDisableFlag = 0;
    // Capture then wire live for use in this scope.
    let thenWireLive = false;

    // Define visit as a callable used by this flow.
    const visit = (node: ts.Node) => {
      // Branch when this condition holds so the right path runs.
      if (ts.isCallExpression(node)) {
        // Capture name for use in this scope.
        const name = calleeName(node.expression);
        // Branch when this condition holds so the right path runs.
        if (name === "wireJobSchedulerAfterBootstrap") wireCalls.push(node);
        // Branch when this condition holds so the right path runs.
        if (name === "startJobScheduler" || name === "afterBootstrapStartJobs") {
          // Append an entry to the accumulating collection.
          forbiddenCallees.push(name);
        }

        // initializeRequiredDefaults().then(() => {
        //   setBootstrapComplete(true);
        //   wireJobSchedulerAfterBootstrap(closing);
        // })
        if (
          // Run next step: ts.isPropertyAccessExpression(node.expression) &&
          ts.isPropertyAccessExpression(node.expression) &&
          // Run next step: node.expression.name.text === "then" &&
          node.expression.name.text === "then" &&
          // Run next step: node.arguments.length >= 1
          node.arguments.length >= 1
        // Run next step: ) {
        ) {
          // Capture cb for use in this scope.
          const cb = node.arguments[0]!;
          // Branch when this condition holds so the right path runs.
          if (
            // Run next step: ts.isArrowFunction(cb) &&
            ts.isArrowFunction(cb) &&
            // Run next step: cb.body &&
            cb.body &&
            // Run next step: ts.isBlock(cb.body) &&
            ts.isBlock(cb.body) &&
            // Run next step: cb.body.statements.length === 2
            cb.body.statements.length === 2
          // Run next step: ) {
          ) {
            // Capture mark ready for use in this scope.
            const markReady = cb.body.statements[0]!;
            // Capture wire for use in this scope.
            const wire = cb.body.statements[1]!;
            // Capture marks complete for use in this scope.
            const marksComplete =
              // Run next step: ts.isExpressionStatement(markReady) &&
              ts.isExpressionStatement(markReady) &&
              // Run next step: ts.isCallExpression(markReady.expression) &&
              ts.isCallExpression(markReady.expression) &&
              // Run next step: calleeName(markReady.expression.expression) ===
              calleeName(markReady.expression.expression) ===
                // Run next step: "setBootstrapComplete" &&
                "setBootstrapComplete" &&
              // Run next step: markReady.expression.arguments.length === 1 &&
              markReady.expression.arguments.length === 1 &&
              // Run next step: markReady.expression.arguments[0]!.kind ===
              markReady.expression.arguments[0]!.kind ===
                // Run next step: ts.SyntaxKind.TrueKeyword;
                ts.SyntaxKind.TrueKeyword;
            // Capture wires closing for use in this scope.
            const wiresClosing =
              // Run next step: ts.isExpressionStatement(wire) &&
              ts.isExpressionStatement(wire) &&
              // Run next step: ts.isCallExpression(wire.expression) &&
              ts.isCallExpression(wire.expression) &&
              // Run next step: calleeName(wire.expression.expression) ===
              calleeName(wire.expression.expression) ===
                // Run next step: "wireJobSchedulerAfterBootstrap" &&
                "wireJobSchedulerAfterBootstrap" &&
              // Run next step: wire.expression.arguments.length === 1 &&
              wire.expression.arguments.length === 1 &&
              // Run next step: ts.isIdentifier(wire.expression.arguments[0]!) &&
              ts.isIdentifier(wire.expression.arguments[0]!) &&
              // Run next step: wire.expression.arguments[0].text === "closing";
              wire.expression.arguments[0].text === "closing";
            // Branch when this condition holds so the right path runs.
            if (marksComplete && wiresClosing) {
              // Update then wire live as control flow progresses.
              thenWireLive = true;
            }
          }
        }
      }

      // Branch when this condition holds so the right path runs.
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        // Branch when this condition holds so the right path runs.
        if (node.name.text === "closing") closingVarDecls.push(node);
      }
      // Branch when this condition holds so the right path runs.
      if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
        // Branch when this condition holds so the right path runs.
        if (node.name.text === "closing") closingParams.push(node);
      }
      // Branch when this condition holds so the right path runs.
      if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) {
        // Branch when this condition holds so the right path runs.
        if (node.name.text === "closing") closingBindings.push(node);
      }

      // Branch when this condition holds so the right path runs.
      if (
        // Run next step: ts.isBinaryExpression(node) &&
        ts.isBinaryExpression(node) &&
        // Run next step: node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        // Run next step: ts.isIdentifier(node.left) &&
        ts.isIdentifier(node.left) &&
        // Run next step: node.left.text === "closing" &&
        node.left.text === "closing" &&
        // Run next step: node.right.kind === ts.SyntaxKind.TrueKeyword
        node.right.kind === ts.SyntaxKind.TrueKeyword
      // Run next step: ) {
      ) {
        // Run next step: shutdownAssignsClosingTrue += 1;
        shutdownAssignsClosingTrue += 1;
      }

      // Branch when this condition holds so the right path runs.
      if (
        // Run next step: ts.isDeleteExpression(node) &&
        ts.isDeleteExpression(node) &&
        // Run next step: /DISABLE_JOB_SCHEDULER/.test(node.expression.getText(source)…
        /DISABLE_JOB_SCHEDULER/.test(node.expression.getText(source))
      // Run next step: ) {
      ) {
        // Run next step: deleteDisableFlag += 1;
        deleteDisableFlag += 1;
      }
      // Branch when this condition holds so the right path runs.
      if (
        // Run next step: ts.isBinaryExpression(node) &&
        ts.isBinaryExpression(node) &&
        // Run next step: node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        // Run next step: /DISABLE_JOB_SCHEDULER/.test(node.left.getText(source))
        /DISABLE_JOB_SCHEDULER/.test(node.left.getText(source))
      // Run next step: ) {
      ) {
        // Run next step: deleteDisableFlag += 1;
        deleteDisableFlag += 1;
      }

      // Run next step: ts.forEachChild(node, visit);
      ts.forEachChild(node, visit);
    };
    // Run next step: visit(source);
    visit(source);

    // Run next step: assert.equal(
    assert.equal(
      // Run next step: wireCalls.length,
      wireCalls.length,
      // Run next step: 1,
      1,
      // Run next step: "exactly one CallExpression wireJobSchedulerAfterBootstrap",
      "exactly one CallExpression wireJobSchedulerAfterBootstrap",
    );
    // Run next step: assert.ok(
    assert.ok(
      // Run next step: thenWireLive,
      thenWireLive,
      // Run next step: "then-callback must setBootstrapComplete(true) then wireJobS…
      "then-callback must setBootstrapComplete(true) then wireJobSchedulerAfterBootstrap(closing)",
    );
    // Run next step: assert.equal(forbiddenCallees.length, 0, `forbidden: ${forbi…
    assert.equal(forbiddenCallees.length, 0, `forbidden: ${forbiddenCallees}`);
    // Run next step: assert.equal(
    assert.equal(
      // Run next step: closingVarDecls.length,
      closingVarDecls.length,
      // Run next step: 1,
      1,
      // Run next step: "exactly one VariableDeclaration named closing",
      "exactly one VariableDeclaration named closing",
    );
    // Run next step: assert.equal(
    assert.equal(
      // Run next step: closingParams.length,
      closingParams.length,
      // Run next step: 0,
      0,
      // Run next step: "no Parameter named closing (param shadow)",
      "no Parameter named closing (param shadow)",
    );
    // Run next step: assert.equal(
    assert.equal(
      // Run next step: closingBindings.length,
      closingBindings.length,
      // Run next step: 0,
      0,
      // Run next step: "no BindingElement named closing (destructure shadow)",
      "no BindingElement named closing (destructure shadow)",
    );

    // Capture decl for use in this scope.
    const decl = closingVarDecls[0]!;
    // Run next step: assert.ok(
    assert.ok(
      // Run next step: decl.parent &&
      decl.parent &&
        // Run next step: ts.isVariableDeclarationList(decl.parent) &&
        ts.isVariableDeclarationList(decl.parent) &&
        // Run next step: (decl.parent.flags & ts.NodeFlags.Let) !== 0,
        (decl.parent.flags & ts.NodeFlags.Let) !== 0,
      // Run next step: "closing must be let",
      "closing must be let",
    );
    // Run next step: assert.ok(
    assert.ok(
      // Run next step: decl.initializer &&
      decl.initializer &&
        // Run next step: decl.initializer.kind === ts.SyntaxKind.FalseKeyword,
        decl.initializer.kind === ts.SyntaxKind.FalseKeyword,
      // Run next step: "closing must initialize to false",
      "closing must initialize to false",
    );

    // Run next step: assert.ok(
    assert.ok(
      // Run next step: shutdownAssignsClosingTrue >= 1,
      shutdownAssignsClosingTrue >= 1,
      // Run next step: "shutdown must assign closing = true",
      "shutdown must assign closing = true",
    );
    // Run next step: assert.equal(
    assert.equal(
      // Run next step: deleteDisableFlag,
      deleteDisableFlag,
      // Run next step: 0,
      0,
      // Run next step: "must not delete/assign DISABLE_JOB_SCHEDULER before wire",
      "must not delete/assign DISABLE_JOB_SCHEDULER before wire",
    );
  });
});
