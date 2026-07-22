import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuthenticatedNewHire } from "@/lib/auth/types";

export const MOCK_SESSION_COOKIE = "portal_mock_session";

export const MOCK_AUTH_IDENTITIES = {
  "new-hire": {
    id: "user_mock_new_hire",
    sessionId: "session_mock_new_hire",
    fullName: "Pat Pending",
    imageUrl: null,
    isOperator: false,
    authentication: "mock",
  },
  operator: {
    id: "user_mock_operator",
    sessionId: "session_mock_operator",
    fullName: "Opal Erator",
    imageUrl: null,
    isOperator: true,
    authentication: "mock",
  },
} as const satisfies Record<string, AuthenticatedNewHire>;

export type MockIdentityKey = keyof typeof MOCK_AUTH_IDENTITIES;

// Mock sessions are deliberately isolated from Clerk and accepted only in
// non-production mock mode. The signature prevents request headers or raw user
// IDs from becoming an identity boundary during local and browser tests.
const MOCK_SESSION_SIGNING_KEY =
  "portal-messenger-credential-free-mock-session-v1";

function sign(payload: string): string {
  return createHmac("sha256", MOCK_SESSION_SIGNING_KEY)
    .update(payload)
    .digest("base64url");
}

export function createMockSessionToken(identity: MockIdentityKey): string {
  return `${identity}.${sign(identity)}`;
}

export function readMockSessionToken(
  token: string | undefined,
): AuthenticatedNewHire | null {
  if (!token) {
    return null;
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }

  const [identity, suppliedSignature] = parts;
  if (!(identity in MOCK_AUTH_IDENTITIES)) {
    return null;
  }

  const expectedSignature = sign(identity);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    return null;
  }

  return MOCK_AUTH_IDENTITIES[identity as MockIdentityKey];
}
