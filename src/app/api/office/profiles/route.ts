import { createServiceAdapters } from "@/lib/adapters";
import { authenticateOfficeRequest } from "@/lib/auth/server";
import { readAppConfiguration } from "@/lib/config";
import { ProfileBatchError } from "@/lib/profiles/domain";
import { readProfileBatch } from "@/lib/profiles/service";

export const runtime = "nodejs";

export async function handleProfileBatchRequest(
  request: Request,
  repository: Parameters<typeof readProfileBatch>[0],
): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "invalid_profile_batch" }, { status: 400 });
  }

  try {
    const clerkUserIds =
      payload && typeof payload === "object" && "clerkUserIds" in payload
        ? payload.clerkUserIds
        : undefined;
    const profiles = await readProfileBatch(repository, clerkUserIds);
    return Response.json({ profiles });
  } catch (error) {
    if (error instanceof ProfileBatchError) {
      return Response.json(
        { error: "invalid_profile_batch", message: error.message },
        { status: 400 },
      );
    }
    throw error;
  }
}

export async function POST(request: Request) {
  const configuration = readAppConfiguration();
  if (configuration.status === "incomplete") {
    return Response.json({ error: "installation_incomplete" }, { status: 503 });
  }

  const identity = await authenticateOfficeRequest(configuration);
  if (!identity) {
    return Response.json({ error: "authentication_required" }, { status: 401 });
  }

  return handleProfileBatchRequest(
    request,
    createServiceAdapters(configuration).neon,
  );
}
