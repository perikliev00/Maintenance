// Strict assertions for CSRF middleware unit cases.
import assert from "node:assert/strict";
// Express types for mock req/res/next.
import type { NextFunction, Request, Response } from "express";
// Node test runner suite helpers.
import { describe, it } from "node:test";
// CSRF cookie/header names and helpers under test.
import {
  // List item in import/export/params.
  CSRF_COOKIE,
  // List item in import/export/params.
  CSRF_HEADER,
  // List item in import/export/params.
  REFRESH_COOKIE,
  // List item in import/export/params.
  SESSION_COOKIE,
  // List item in import/export/params.
  extractAccessToken,
  // List item in import/export/params.
  readBearerAccessToken,
  // List item in import/export/params.
  requireCsrf,
// Support the surrounding logic for this step.
} from "./session";

// Minimal mutable response stub capturing status/json.
type MockRes = {
  // Provide statusCode field used by this structure.
  statusCode: number | null;
  // Provide body field used by this structure.
  body: unknown;
  // Provide status field used by this structure.
  status: (code: number) => MockRes;
  // Provide json field used by this structure.
  json: (payload: unknown) => MockRes;
};

// Build a chainable mock Response used by requireCsrf.
function createMockRes(): MockRes {
  // Initialize an object holding related fields.
  const res: MockRes = {
    // Provide statusCode field used by this structure.
    statusCode: null,
    // Provide body field used by this structure.
    body: null,
    // Invoke status to perform this step.
    status(code: number) {
      // Support the surrounding logic for this step.
      res.statusCode = code;
      // Return early result or rendered output from this path.
      return res;
    },
    // Invoke json to perform this step.
    json(payload: unknown) {
      // Support the surrounding logic for this step.
      res.body = payload;
      // Return early result or rendered output from this path.
      return res;
    },
  };
  // Return early result or rendered output from this path.
  return res;
}

// Build a partial Request with method/cookies/headers for CSRF cases.
function createMockReq(input: {
  // Support the surrounding logic for this step.
  method?: string;
  // Support the surrounding logic for this step.
  cookies?: Record<string, string>;
  // Support the surrounding logic for this step.
  headers?: Record<string, string | string[] | undefined>;
// Support the surrounding logic for this step.
}): Request {
  // Return early result or rendered output from this path.
  return {
    // Provide method field used by this structure.
    method: input.method ?? "POST",
    // Provide cookies field used by this structure.
    cookies: input.cookies ?? {},
    // Provide headers field used by this structure.
    headers: input.headers ?? {},
  // Support the surrounding logic for this step.
  } as unknown as Request;
}

// Shared expectation for CSRF rejection responses.
function assertCsrfRejected(res: MockRes, nextCalled: number) {
  // Assert expected behavior in this test case.
  assert.equal(res.statusCode, 403);
  // Assert expected behavior in this test case.
  assert.deepEqual(res.body, {
    // Provide error field used by this structure.
    error: "csrf",
    // Provide message field used by this structure.
    message: "Invalid CSRF token",
  });
  // Assert expected behavior in this test case.
  assert.equal(nextCalled, 0);
}

// Group related tests under a shared suite name.
describe("requireCsrf", () => {
  // AUTH-T-P007-01: missing or wrong CSRF rejected for cookie auth
  it("rejects missing CSRF header when session cookie present", () => {
    // Bind req for use in the following logic.
    const req = createMockReq({
      // Provide cookies field used by this structure.
      cookies: {
        // Support the surrounding logic for this step.
        [SESSION_COOKIE]: "access-token",
        // Support the surrounding logic for this step.
        [CSRF_COOKIE]: "token-a",
      },
    });
    // Bind res for use in the following logic.
    const res = createMockRes();
    // Bind nextCalled for use in the following logic.
    let nextCalled = 0;
    // Bind next for use in the following logic.
    const next: NextFunction = () => {
      // Support the surrounding logic for this step.
      nextCalled += 1;
    };

    // Invoke requireCsrf to perform this step.
    requireCsrf(req, res as unknown as Response, next);
    // Invoke assertCsrfRejected to perform this step.
    assertCsrfRejected(res, nextCalled);
  });

  // Cookie present but header value does not match → 403.
  it("rejects wrong CSRF header when session cookie present", () => {
    // Bind req for use in the following logic.
    const req = createMockReq({
      // Provide cookies field used by this structure.
      cookies: {
        // Support the surrounding logic for this step.
        [SESSION_COOKIE]: "access-token",
        // Support the surrounding logic for this step.
        [CSRF_COOKIE]: "token-a",
      },
      // Provide headers field used by this structure.
      headers: {
        // Support the surrounding logic for this step.
        [CSRF_HEADER]: "token-b",
      },
    });
    // Bind res for use in the following logic.
    const res = createMockRes();
    // Bind nextCalled for use in the following logic.
    let nextCalled = 0;
    // Bind next for use in the following logic.
    const next: NextFunction = () => {
      // Support the surrounding logic for this step.
      nextCalled += 1;
    };

    // Invoke requireCsrf to perform this step.
    requireCsrf(req, res as unknown as Response, next);
    // Invoke assertCsrfRejected to perform this step.
    assertCsrfRejected(res, nextCalled);
  });

  // Refresh-cookie-only mutating requests still need CSRF.
  it("rejects missing CSRF when only refresh cookie present", () => {
    // Bind req for use in the following logic.
    const req = createMockReq({
      // Provide cookies field used by this structure.
      cookies: {
        // Support the surrounding logic for this step.
        [REFRESH_COOKIE]: "refresh-token",
        // Support the surrounding logic for this step.
        [CSRF_COOKIE]: "token-a",
      },
    });
    // Bind res for use in the following logic.
    const res = createMockRes();
    // Bind nextCalled for use in the following logic.
    let nextCalled = 0;
    // Bind next for use in the following logic.
    const next: NextFunction = () => {
      // Support the surrounding logic for this step.
      nextCalled += 1;
    };

    // Invoke requireCsrf to perform this step.
    requireCsrf(req, res as unknown as Response, next);
    // Invoke assertCsrfRejected to perform this step.
    assertCsrfRejected(res, nextCalled);
  });

  // AUTH-T-P007-02: matching CSRF allowed; usable Bearer without refresh cookie skips
  it("allows request when CSRF cookie matches header", () => {
    // Bind req for use in the following logic.
    const req = createMockReq({
      // Provide cookies field used by this structure.
      cookies: {
        // Support the surrounding logic for this step.
        [SESSION_COOKIE]: "access-token",
        // Support the surrounding logic for this step.
        [CSRF_COOKIE]: "token-a",
      },
      // Provide headers field used by this structure.
      headers: {
        // Support the surrounding logic for this step.
        [CSRF_HEADER]: "token-a",
      },
    });
    // Bind res for use in the following logic.
    const res = createMockRes();
    // Bind nextCalled for use in the following logic.
    let nextCalled = 0;
    // Bind next for use in the following logic.
    const next: NextFunction = () => {
      // Support the surrounding logic for this step.
      nextCalled += 1;
    };

    // Invoke requireCsrf to perform this step.
    requireCsrf(req, res as unknown as Response, next);

    // Assert expected behavior in this test case.
    assert.equal(nextCalled, 1);
    // Assert expected behavior in this test case.
    assert.equal(res.statusCode, null);
    // Assert expected behavior in this test case.
    assert.equal(res.body, null);
  });

  // Usable Bearer without refresh cookie authenticates without CSRF.
  it("skips CSRF for usable Bearer with session cookie but no refresh cookie", () => {
    // Bind req for use in the following logic.
    const req = createMockReq({
      // Provide cookies field used by this structure.
      cookies: {
        // Support the surrounding logic for this step.
        [SESSION_COOKIE]: "access-token",
        // Support the surrounding logic for this step.
        [CSRF_COOKIE]: "token-a",
      },
      // Provide headers field used by this structure.
      headers: {
        // Provide authorization field used by this structure.
        authorization: "Bearer some-access-token",
      },
    });
    // Bind res for use in the following logic.
    const res = createMockRes();
    // Bind nextCalled for use in the following logic.
    let nextCalled = 0;
    // Bind next for use in the following logic.
    const next: NextFunction = () => {
      // Support the surrounding logic for this step.
      nextCalled += 1;
    };

    // Invoke requireCsrf to perform this step.
    requireCsrf(req, res as unknown as Response, next);

    // Assert expected behavior in this test case.
    assert.equal(nextCalled, 1);
    // Assert expected behavior in this test case.
    assert.equal(res.statusCode, null);
    // Assert expected behavior in this test case.
    assert.equal(res.body, null);
  });

  // Whitespace-only Bearer must fall through to the session cookie.
  it("does not treat whitespace-only Bearer (U+00A0) as usable auth", () => {
    // Bind nbsp for use in the following logic.
    const nbsp = "\u00A0";
    // Bind req for use in the following logic.
    const req = createMockReq({
      // Provide cookies field used by this structure.
      cookies: {
        // Support the surrounding logic for this step.
        [SESSION_COOKIE]: "cookie-access-token",
        // Support the surrounding logic for this step.
        [CSRF_COOKIE]: "token-a",
      },
      // Provide headers field used by this structure.
      headers: {
        // Provide authorization field used by this structure.
        authorization: `Bearer ${nbsp}`,
      },
    });

    // Assert expected behavior in this test case.
    assert.equal(readBearerAccessToken(req), null);
    // Bind extracted for use in the following logic.
    const extracted = extractAccessToken(req);
    // Assert expected behavior in this test case.
    assert.ok(extracted);
    // Assert expected behavior in this test case.
    assert.equal(extracted.via, "cookie");
    // Assert expected behavior in this test case.
    assert.equal(extracted.token, "cookie-access-token");
  });

  // NBSP Bearer must not skip CSRF when a session cookie is present.
  it("rejects CSRF bypass via Bearer U+00A0 with session cookie", () => {
    // Bind nbsp for use in the following logic.
    const nbsp = "\u00A0";
    // Bind req for use in the following logic.
    const req = createMockReq({
      // Provide cookies field used by this structure.
      cookies: {
        // Support the surrounding logic for this step.
        [SESSION_COOKIE]: "access-token",
        // Support the surrounding logic for this step.
        [CSRF_COOKIE]: "token-a",
      },
      // Provide headers field used by this structure.
      headers: {
        // Provide authorization field used by this structure.
        authorization: `Bearer ${nbsp}`,
      },
    });
    // Bind res for use in the following logic.
    const res = createMockRes();
    // Bind nextCalled for use in the following logic.
    let nextCalled = 0;
    // Bind next for use in the following logic.
    const next: NextFunction = () => {
      // Support the surrounding logic for this step.
      nextCalled += 1;
    };

    // Invoke requireCsrf to perform this step.
    requireCsrf(req, res as unknown as Response, next);
    // Invoke assertCsrfRejected to perform this step.
    assertCsrfRejected(res, nextCalled);
  });

  // Empty Bearer token after the scheme also fails the usable-Bearer check.
  it("rejects CSRF bypass via empty Bearer with session cookie", () => {
    // Bind req for use in the following logic.
    const req = createMockReq({
      // Provide cookies field used by this structure.
      cookies: {
        // Support the surrounding logic for this step.
        [SESSION_COOKIE]: "access-token",
        // Support the surrounding logic for this step.
        [CSRF_COOKIE]: "token-a",
      },
      // Provide headers field used by this structure.
      headers: {
        // Provide authorization field used by this structure.
        authorization: "Bearer ",
      },
    });
    // Bind res for use in the following logic.
    const res = createMockRes();
    // Bind nextCalled for use in the following logic.
    let nextCalled = 0;
    // Bind next for use in the following logic.
    const next: NextFunction = () => {
      // Support the surrounding logic for this step.
      nextCalled += 1;
    };

    // Invoke requireCsrf to perform this step.
    requireCsrf(req, res as unknown as Response, next);
    // Invoke assertCsrfRejected to perform this step.
    assertCsrfRejected(res, nextCalled);
  });

  // Refresh cookie forces CSRF even when a usable Bearer is also sent.
  it("requires CSRF when refresh cookie present even with usable Bearer", () => {
    // Bind req for use in the following logic.
    const req = createMockReq({
      // Provide cookies field used by this structure.
      cookies: {
        // Support the surrounding logic for this step.
        [REFRESH_COOKIE]: "refresh-token",
        // Support the surrounding logic for this step.
        [CSRF_COOKIE]: "token-a",
      },
      // Provide headers field used by this structure.
      headers: {
        // Provide authorization field used by this structure.
        authorization: "Bearer some-access-token",
      },
    });
    // Bind res for use in the following logic.
    const res = createMockRes();
    // Bind nextCalled for use in the following logic.
    let nextCalled = 0;
    // Bind next for use in the following logic.
    const next: NextFunction = () => {
      // Support the surrounding logic for this step.
      nextCalled += 1;
    };

    // Invoke requireCsrf to perform this step.
    requireCsrf(req, res as unknown as Response, next);
    // Invoke assertCsrfRejected to perform this step.
    assertCsrfRejected(res, nextCalled);
  });

  // Matching CSRF allows the refresh-cookie path even with Bearer present.
  it("allows refresh cookie path when CSRF matches even with Bearer present", () => {
    // Bind req for use in the following logic.
    const req = createMockReq({
      // Provide cookies field used by this structure.
      cookies: {
        // Support the surrounding logic for this step.
        [REFRESH_COOKIE]: "refresh-token",
        // Support the surrounding logic for this step.
        [CSRF_COOKIE]: "token-a",
      },
      // Provide headers field used by this structure.
      headers: {
        // Provide authorization field used by this structure.
        authorization: "Bearer some-access-token",
        // Support the surrounding logic for this step.
        [CSRF_HEADER]: "token-a",
      },
    });
    // Bind res for use in the following logic.
    const res = createMockRes();
    // Bind nextCalled for use in the following logic.
    let nextCalled = 0;
    // Bind next for use in the following logic.
    const next: NextFunction = () => {
      // Support the surrounding logic for this step.
      nextCalled += 1;
    };

    // Invoke requireCsrf to perform this step.
    requireCsrf(req, res as unknown as Response, next);
    // Assert expected behavior in this test case.
    assert.equal(nextCalled, 1);
    // Assert expected behavior in this test case.
    assert.equal(res.statusCode, null);
  });
});
