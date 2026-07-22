import type { ServiceAdapters } from "@/lib/adapters/types";
import { createInMemoryNeonRepository } from "@/lib/onboarding/memory";
import type { NewHireProfile } from "@/lib/onboarding/types";
import { generalChannelId } from "@/lib/portal/chat";
import {
  createMockPortalAdapter,
  type MockPortalAdapter,
} from "@/lib/portal/mock";

const MOCK_REPOSITORY_KEY = Symbol.for(
  "portal-messenger.mock-onboarding-repository",
);
const MOCK_PORTAL_KEY = Symbol.for("portal-messenger.mock-portal-adapter");

type MockGlobal = typeof globalThis & {
  [MOCK_REPOSITORY_KEY]?: ReturnType<typeof createInMemoryNeonRepository>;
  [MOCK_PORTAL_KEY]?: MockPortalAdapter;
};

function getMockRepository() {
  const mockGlobal = globalThis as MockGlobal;
  mockGlobal[MOCK_REPOSITORY_KEY] ??= createInMemoryNeonRepository();
  return mockGlobal[MOCK_REPOSITORY_KEY];
}

export function getMockPortalAdapter(): MockPortalAdapter {
  const mockGlobal = globalThis as MockGlobal;
  mockGlobal[MOCK_PORTAL_KEY] ??= createMockPortalAdapter();
  return mockGlobal[MOCK_PORTAL_KEY];
}

export function resetMockOnboarding(): void {
  getMockRepository().reset();
  getMockPortalAdapter().reset();
}

export async function seedCompletedMockOnboarding(
  profile: NewHireProfile,
): Promise<void> {
  const repository = getMockRepository();
  await repository.enterNewHire(profile);
  await repository.confirmProfile(profile);
  await repository.acceptConduct(profile.clerkUserId);
  await repository.clockIn(profile.clerkUserId);
}

export function createMockAdapters(): ServiceAdapters {
  const neon = getMockRepository();
  const portal = getMockPortalAdapter();
  return {
    kind: "mock",
    portal: {
      ...portal,
      async listChannels() {
        return [{ id: generalChannelId(), name: "General", unreadCount: 0 }];
      },
    },
    neon,
  };
}
