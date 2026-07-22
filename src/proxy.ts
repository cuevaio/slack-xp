import {
  type ClerkMiddlewareAuth,
  clerkMiddleware,
} from "@clerk/nextjs/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  MOCK_SESSION_COOKIE,
  readMockSessionToken,
} from "@/lib/auth/mock-session";
import { readAppConfiguration } from "@/lib/config";

export async function enforceClerkOfficeAuthentication(
  auth: ClerkMiddlewareAuth,
  request: NextRequest,
): Promise<NextResponse | undefined> {
  if (isOfficeServerOperation(request.nextUrl.pathname)) {
    const session = await auth();
    if (!session.userId || !session.sessionId) {
      return NextResponse.json(
        { error: "authentication_required" },
        { status: 401 },
      );
    }
    return;
  }

  await auth.protect();
}

const clerkAuthenticationProxy = clerkMiddleware(
  enforceClerkOfficeAuthentication,
);

function isOfficeServerOperation(pathname: string): boolean {
  return pathname === "/api/office" || pathname.startsWith("/api/office/");
}

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const configuration = readAppConfiguration();

  // Incomplete installations render their closed setup screen. Nothing past
  // the office page constructs service adapters in this state.
  if (configuration.status === "incomplete") {
    return NextResponse.next();
  }

  if (configuration.serviceMode === "live") {
    return clerkAuthenticationProxy(request, event);
  }

  const identity = readMockSessionToken(
    request.cookies.get(MOCK_SESSION_COOKIE)?.value,
  );
  if (identity) {
    return NextResponse.next();
  }

  if (isOfficeServerOperation(request.nextUrl.pathname)) {
    return NextResponse.json(
      { error: "authentication_required" },
      { status: 401 },
    );
  }

  const signInUrl = new URL("/sign-in", request.url);
  signInUrl.searchParams.set(
    "redirect_url",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: ["/office/:path*", "/api/office/:path*"],
};
