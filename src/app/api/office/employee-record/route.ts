import { createServiceAdapters } from "@/lib/adapters";
import { authenticateOfficeRequest } from "@/lib/auth/server";
import { readAppConfiguration } from "@/lib/config";
import {
  type EmployeeRecordDependencies,
  handleEmployeeRecordConvergence,
  handleEmployeeRecordUpdate,
} from "@/lib/profiles/employee-record-api";

export const runtime = "nodejs";

async function authenticatedDependencies(): Promise<
  EmployeeRecordDependencies | Response
> {
  const configuration = readAppConfiguration();
  if (configuration.status === "incomplete") {
    return Response.json({ error: "installation_incomplete" }, { status: 503 });
  }
  const identity = await authenticateOfficeRequest(configuration);
  if (!identity) {
    return Response.json({ error: "authentication_required" }, { status: 401 });
  }
  const adapters = createServiceAdapters(configuration);
  return {
    configuration,
    identity,
    repository: adapters.neon,
    publisher: adapters.portal,
  };
}

export async function GET() {
  const dependencies = await authenticatedDependencies();
  return dependencies instanceof Response
    ? dependencies
    : handleEmployeeRecordConvergence(dependencies);
}

export async function POST(request: Request) {
  const dependencies = await authenticatedDependencies();
  return dependencies instanceof Response
    ? dependencies
    : handleEmployeeRecordUpdate(await request.formData(), dependencies);
}
