import { describe, expect, test } from "bun:test";
import {
  createMockSessionToken,
  isMockAuthenticationAllowed,
  isMockIdentityKey,
  MOCK_AUTH_IDENTITIES,
  readMockSessionToken,
} from "@/lib/auth/mock-session";
import { isOperatorUserId } from "@/lib/auth/operator";

describe("mock authentication", () => {
  test("issues stable New Hire and Operator identities", () => {
    const newHireToken = createMockSessionToken("new-hire");
    const operatorToken = createMockSessionToken("operator");

    expect(readMockSessionToken(newHireToken)).toEqual(
      MOCK_AUTH_IDENTITIES["new-hire"],
    );
    expect(readMockSessionToken(operatorToken)).toEqual(
      MOCK_AUTH_IDENTITIES.operator,
    );
    expect(MOCK_AUTH_IDENTITIES.operator.isOperator).toBe(true);
  });

  test("rejects forged identity and session values", () => {
    const validToken = createMockSessionToken("new-hire");
    const [payload] = validToken.split(".");

    expect(readMockSessionToken(`${payload}.forged-signature`)).toBeNull();
    expect(readMockSessionToken("user_attacker")).toBeNull();
    expect(readMockSessionToken(undefined)).toBeNull();
    expect(isMockIdentityKey("toString")).toBe(false);
  });

  test("is available only for ready, non-production mock configuration", () => {
    expect(
      isMockAuthenticationAllowed({
        status: "ready",
        environment: "test",
        serviceMode: "mock",
        values: {},
      }),
    ).toBe(true);
    expect(
      isMockAuthenticationAllowed({
        status: "ready",
        environment: "production",
        serviceMode: "mock",
        values: {},
      }),
    ).toBe(false);
  });
});

describe("Operator allowlist", () => {
  test("matches exact IDs from comma- or whitespace-separated configuration", () => {
    const allowlist = "user_first, user_operator\nuser_last";

    expect(isOperatorUserId("user_operator", allowlist)).toBe(true);
    expect(isOperatorUserId("user_oper", allowlist)).toBe(false);
    expect(isOperatorUserId("user_operator", undefined)).toBe(false);
  });
});
