import { auth, currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  MOCK_SESSION_COOKIE,
  readMockSessionToken,
} from "@/lib/auth/mock-session";
import { isOperatorUserId } from "@/lib/auth/operator";
import type { AuthenticatedNewHire } from "@/lib/auth/types";
import type { AppConfiguration } from "@/lib/config";

type ReadyConfiguration = Extract<AppConfiguration, { status: "ready" }>;

function clerkDisplayName(user: {
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
}): string {
  return (
    user.fullName ||
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    "New Hire"
  );
}

export async function authenticateOfficeRequest(
  configuration: ReadyConfiguration,
): Promise<AuthenticatedNewHire | null> {
  if (configuration.serviceMode === "mock") {
    const cookieStore = await cookies();
    return readMockSessionToken(cookieStore.get(MOCK_SESSION_COOKIE)?.value);
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
    fullName: clerkDisplayName(user),
    imageUrl: user.imageUrl || null,
    isOperator: isOperatorUserId(user.id),
    authentication: "clerk",
  };
}

export async function requireOfficeIdentity(
  configuration: ReadyConfiguration,
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
