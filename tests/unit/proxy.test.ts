import { describe, expect, test } from "bun:test";
import type { ClerkMiddlewareAuth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import { enforceClerkOfficeAuthentication } from "@/proxy";

function signedOutAuth() {
  let protectCalled = false;
  const auth = Object.assign(async () => ({ userId: null, sessionId: null }), {
    protect: async () => {
      protectCalled = true;
    },
  }) as unknown as ClerkMiddlewareAuth;
  return { auth, wasProtectCalled: () => protectCalled };
}

function signedInAuth() {
  return Object.assign(
    async () => ({ userId: "user_new_hire", sessionId: "session_1" }),
    { protect: async () => {} },
  ) as unknown as ClerkMiddlewareAuth;
}

describe("office authentication proxy", () => {
  test("returns 401 instead of redirecting signed-out API fetches", async () => {
    const { auth, wasProtectCalled } = signedOutAuth();
    const response = await enforceClerkOfficeAuthentication(
      auth,
      new NextRequest("http://localhost/api/office/session"),
    );

    expect(response?.status).toBe(401);
    expect(await response?.json()).toEqual({
      error: "authentication_required",
    });
    expect(wasProtectCalled()).toBe(false);
  });

  test("keeps sign-in redirects for signed-out office documents", async () => {
    const { auth, wasProtectCalled } = signedOutAuth();
    const response = await enforceClerkOfficeAuthentication(
      auth,
      new NextRequest("http://localhost/office"),
    );

    expect(response).toBeUndefined();
    expect(wasProtectCalled()).toBe(true);
  });

  test("blocks authenticated server operations when maintenance is active", async () => {
    const response = await enforceClerkOfficeAuthentication(
      signedInAuth(),
      new NextRequest("http://localhost/api/office/portal/token", {
        headers: { "x-request-id": "maintenance-test" },
      }),
      true,
    );

    expect(response?.status).toBe(503);
    expect(await response?.json()).toEqual({
      error: "maintenance_active",
      authority: "application",
      correlationId: "maintenance-test",
    });
  });
});
