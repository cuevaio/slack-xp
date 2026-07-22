export const APP_ENVIRONMENTS = [
  "local",
  "test",
  "preview",
  "production",
] as const;

export const SERVICE_MODES = ["mock", "live"] as const;

export const LIVE_ENVIRONMENT_VARIABLES = [
  "APP_ORIGIN",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "CLERK_WEBHOOK_SECRET",
  "NEXT_PUBLIC_PORTAL_KEY",
  "PORTAL_SECRET",
  "DATABASE_URL",
  "CRON_SECRET",
] as const;

export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];
export type ServiceMode = (typeof SERVICE_MODES)[number];
export type EnvironmentSource = Record<string, string | undefined>;
type LiveEnvironmentVariable = (typeof LIVE_ENVIRONMENT_VARIABLES)[number];

const VALUE_PREFIXES: Partial<
  Record<LiveEnvironmentVariable, readonly string[]>
> = {
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: ["pk_test_", "pk_live_"],
  CLERK_SECRET_KEY: ["sk_test_", "sk_live_"],
  CLERK_WEBHOOK_SECRET: ["whsec_"],
  NEXT_PUBLIC_PORTAL_KEY: ["pk_"],
  PORTAL_SECRET: ["sk_"],
};

type ConfigurationIssue = {
  name: string;
  reason: "missing" | "invalid" | "forbidden";
};

export type AppConfiguration =
  | {
      status: "ready";
      environment: AppEnvironment;
      serviceMode: ServiceMode;
      values: Readonly<Record<string, string>>;
    }
  | {
      status: "incomplete";
      environment: AppEnvironment;
      serviceMode: ServiceMode | null;
      issues: readonly ConfigurationIssue[];
    };

export type ReadyAppConfiguration = Extract<
  AppConfiguration,
  { status: "ready" }
>;

function includes<const T extends readonly string[]>(
  values: T,
  value: string | undefined,
): value is T[number] {
  return value !== undefined && values.includes(value);
}

export function detectAppEnvironment(env: EnvironmentSource): AppEnvironment {
  if (includes(APP_ENVIRONMENTS, env.APP_ENV)) {
    return env.APP_ENV;
  }

  if (env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview") {
    return env.VERCEL_ENV;
  }

  return env.NODE_ENV === "test" ? "test" : "local";
}

function validateValue(name: LiveEnvironmentVariable, value: string): boolean {
  if (name === "APP_ORIGIN") {
    try {
      const url = new URL(value);
      return (
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.origin === value
      );
    } catch {
      return false;
    }
  }

  if (name === "DATABASE_URL") {
    try {
      const url = new URL(value);
      return url.protocol === "postgres:" || url.protocol === "postgresql:";
    } catch {
      return false;
    }
  }

  if (name === "CRON_SECRET") {
    return value.length >= 16;
  }

  const prefixes = VALUE_PREFIXES[name];
  return prefixes?.some((prefix) => value.startsWith(prefix)) ?? false;
}

export function readAppConfiguration(
  env: EnvironmentSource = process.env,
): AppConfiguration {
  const environment = detectAppEnvironment(env);
  const issues: ConfigurationIssue[] = [];

  if (env.APP_ENV !== undefined && !includes(APP_ENVIRONMENTS, env.APP_ENV)) {
    issues.push({ name: "APP_ENV", reason: "invalid" });
  }

  const defaultMode =
    environment === "local" || environment === "test" ? "mock" : "live";
  const requestedMode = env.SERVICE_MODE ?? defaultMode;
  const serviceMode = includes(SERVICE_MODES, requestedMode)
    ? requestedMode
    : null;

  if (serviceMode === null) {
    issues.push({ name: "SERVICE_MODE", reason: "invalid" });
  } else if (environment === "production" && serviceMode === "mock") {
    issues.push({ name: "SERVICE_MODE", reason: "forbidden" });
  }

  const values: Record<string, string> = {};
  if (serviceMode === "live") {
    for (const name of LIVE_ENVIRONMENT_VARIABLES) {
      const value = env[name];
      if (!value) {
        issues.push({ name, reason: "missing" });
      } else if (!validateValue(name, value)) {
        issues.push({ name, reason: "invalid" });
      } else {
        values[name] = value;
      }
    }

    const clerkPublishableKey = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    const clerkSecretKey = env.CLERK_SECRET_KEY;
    if (clerkPublishableKey && clerkSecretKey) {
      const [publishableKeyPrefix, secretKeyPrefix] =
        environment === "production"
          ? ["pk_live_", "sk_live_"]
          : ["pk_test_", "sk_test_"];
      if (!clerkPublishableKey.startsWith(publishableKeyPrefix)) {
        issues.push({
          name: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
          reason: "invalid",
        });
      }
      if (!clerkSecretKey.startsWith(secretKeyPrefix)) {
        issues.push({ name: "CLERK_SECRET_KEY", reason: "invalid" });
      }
    }

    if (
      environment === "production" &&
      env.APP_ORIGIN &&
      !env.APP_ORIGIN.startsWith("https://")
    ) {
      issues.push({ name: "APP_ORIGIN", reason: "invalid" });
    }
  }

  if (issues.length > 0 || serviceMode === null) {
    return { status: "incomplete", environment, serviceMode, issues };
  }

  return { status: "ready", environment, serviceMode, values };
}

export function assertProductionSafety(env: EnvironmentSource): void {
  const environment = detectAppEnvironment(env);
  if (environment === "production" && env.SERVICE_MODE === "mock") {
    throw new Error(
      "Portal Messenger refuses to build or start with SERVICE_MODE=mock in production.",
    );
  }
}
