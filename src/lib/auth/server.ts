import { auth, currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  MOCK_SESSION_COOKIE,
  readMockSessionToken,
} from "@/lib/auth/mock-session";
import { isOperatorUserId } from "@/lib/auth/operator";
import type { AuthenticatedNewHire } from "@/lib/auth/types";
import type { ReadyAppConfiguration } from "@/lib/config";
import { readAuthoritativeProfile } from "@/lib/onboarding/profile-authority";

function clerkDisplayName(user: {
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
}): string {
  if (user.fullName) {
    return user.fullName;
  }

  const nameFromParts = [user.firstName, user.lastName]
    .filter(Boolean)
    .join(" ");
  return nameFromParts || "New Hire";
}

export async function authenticateOfficeRequest(
  configuration: ReadyAppConfiguration,
): Promise<AuthenticatedNewHire | null> {
  if (configuration.serviceMode === "mock") {
    const cookieStore = await cookies();
    const identity = readMockSessionToken(
      cookieStore.get(MOCK_SESSION_COOKIE)?.value,
    );
    if (!identity) return null;
    const profile = readAuthoritativeProfile(configuration, identity);
    return {
      ...identity,
      firstName: profile.firstName,
      lastName: profile.lastName,
      fullName: profile.displayName,
      imageUrl: profile.imageUrl,
      sourceVersion: profile.sourceVersion,
      isOperator: isOperatorUserId(identity.id),
    };
  }

  const session = await auth();
  if (!session.userId || !session.sessionId) {
    return null;
  }

  const user = await currentUser();
  if (!user || user.id !== session.userId) {
    return null;
  }

  return {
    id: user.id,
    sessionId: session.sessionId,
    firstName: user.firstName ?? clerkDisplayName(user),
    lastName: user.lastName ?? "",
    fullName: clerkDisplayName(user),
    imageUrl: user.imageUrl || null,
    sourceVersion: user.updatedAt,
    isOperator: isOperatorUserId(user.id),
    authentication: "clerk",
  };
}

export async function requireOfficeIdentity(
  configuration: ReadyAppConfiguration,
): Promise<AuthenticatedNewHire> {
  const identity = await authenticateOfficeRequest(configuration);
  if (identity) {
    return identity;
  }

  if (configuration.serviceMode === "mock") {
    redirect("/sign-in?redirect_url=%2Foffice");
  }

  const session = await auth();
  return session.redirectToSignIn({ returnBackUrl: "/office" });
}
