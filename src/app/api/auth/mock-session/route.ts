import { NextResponse } from "next/server";
import {
  createMockSessionToken,
  isMockAuthenticationAllowed,
  isMockIdentityKey,
  MOCK_SESSION_COOKIE,
  MOCK_SESSION_COOKIE_OPTIONS,
} from "@/lib/auth/mock-session";
import { readAppConfiguration } from "@/lib/config";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const configuration = readAppConfiguration();
  if (!isMockAuthenticationAllowed(configuration)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const formData = await request.formData();
  const requestedIdentity = formData.get("identity");
  if (!isMockIdentityKey(requestedIdentity)) {
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
    value: createMockSessionToken(requestedIdentity),
    ...MOCK_SESSION_COOKIE_OPTIONS,
    secure: new URL(request.url).protocol === "https:",
  });
  return response;
}
