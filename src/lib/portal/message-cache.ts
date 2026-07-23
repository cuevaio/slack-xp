const QUERY_NAMESPACE = "portal-channel-messages";

export function channelMessageQueryKey(channelId: string) {
  return [QUERY_NAMESPACE, channelId] as const;
}
