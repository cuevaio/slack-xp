import { createServiceAdapters } from "@/lib/adapters";
import { authenticateOfficeRequest } from "@/lib/auth/server";
import { readAppConfiguration } from "@/lib/config";
import { ProfileBatchError } from "@/lib/profiles/domain";
import { readProfileBatch } from "@/lib/profiles/service";
import type { ProfileRepository } from "@/lib/profiles/types";

export const runtime = "nodejs";

export async function handleProfileBatchRequest(
  request: Request,
  repository: ProfileRepository,
): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "invalid_profile_batch" }, { status: 400 });
  }

  try {
    let clerkUserIds: unknown;
    if (payload && typeof payload === "object" && "clerkUserIds" in payload) {
      clerkUserIds = payload.clerkUserIds;
    }

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
