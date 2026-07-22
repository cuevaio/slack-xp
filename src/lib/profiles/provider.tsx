"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { profileBatchQueryKey } from "@/lib/profiles/client";
import type { ProfileAttribution } from "@/lib/profiles/types";

export function ProfileQueryProvider({
  initialProfile,
  children,
}: {
  initialProfile: ProfileAttribution;
  children: ReactNode;
}) {
  const [queryClient] = useState(() => {
    const client = new QueryClient();
    client.setQueryData(profileBatchQueryKey([initialProfile.clerkUserId]), [
      initialProfile,
    ]);
    return client;
  });

  useEffect(() => {
    queryClient.setQueryData(
      profileBatchQueryKey([initialProfile.clerkUserId]),
      [initialProfile],
    );
  }, [initialProfile, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
