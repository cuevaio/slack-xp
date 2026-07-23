import {
  maintenanceUnavailableResponse,
  safetyResponseHeaders,
} from "@/lib/safety/contract";
import { isMaintenanceActive, requestCorrelationId } from "@/lib/safety/server";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const correlationId = requestCorrelationId(request.headers);
  if (isMaintenanceActive()) {
    return maintenanceUnavailableResponse(correlationId);
  }
  return Response.json(
    { status: "available", correlationId },
    { headers: safetyResponseHeaders(correlationId) },
  );
}
