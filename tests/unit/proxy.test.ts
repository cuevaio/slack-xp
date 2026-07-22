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
});
