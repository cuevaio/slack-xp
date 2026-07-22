import { authenticateOfficeRequest } from "@/lib/auth/server";
import { readAppConfiguration } from "@/lib/config";

export const runtime = "nodejs";

export async function GET() {
  const configuration = readAppConfiguration();
  if (configuration.status === "incomplete") {
    return Response.json({ error: "installation_incomplete" }, { status: 503 });
  }

  const identity = await authenticateOfficeRequest(configuration);
  if (!identity) {
    return Response.json({ error: "authentication_required" }, { status: 401 });
  }

  return Response.json({
    id: identity.id,
    fullName: identity.fullName,
    imageUrl: identity.imageUrl,
    isOperator: identity.isOperator,
    authentication: identity.authentication,
  });
}
