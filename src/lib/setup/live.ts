import { randomUUID } from "node:crypto";
import { createClerkClient } from "@clerk/nextjs/server";
import { neon } from "@neondatabase/serverless";
import { type ChannelHandle, Portal, type PortalError } from "@portalsdk/core";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { EnvironmentSource } from "@/lib/config";
import { generalChannelId } from "@/lib/portal/chat";
import { createPortalControlPlane } from "@/lib/portal/server";
import type {
  PortalVerificationEvidence,
  SetupVerifier,
} from "@/lib/setup/verification";

const PORTAL_API_URL = "https://api.useportal.co";
const CONNECTION_TIMEOUT_MS = 15_000;

function requireEnvironmentValue(env: EnvironmentSource, name: string): string {
  const value = env[name];
  if (!value)
    throw new Error(`Required setup variable is unavailable: ${name}`);
  return value;
}

async function verifyNeon(
  databaseUrl: string,
  migrationsFolder: string,
): Promise<{ migrations: "current" | "drift" }> {
  const sql = neon(databaseUrl);
  await sql.query("select 1 as connected");
  const committed = readMigrationFiles({ migrationsFolder });

  let applied: Array<{ hash: string; created_at: string | number }>;
  try {
    applied = (await sql.query(
      "select hash, created_at from drizzle.__drizzle_migrations order by created_at asc",
    )) as Array<{ hash: string; created_at: string | number }>;
  } catch (error) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : null;
    if (code === "42P01" || code === "3F000") {
      return { migrations: "drift" };
    }
    throw error;
  }

  const appliedByTimestamp = new Map(
    applied.map((migration) => [Number(migration.created_at), migration.hash]),
  );
  const current =
    applied.length === committed.length &&
    committed.every(
      (migration) =>
        appliedByTimestamp.get(migration.folderMillis) === migration.hash,
    );
  return { migrations: current ? "current" : "drift" };
}

type ConnectionResult<M> = {
  status: "ready" | "blocked";
  errorCode: string | null;
  channel: ChannelHandle<M>;
};

async function connect<M>(
  portal: Portal,
  channelId: string,
): Promise<ConnectionResult<M>> {
  const channel = portal.channel<M>(channelId);
  return await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (status: "ready" | "blocked", error?: PortalError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      unsubscribe();
      resolve({ status, errorCode: error?.code ?? null, channel });
    };
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      channel.release();
      reject(new Error("Portal connection verification timed out."));
    }, CONNECTION_TIMEOUT_MS);
    const unsubscribe = channel.on("status", (status, error) => {
      if (status === "ready" || status === "blocked") finish(status, error);
    });
    channel.acquire();
    const initial = channel.getSnapshot().status;
    if (initial === "ready" || initial === "blocked") finish(initial);
  });
}

async function originAccepted(
  apiKey: string,
  origin: string,
): Promise<boolean> {
  const response = await fetch(`${PORTAL_API_URL}/v1/tokens/anonymous`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "x-portal-key": apiKey,
    },
    body: "{}",
  });
  return response.ok;
}

async function verifyPortal(
  apiKey: string,
  secret: string,
  appOrigin: string,
): Promise<PortalVerificationEvidence> {
  const channelId = generalChannelId(new Date());
  const userId = "portal-messenger-setup-verifier";
  const authority = createPortalControlPlane({ secret });
  const membershipInput = {
    channelId,
    userId,
    claims: { username: "Setup Verifier", avatar: null },
  };
  await authority.ensureMembership(membershipInput);
  const token = await authority.mintToken(membershipInput);

  const [allowedOriginAccepted, unregisteredOriginAccepted] = await Promise.all(
    [
      originAccepted(apiKey, appOrigin),
      originAccepted(apiKey, "https://portal-verification.invalid"),
    ],
  );

  const anonymousConnection = await connect<{ text: string }>(
    new Portal({ apiKey }),
    channelId,
  );
  const anonymousRefused =
    anonymousConnection.status === "blocked" &&
    anonymousConnection.errorCode === "anonymous_not_allowed";
  anonymousConnection.channel.release();

  const authenticatedConnection = await connect<{ text: string }>(
    new Portal({ apiKey, token: token.token }),
    channelId,
  );
  if (authenticatedConnection.status !== "ready") {
    authenticatedConnection.channel.release();
    return {
      anonymousRefused,
      authenticated: false,
      published: false,
      membership: false,
      mode: null,
      allowedOriginAccepted,
      unregisteredOriginRefused: !unregisteredOriginAccepted,
      persistedAfterReconnect: false,
    };
  }

  const channel = authenticatedConnection.channel;
  const snapshot = channel.getSnapshot();
  const membership = (await channel.members()).some(
    (member) => member.userId === userId,
  );
  const marker = `setup-verification:${randomUUID()}`;
  const acknowledgement = await channel.send({ content: { text: marker } });
  channel.release();

  const reconnected = await connect<{ text: string }>(
    new Portal({ apiKey, token: token.token }),
    channelId,
  );
  const persistedAfterReconnect =
    reconnected.status === "ready" &&
    reconnected.channel.messages.some(
      (message) => message.id === acknowledgement.id,
    );
  reconnected.channel.release();

  return {
    anonymousRefused,
    authenticated: snapshot.me?.anon === false,
    published: Boolean(acknowledgement.id),
    membership,
    mode: snapshot.info?.mode ?? null,
    allowedOriginAccepted,
    unregisteredOriginRefused: !unregisteredOriginAccepted,
    persistedAfterReconnect,
  };
}

export function createLiveSetupVerifier(
  env: EnvironmentSource,
  projectRoot = process.cwd(),
): SetupVerifier {
  return {
    verifyNeon: () =>
      verifyNeon(
        requireEnvironmentValue(env, "DATABASE_URL"),
        `${projectRoot}/drizzle`,
      ),
    async verifyClerk() {
      const client = createClerkClient({
        secretKey: requireEnvironmentValue(env, "CLERK_SECRET_KEY"),
        publishableKey: requireEnvironmentValue(
          env,
          "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
        ),
      });
      const instance = await client.instance.get();
      if (
        instance.environmentType !== "development" &&
        instance.environmentType !== "production"
      ) {
        throw new Error("Clerk returned an unknown environment type.");
      }
      return { environment: instance.environmentType };
    },
    verifyPortal: () =>
      verifyPortal(
        requireEnvironmentValue(env, "NEXT_PUBLIC_PORTAL_KEY"),
        requireEnvironmentValue(env, "PORTAL_SECRET"),
        requireEnvironmentValue(env, "APP_ORIGIN"),
      ),
  };
}
