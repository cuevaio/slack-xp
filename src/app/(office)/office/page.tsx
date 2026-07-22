import { connection } from "next/server";
import { InstallationIncomplete } from "@/components/installation-incomplete";
import { OfficeFoundation } from "@/components/office-foundation";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { createServiceAdapters } from "@/lib/adapters";
import { requireOfficeIdentity } from "@/lib/auth/server";
import { readAppConfiguration } from "@/lib/config";
import { profileFromIdentity } from "@/lib/onboarding/profile-authority";

export const runtime = "nodejs";

export default async function OfficePage() {
  await connection();
  const configuration = readAppConfiguration();

  if (configuration.status === "incomplete") {
    return <InstallationIncomplete configuration={configuration} />;
  }

  const identity = await requireOfficeIdentity(configuration);
  const adapters = createServiceAdapters(configuration);
  const onboarding = await adapters.neon.enterNewHire(
    profileFromIdentity(identity),
  );

  if (onboarding.step !== "complete") {
    return (
      <OnboardingWizard
        initialOnboarding={onboarding}
        isMock={adapters.kind === "mock"}
      />
    );
  }

  return (
    <OfficeFoundation
      adapters={adapters}
      identity={identity}
      onboarding={onboarding}
    />
  );
}
