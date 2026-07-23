import { auth, currentUser } from "@clerk/nextjs/server";
import { isOperatorUserId } from "@/lib/auth/operator";
import type { AuthenticatedNewHire } from "@/lib/auth/types";
import type { ReadyAppConfiguration } from "@/lib/config";

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
  _configuration: ReadyAppConfiguration,
): Promise<AuthenticatedNewHire | null> {
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
  };
}

export async function requireOfficeIdentity(
  configuration: ReadyAppConfiguration,
): Promise<AuthenticatedNewHire> {
  const identity = await authenticateOfficeRequest(configuration);
  if (identity) {
    return identity;
  }

  const session = await auth();
  return session.redirectToSignIn({ returnBackUrl: "/" });
}
