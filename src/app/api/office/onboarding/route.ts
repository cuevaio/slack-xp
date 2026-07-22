import { createServiceAdapters } from "@/lib/adapters";
import { authenticateOfficeRequest } from "@/lib/auth/server";
import { readAppConfiguration } from "@/lib/config";
import {
  OnboardingError,
  type ProfileInput,
  validateProfileInput,
} from "@/lib/onboarding/domain";
import {
  profileFromIdentity,
  updateAuthoritativeProfile,
} from "@/lib/onboarding/profile-authority";
import {
  acceptNewHireConduct,
  confirmNewHireProfile,
} from "@/lib/onboarding/service";

export const runtime = "nodejs";

function readValidatedProfileInput(formData: FormData): ProfileInput {
  const imageEntry = formData.get("image");
  const image =
    imageEntry instanceof File && imageEntry.size > 0 ? imageEntry : null;

  const names = validateProfileInput({
    firstName: String(formData.get("firstName") ?? ""),
    lastName: String(formData.get("lastName") ?? ""),
    image,
  });

  return { ...names, image };
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

  const adapters = createServiceAdapters(configuration);
  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    // Ensure direct or retried requests have the same stable onboarding row.
    await adapters.neon.enterNewHire(profileFromIdentity(identity));

    switch (intent) {
      case "confirm-profile": {
        const profileInput = readValidatedProfileInput(formData);
        return Response.json(
          await confirmNewHireProfile(adapters.neon, () =>
            updateAuthoritativeProfile(configuration, identity, profileInput),
          ),
        );
      }
      case "accept-conduct":
        return Response.json(
          await acceptNewHireConduct(
            adapters.neon,
            identity.id,
            formData.get("accepted") === "yes",
          ),
        );
      case "clock-in":
        return Response.json(await adapters.neon.clockIn(identity.id));
      default:
        return Response.json({ error: "invalid_intent" }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof OnboardingError) {
      return Response.json(
        { error: error.code, message: error.message },
        { status: 422 },
      );
    }
    throw error;
  }
}
