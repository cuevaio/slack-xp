import { NextResponse } from "next/server";
import {
  createMockSessionToken,
  MOCK_AUTH_IDENTITIES,
  MOCK_SESSION_COOKIE,
  type MockIdentityKey,
} from "@/lib/auth/mock-session";
import { readAppConfiguration } from "@/lib/config";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const configuration = readAppConfiguration();
  if (
    configuration.status !== "ready" ||
    configuration.serviceMode !== "mock" ||
    configuration.environment === "production"
  ) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const formData = await request.formData();
  const requestedIdentity = formData.get("identity");
  if (
    typeof requestedIdentity !== "string" ||
    !(requestedIdentity in MOCK_AUTH_IDENTITIES)
  ) {
    return Response.json({ error: "invalid_mock_identity" }, { status: 400 });
  }

  // Keep the Location relative so local hosts such as 127.0.0.1 are not
  // normalized to localhost and separated from the host-only session cookie.
  const response = new NextResponse(null, {
    status: 303,
    headers: { location: "/office" },
  });
  response.cookies.set({
    name: MOCK_SESSION_COOKIE,
    value: createMockSessionToken(requestedIdentity as MockIdentityKey),
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    path: "/",
  });
  return response;
}
