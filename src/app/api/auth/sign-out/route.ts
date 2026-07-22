import { NextResponse } from "next/server";
import {
  isMockAuthenticationAllowed,
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

  const response = new NextResponse(null, {
    status: 303,
    headers: { location: "/" },
  });
  response.cookies.set({
    name: MOCK_SESSION_COOKIE,
    value: "",
    expires: new Date(0),
    ...MOCK_SESSION_COOKIE_OPTIONS,
    secure: new URL(request.url).protocol === "https:",
  });
  return response;
}
