import { createServiceAdapters } from "@/lib/adapters";
import { authenticateOfficeRequest } from "@/lib/auth/server";
import { readAppConfiguration } from "@/lib/config";
import { repairProfileProjection } from "@/lib/profiles/service";

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

  const adapters = createServiceAdapters(configuration);
  await repairProfileProjection(adapters.neon, identity, adapters.portal);
  const employmentAccess = await adapters.neon.getEmploymentAccess(
    identity.id,
    new Date(),
  );
  if (!employmentAccess.eligible) {
    return Response.json({ error: "new_hire_ineligible" }, { status: 403 });
  }

  return Response.json({
    id: identity.id,
    fullName: identity.fullName,
    imageUrl: identity.imageUrl,
    isOperator: identity.isOperator,
    authentication: "clerk",
  });
}
