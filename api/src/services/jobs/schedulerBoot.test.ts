import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import ts from "typescript";
import { startJobScheduler } from "./scheduler";
import {
  JOB_SCHEDULER_DISABLED_EVENT,
  afterBootstrapStartJobs,
  getJobSchedulerWireBindings,
  wireJobSchedulerAfterBootstrap,
} from "./schedulerBoot";

function withFlag(value: string | undefined, run: () => void): void {
  const prev = process.env.DISABLE_JOB_SCHEDULER;
  if (value === undefined) delete process.env.DISABLE_JOB_SCHEDULER;
  else process.env.DISABLE_JOB_SCHEDULER = value;
  try {
    run();
  } finally {
    if (prev === undefined) delete process.env.DISABLE_JOB_SCHEDULER;
    else process.env.DISABLE_JOB_SCHEDULER = prev;
  }
}

function calleeName(expr: ts.Expression): string | null {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) {
    return expr.name.text;
  }
  return null;
}

function parseTs(filePath: string, raw: string): ts.SourceFile {
  return ts.createSourceFile(
    filePath,
    raw,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

describe("afterBootstrapStartJobs", () => {
  afterEach(() => {
    delete process.env.DISABLE_JOB_SCHEDULER;
  });

  it("warns and skips start when DISABLE_JOB_SCHEDULER=1 on process.env", () => {
    withFlag("1", () => {
      let started = 0;
      const warnings: Record<string, unknown>[] = [];
      afterBootstrapStartJobs({
        closing: false,
        start: () => {
          started += 1;
        },
        warn: (payload) => {
          // Append an entry to the accumulating collection.
          warnings.push(payload);
        },
        now: () => new Date("2026-11-01T12:00:00.000Z"),
      });
      assert.equal(started, 0);
      assert.equal(warnings.length, 1);
      assert.equal(warnings[0]?.event, JOB_SCHEDULER_DISABLED_EVENT);
      assert.equal(warnings[0]?.level, "warn");
      assert.equal(warnings[0]?.reason, "DISABLE_JOB_SCHEDULER=1");
    });
  });

  it("starts the scheduler when the flag is unset", () => {
    withFlag(undefined, () => {
      let started = 0;
      const warnings: unknown[] = [];
      afterBootstrapStartJobs({
        closing: false,
        start: () => {
          started += 1;
        },
        warn: (payload) => {
          // Append an entry to the accumulating collection.
          warnings.push(payload);
        },
      });
      assert.equal(started, 1);
      assert.equal(warnings.length, 0);
    });
  });

  it("skips start and warn while closing", () => {
    withFlag("1", () => {
      let started = 0;
      const warnings: unknown[] = [];
      afterBootstrapStartJobs({
        closing: true,
        start: () => {
          started += 1;
        },
        warn: (payload) => {
          // Append an entry to the accumulating collection.
          warnings.push(payload);
        },
      });
      assert.equal(started, 0);
      assert.equal(warnings.length, 0);
    });
  });

  it("ignores a fake env bag — only process.env controls the flag", () => {
    withFlag("1", () => {
      let started = 0;
      afterBootstrapStartJobs({
        closing: false,
        start: () => {
          started += 1;
        },
        warn: () => undefined,
      });
      assert.equal(started, 0);
    });
  });
});

describe("getJobSchedulerWireBindings / wire internals", () => {
  it("pins start identity to startJobScheduler", () => {
    const bindings = getJobSchedulerWireBindings();
    assert.equal(bindings.start, startJobScheduler);
    assert.equal(typeof bindings.warn, "function");
  });

  it("wire AST body is a single afterBootstrapStartJobs({ ...bindings(), closing })", () => {
    // Capture file path for use in this scope.
    const filePath = join(__dirname, "schedulerBoot.ts");
    const raw = readFileSync(filePath, "utf8");
    const source = parseTs(filePath, raw);

    // Capture wire fn for use in this scope.
    let wireFn: ts.FunctionDeclaration | undefined;
    const visit = (node: ts.Node) => {
      if (
        ts.isFunctionDeclaration(node) &&
        node.name?.text === "wireJobSchedulerAfterBootstrap"
      ) {
        // Update wire fn as control flow progresses.
        wireFn = node;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);

    assert.ok(wireFn, "wireJobSchedulerAfterBootstrap declaration missing");
    assert.ok(wireFn.body && ts.isBlock(wireFn.body));
    assert.equal(
      wireFn.body.statements.length,
      1,
      "wire body must be exactly one statement (no early return / locals)",
    );
    const stmt = wireFn.body.statements[0]!;
    assert.ok(ts.isExpressionStatement(stmt));
    assert.ok(ts.isCallExpression(stmt.expression));
    assert.equal(calleeName(stmt.expression.expression), "afterBootstrapStartJobs");
    assert.equal(stmt.expression.arguments.length, 1);
    const arg = stmt.expression.arguments[0]!;
    assert.ok(ts.isObjectLiteralExpression(arg));
    assert.equal(
      arg.properties.length,
      2,
      "object must be exactly spread(bindings) + closing shorthand",
    );

    const [first, second] = arg.properties;
    assert.ok(first && ts.isSpreadAssignment(first));
    assert.ok(ts.isCallExpression(first.expression));
    assert.equal(
      calleeName(first.expression.expression),
      "getJobSchedulerWireBindings",
    );
    assert.ok(
      second &&
        ts.isShorthandPropertyAssignment(second) &&
        second.name.text === "closing",
      "second property must be shorthand closing",
    );
  });

  it("wireJobSchedulerAfterBootstrap accepts a single closing argument", () => {
    assert.equal(typeof wireJobSchedulerAfterBootstrap, "function");
    assert.equal(wireJobSchedulerAfterBootstrap.length, 1);
  });
});

describe("index.ts job-scheduler wiring contract (AST)", () => {
  it("then-callback live-wires closing with shutdown assign and no shadows", () => {
    // Capture file path for use in this scope.
    const filePath = join(__dirname, "../../index.ts");
    const raw = readFileSync(filePath, "utf8");
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

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const name = calleeName(node.expression);
        if (name === "wireJobSchedulerAfterBootstrap") wireCalls.push(node);
        if (name === "startJobScheduler" || name === "afterBootstrapStartJobs") {
          // Append an entry to the accumulating collection.
          forbiddenCallees.push(name);
        }

        // initializeRequiredDefaults().then(() => {
        //   setBootstrapComplete(true);
        //   wireJobSchedulerAfterBootstrap(closing);
        // })
        if (
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "then" &&
          node.arguments.length >= 1
        ) {
          const cb = node.arguments[0]!;
          if (
            ts.isArrowFunction(cb) &&
            cb.body &&
            ts.isBlock(cb.body) &&
            cb.body.statements.length === 2
          ) {
            // Capture mark ready for use in this scope.
            const markReady = cb.body.statements[0]!;
            const wire = cb.body.statements[1]!;
            // Capture marks complete for use in this scope.
            const marksComplete =
              ts.isExpressionStatement(markReady) &&
              ts.isCallExpression(markReady.expression) &&
              calleeName(markReady.expression.expression) ===
                "setBootstrapComplete" &&
              markReady.expression.arguments.length === 1 &&
              markReady.expression.arguments[0]!.kind ===
                ts.SyntaxKind.TrueKeyword;
            // Capture wires closing for use in this scope.
            const wiresClosing =
              ts.isExpressionStatement(wire) &&
              ts.isCallExpression(wire.expression) &&
              calleeName(wire.expression.expression) ===
                "wireJobSchedulerAfterBootstrap" &&
              wire.expression.arguments.length === 1 &&
              ts.isIdentifier(wire.expression.arguments[0]!) &&
              wire.expression.arguments[0].text === "closing";
            if (marksComplete && wiresClosing) {
              // Update then wire live as control flow progresses.
              thenWireLive = true;
            }
          }
        }
      }

      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        if (node.name.text === "closing") closingVarDecls.push(node);
      }
      if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
        if (node.name.text === "closing") closingParams.push(node);
      }
      if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) {
        if (node.name.text === "closing") closingBindings.push(node);
      }

      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left) &&
        node.left.text === "closing" &&
        node.right.kind === ts.SyntaxKind.TrueKeyword
      ) {
        shutdownAssignsClosingTrue += 1;
      }

      if (
        ts.isDeleteExpression(node) &&
        /DISABLE_JOB_SCHEDULER/.test(node.expression.getText(source))
      ) {
        deleteDisableFlag += 1;
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        /DISABLE_JOB_SCHEDULER/.test(node.left.getText(source))
      ) {
        deleteDisableFlag += 1;
      }

      ts.forEachChild(node, visit);
    };
    visit(source);

    assert.equal(
      wireCalls.length,
      1,
      "exactly one CallExpression wireJobSchedulerAfterBootstrap",
    );
    assert.ok(
      thenWireLive,
      "then-callback must setBootstrapComplete(true) then wireJobSchedulerAfterBootstrap(closing)",
    );
    assert.equal(forbiddenCallees.length, 0, `forbidden: ${forbiddenCallees}`);
    assert.equal(
      closingVarDecls.length,
      1,
      "exactly one VariableDeclaration named closing",
    );
    assert.equal(
      closingParams.length,
      0,
      "no Parameter named closing (param shadow)",
    );
    assert.equal(
      closingBindings.length,
      0,
      "no BindingElement named closing (destructure shadow)",
    );

    const decl = closingVarDecls[0]!;
    assert.ok(
      decl.parent &&
        ts.isVariableDeclarationList(decl.parent) &&
        (decl.parent.flags & ts.NodeFlags.Let) !== 0,
      "closing must be let",
    );
    assert.ok(
      decl.initializer &&
        decl.initializer.kind === ts.SyntaxKind.FalseKeyword,
      "closing must initialize to false",
    );

    assert.ok(
      shutdownAssignsClosingTrue >= 1,
      "shutdown must assign closing = true",
    );
    assert.equal(
      deleteDisableFlag,
      0,
      "must not delete/assign DISABLE_JOB_SCHEDULER before wire",
    );
  });
});
