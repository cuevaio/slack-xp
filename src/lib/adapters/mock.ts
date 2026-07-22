import type { ServiceAdapters } from "@/lib/adapters/types";
import { createInMemoryOnboardingRepository } from "@/lib/onboarding/memory";

const MOCK_CHANNELS = [
  { id: "mock-day:general", name: "General", unreadCount: 0 },
  { id: "mock-day:watercooler", name: "Watercooler", unreadCount: 3 },
  { id: "mock-day:tech-support", name: "Technical Support", unreadCount: 1 },
] as const;

const mockRepositoryKey = Symbol.for(
  "portal-messenger.mock-onboarding-repository",
);

type MockGlobal = typeof globalThis & {
  [mockRepositoryKey]?: ReturnType<typeof createInMemoryOnboardingRepository>;
};

function getMockRepository() {
  const mockGlobal = globalThis as MockGlobal;
  mockGlobal[mockRepositoryKey] ??= createInMemoryOnboardingRepository();
  return mockGlobal[mockRepositoryKey];
}

export function resetMockOnboarding(): void {
  getMockRepository().reset();
}

export async function seedCompletedMockOnboarding(profile: {
  clerkUserId: string;
  firstName: string;
  lastName: string;
  displayName: string;
  imageUrl: string | null;
  sourceVersion: number;
}): Promise<void> {
  const repository = getMockRepository();
  await repository.enterNewHire(profile);
  await repository.confirmProfile(profile);
  await repository.acceptConduct(profile.clerkUserId);
  await repository.clockIn(profile.clerkUserId);
}

export function createMockAdapters(): ServiceAdapters {
  const neon = getMockRepository();
  return {
    kind: "mock",
    portal: {
      async listChannels() {
        return MOCK_CHANNELS;
      },
    },
    neon,
  };
}
