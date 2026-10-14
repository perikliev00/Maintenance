import assert from "node:assert/strict";
import type { NextFunction, Request, Response } from "express";
import { describe, it } from "node:test";
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  REFRESH_COOKIE,
  SESSION_COOKIE,
  extractAccessToken,
  readBearerAccessToken,
  requireCsrf,
} from "./session";

type MockRes = {
  statusCode: number | null;
  body: unknown;
  status: (code: number) => MockRes;
  json: (payload: unknown) => MockRes;
};

function createMockRes(): MockRes {
  const res: MockRes = {
    statusCode: null,
    body: null,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

function createMockReq(input: {
  method?: string;
  cookies?: Record<string, string>;
  headers?: Record<string, string | string[] | undefined>;
}): Request {
  return {
    method: input.method ?? "POST",
    cookies: input.cookies ?? {},
    headers: input.headers ?? {},
  } as unknown as Request;
}

function assertCsrfRejected(res: MockRes, nextCalled: number) {
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, {
    error: "csrf",
    message: "Invalid CSRF token",
  });
  assert.equal(nextCalled, 0);
}

describe("requireCsrf", () => {
  // AUTH-T-P007-01: missing or wrong CSRF rejected for cookie auth
  it("rejects missing CSRF header when session cookie present", () => {
    const req = createMockReq({
      cookies: {
        [SESSION_COOKIE]: "access-token",
        [CSRF_COOKIE]: "token-a",
      },
    });
    const res = createMockRes();
    let nextCalled = 0;
    const next: NextFunction = () => {
      nextCalled += 1;
    };

    requireCsrf(req, res as unknown as Response, next);
    assertCsrfRejected(res, nextCalled);
  });

  it("rejects wrong CSRF header when session cookie present", () => {
    const req = createMockReq({
      cookies: {
        [SESSION_COOKIE]: "access-token",
        [CSRF_COOKIE]: "token-a",
      },
      headers: {
        [CSRF_HEADER]: "token-b",
      },
    });
    const res = createMockRes();
    let nextCalled = 0;
    const next: NextFunction = () => {
      nextCalled += 1;
    };

    requireCsrf(req, res as unknown as Response, next);
    assertCsrfRejected(res, nextCalled);
  });

  it("rejects missing CSRF when only refresh cookie present", () => {
    const req = createMockReq({
      cookies: {
        [REFRESH_COOKIE]: "refresh-token",
        [CSRF_COOKIE]: "token-a",
      },
    });
    const res = createMockRes();
    let nextCalled = 0;
    const next: NextFunction = () => {
      nextCalled += 1;
    };

    requireCsrf(req, res as unknown as Response, next);
    assertCsrfRejected(res, nextCalled);
  });

  // AUTH-T-P007-02: matching CSRF allowed; usable Bearer without refresh cookie skips
  it("allows request when CSRF cookie matches header", () => {
    const req = createMockReq({
      cookies: {
        [SESSION_COOKIE]: "access-token",
        [CSRF_COOKIE]: "token-a",
      },
      headers: {
        [CSRF_HEADER]: "token-a",
      },
    });
    const res = createMockRes();
    let nextCalled = 0;
    const next: NextFunction = () => {
      nextCalled += 1;
    };

    requireCsrf(req, res as unknown as Response, next);

    assert.equal(nextCalled, 1);
    assert.equal(res.statusCode, null);
    assert.equal(res.body, null);
  });

  it("skips CSRF for usable Bearer with session cookie but no refresh cookie", () => {
    const req = createMockReq({
      cookies: {
        [SESSION_COOKIE]: "access-token",
        [CSRF_COOKIE]: "token-a",
      },
      headers: {
        authorization: "Bearer some-access-token",
      },
    });
    const res = createMockRes();
    let nextCalled = 0;
    const next: NextFunction = () => {
      nextCalled += 1;
    };

    requireCsrf(req, res as unknown as Response, next);

    assert.equal(nextCalled, 1);
    assert.equal(res.statusCode, null);
    assert.equal(res.body, null);
  });

  it("does not treat whitespace-only Bearer (U+00A0) as usable auth", () => {
    const nbsp = "\u00A0";
    const req = createMockReq({
      cookies: {
        [SESSION_COOKIE]: "cookie-access-token",
        [CSRF_COOKIE]: "token-a",
      },
      headers: {
        authorization: `Bearer ${nbsp}`,
      },
    });

    assert.equal(readBearerAccessToken(req), null);
    const extracted = extractAccessToken(req);
    assert.ok(extracted);
    assert.equal(extracted.via, "cookie");
    assert.equal(extracted.token, "cookie-access-token");
  });

  it("rejects CSRF bypass via Bearer U+00A0 with session cookie", () => {
    const nbsp = "\u00A0";
    const req = createMockReq({
      cookies: {
        [SESSION_COOKIE]: "access-token",
        [CSRF_COOKIE]: "token-a",
      },
      headers: {
        authorization: `Bearer ${nbsp}`,
      },
    });
    const res = createMockRes();
    let nextCalled = 0;
    const next: NextFunction = () => {
      nextCalled += 1;
    };

    requireCsrf(req, res as unknown as Response, next);
    assertCsrfRejected(res, nextCalled);
  });

  it("rejects CSRF bypass via empty Bearer with session cookie", () => {
    const req = createMockReq({
      cookies: {
        [SESSION_COOKIE]: "access-token",
        [CSRF_COOKIE]: "token-a",
      },
      headers: {
        authorization: "Bearer ",
      },
    });
    const res = createMockRes();
    let nextCalled = 0;
    const next: NextFunction = () => {
      nextCalled += 1;
    };

    requireCsrf(req, res as unknown as Response, next);
    assertCsrfRejected(res, nextCalled);
  });

  it("requires CSRF when refresh cookie present even with usable Bearer", () => {
    const req = createMockReq({
      cookies: {
        [REFRESH_COOKIE]: "refresh-token",
        [CSRF_COOKIE]: "token-a",
      },
      headers: {
        authorization: "Bearer some-access-token",
      },
    });
    const res = createMockRes();
    let nextCalled = 0;
    const next: NextFunction = () => {
      nextCalled += 1;
    };

    requireCsrf(req, res as unknown as Response, next);
    assertCsrfRejected(res, nextCalled);
  });

  it("allows refresh cookie path when CSRF matches even with Bearer present", () => {
    const req = createMockReq({
      cookies: {
        [REFRESH_COOKIE]: "refresh-token",
        [CSRF_COOKIE]: "token-a",
      },
      headers: {
        authorization: "Bearer some-access-token",
        [CSRF_HEADER]: "token-a",
      },
    });
    const res = createMockRes();
    let nextCalled = 0;
    const next: NextFunction = () => {
      nextCalled += 1;
    };

    requireCsrf(req, res as unknown as Response, next);
    assert.equal(nextCalled, 1);
    assert.equal(res.statusCode, null);
  });
});
