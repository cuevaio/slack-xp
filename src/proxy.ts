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
import { officeFaultForRequest } from "@/lib/portal/request-time";
import { maintenanceUnavailableResponse } from "@/lib/safety/contract";
import { isMaintenanceActive, requestCorrelationId } from "@/lib/safety/server";

export async function enforceClerkOfficeAuthentication(
  auth: ClerkMiddlewareAuth,
  request: NextRequest,
  maintenanceActive = isMaintenanceActive(),
): Promise<Response | undefined> {
  if (isOfficeServerOperation(request.nextUrl.pathname)) {
    const session = await auth();
    if (!session.userId || !session.sessionId) {
      return NextResponse.json(
        { error: "authentication_required" },
        { status: 401 },
      );
    }
    if (maintenanceActive) {
      return maintenanceUnavailableResponse(
        requestCorrelationId(request.headers),
      );
    }
    return;
  }

  await auth.protect();
}

const clerkAuthenticationProxy = clerkMiddleware((auth, request) =>
  enforceClerkOfficeAuthentication(auth, request),
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

  const controlledFault = officeFaultForRequest(request.headers, configuration);
  if (
    !isOfficeServerOperation(request.nextUrl.pathname) &&
    (controlledFault === "installation" || controlledFault === "authentication")
  ) {
    return NextResponse.next();
  }

  const identity = readMockSessionToken(
    request.cookies.get(MOCK_SESSION_COOKIE)?.value,
  );
  if (identity) {
    if (
      isOfficeServerOperation(request.nextUrl.pathname) &&
      (controlledFault === "maintenance" || isMaintenanceActive())
    ) {
      return maintenanceUnavailableResponse(
        requestCorrelationId(request.headers),
      );
    }
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
