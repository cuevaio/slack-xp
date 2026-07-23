import {
  type ClerkMiddlewareAuth,
  clerkMiddleware,
} from "@clerk/nextjs/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { readAppConfiguration } from "@/lib/config";
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

  return clerkAuthenticationProxy(request, event);
}

export const config = {
  matcher: ["/", "/office/:path*", "/api/office/:path*"],
};
