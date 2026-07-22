const CLERK_USER_ID_PATTERN = /^user_[A-Za-z0-9_-]{1,250}$/u;

export function configuredOperatorUserIds(
  configuredUserIds: string | undefined = process.env.OPERATOR_CLERK_USER_IDS,
): string[] {
  const userIds = configuredUserIds?.split(/[\s,]+/).filter(Boolean) ?? [];
  if (
    userIds.length === 0 ||
    userIds.some((userId) => !CLERK_USER_ID_PATTERN.test(userId))
  ) {
    return [];
  }
  return [...new Set(userIds)];
}

export function isOperatorUserId(
  clerkUserId: string,
  configuredUserIds: string | undefined = process.env.OPERATOR_CLERK_USER_IDS,
): boolean {
  return configuredOperatorUserIds(configuredUserIds).includes(clerkUserId);
}
