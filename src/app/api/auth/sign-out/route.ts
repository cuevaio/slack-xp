import { NextResponse } from "next/server";
import { MOCK_SESSION_COOKIE } from "@/lib/auth/mock-session";
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

  const response = new NextResponse(null, {
    status: 303,
    headers: { location: "/" },
  });
  response.cookies.set({
    name: MOCK_SESSION_COOKIE,
    value: "",
    expires: new Date(0),
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    path: "/",
  });
  return response;
}
