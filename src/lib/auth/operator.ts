export function isOperatorUserId(
  clerkUserId: string,
  configuredUserIds: string | undefined = process.env.OPERATOR_CLERK_USER_IDS,
): boolean {
  if (!configuredUserIds) {
    return false;
  }

  return configuredUserIds
    .split(/[\s,]+/)
    .filter(Boolean)
    .includes(clerkUserId);
}
