export function configuredOperatorUserIds(
  configuredUserIds: string | undefined = process.env.OPERATOR_CLERK_USER_IDS,
): string[] {
  return [...new Set(configuredUserIds?.split(/[\s,]+/).filter(Boolean) ?? [])];
}

export function isOperatorUserId(
  clerkUserId: string,
  configuredUserIds: string | undefined = process.env.OPERATOR_CLERK_USER_IDS,
): boolean {
  return configuredOperatorUserIds(configuredUserIds).includes(clerkUserId);
}
