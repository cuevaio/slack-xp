export const REAL_SERVICE_SMOKE_CONFIRMATION = "REAL-SERVICE-SMOKE";

export const SMOKE_SCENARIOS = [
  ["security-policy", "Portal anonymous refusal and origin policy"],
  ["authenticated-identities", "Authenticated New Hires and Operator"],
  ["office-day-outbox", "Office Day seeding and retry-safe outbox"],
  ["persistent-delivery", "Persistent delivery and reconnect history"],
  ["presence-typing-unread", "Presence, typing, and unread state"],
  ["reaction-replay", "Reaction replay"],
  ["reserved-sender-refusal", "Reserved-sender invalidation refusal"],
  ["profile-invalidation", "New Hire Profile invalidation"],
  ["hr-reports-inbox", "HR Reports, Operator inbox, and deep links"],
  ["removed-message", "Removed Message live and historical projection"],
  ["termination-lifecycle", "Termination, denial, and reinstatement"],
  [
    "disposable-lifecycle",
    "Gated Send Home, UTC expiry, and Clerk deletion lifecycle",
  ],
] as const;

export type SmokeScenarioId = (typeof SMOKE_SCENARIOS)[number][0];
export type SmokeCheckStatus = "passed" | "failed" | "skipped" | "not-run";
export type SmokeScenarioResult = "passed" | "skipped";

export type SmokeCleanupResidual =
  | "active-termination"
  | "clerk-profile-restore"
  | "clerk-session-revocation"
  | "disposable-clerk-account"
  | "open-hr-report";

export type SmokeConfiguration = {
  appOrigin: string;
  portalPublishableKey: string;
  clerkSecretKey: string;
  cronSecret: string;
  newHireAId: string;
  newHireBId: string;
  operatorId: string;
  runDisposableClerkLifecycle: boolean;
};

export type SmokeEnvironmentInspection =
  | { status: "ready"; configuration: SmokeConfiguration }
  | { status: "unavailable"; issues: string[] };

export type SmokeCheck = {
  id: SmokeScenarioId;
  label: string;
  status: SmokeCheckStatus;
};

export type SmokeReport = {
  kind: "portal-messenger-real-service-smoke";
  exitCode: 0 | 1 | 2;
  preflightIssues: string[];
  checks: SmokeCheck[];
  cleanupResiduals: SmokeCleanupResidual[];
  retainedByDesign: readonly [
    "portal-conversation-history",
    "neon-safety-projections",
  ];
};

export type SmokeScenarioAdapter = {
  run(
    scenario: SmokeScenarioId,
    configuration: SmokeConfiguration,
  ): Promise<SmokeScenarioResult>;
  cleanup(): Promise<SmokeCleanupResidual[]>;
};

type EnvironmentSource = Record<string, string | undefined>;

const REQUIRED_VARIABLES = [
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_PORTAL_KEY",
  "SMOKE_APP_ORIGIN",
  "SMOKE_CONFIRMATION",
  "SMOKE_CRON_SECRET",
  "SMOKE_NEW_HIRE_A_ID",
  "SMOKE_NEW_HIRE_B_ID",
  "SMOKE_OPERATOR_ID",
] as const;

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,254}$/u;

function isHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.origin === value &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

export function inspectSmokeEnvironment(
  env: EnvironmentSource,
): SmokeEnvironmentInspection {
  const issues = new Set<string>();
  for (const name of REQUIRED_VARIABLES) {
    if (!env[name]?.trim()) issues.add(name);
  }

  if (
    env.SMOKE_CONFIRMATION !== undefined &&
    env.SMOKE_CONFIRMATION !== REAL_SERVICE_SMOKE_CONFIRMATION
  ) {
    issues.add("SMOKE_CONFIRMATION");
  }
  if (
    env.SMOKE_APP_ORIGIN !== undefined &&
    !isHttpsOrigin(env.SMOKE_APP_ORIGIN)
  ) {
    issues.add("SMOKE_APP_ORIGIN");
  }

  const identityNames = [
    "SMOKE_NEW_HIRE_A_ID",
    "SMOKE_NEW_HIRE_B_ID",
    "SMOKE_OPERATOR_ID",
  ] as const;
  const identities = identityNames.map((name) => env[name] ?? "");
  for (const [index, identity] of identities.entries()) {
    if (identity && !SAFE_IDENTIFIER.test(identity)) {
      issues.add(identityNames[index]);
    }
  }
  if (identities.every(Boolean) && new Set(identities).size !== 3) {
    for (const name of identityNames) issues.add(name);
  }

  const lifecycle = env.SMOKE_RUN_DISPOSABLE_CLERK_LIFECYCLE ?? "false";
  if (lifecycle !== "true" && lifecycle !== "false") {
    issues.add("SMOKE_RUN_DISPOSABLE_CLERK_LIFECYCLE");
  }

  if (issues.size > 0) {
    return { status: "unavailable", issues: [...issues].sort() };
  }

  return {
    status: "ready",
    configuration: {
      appOrigin: env.SMOKE_APP_ORIGIN as string,
      portalPublishableKey: env.NEXT_PUBLIC_PORTAL_KEY as string,
      clerkSecretKey: env.CLERK_SECRET_KEY as string,
      cronSecret: env.SMOKE_CRON_SECRET as string,
      newHireAId: env.SMOKE_NEW_HIRE_A_ID as string,
      newHireBId: env.SMOKE_NEW_HIRE_B_ID as string,
      operatorId: env.SMOKE_OPERATOR_ID as string,
      runDisposableClerkLifecycle: lifecycle === "true",
    },
  };
}

function emptyChecks(status: SmokeCheckStatus): SmokeCheck[] {
  return SMOKE_SCENARIOS.map(([id, label]) => ({ id, label, status }));
}

const RETAINED_BY_DESIGN = [
  "portal-conversation-history",
  "neon-safety-projections",
] as const;

export async function runSmokeContract(
  env: EnvironmentSource,
  adapter: SmokeScenarioAdapter,
): Promise<SmokeReport> {
  const inspection = inspectSmokeEnvironment(env);
  if (inspection.status === "unavailable") {
    return {
      kind: "portal-messenger-real-service-smoke",
      exitCode: 2,
      preflightIssues: inspection.issues,
      checks: emptyChecks("not-run"),
      cleanupResiduals: [],
      retainedByDesign: RETAINED_BY_DESIGN,
    };
  }

  const checks = emptyChecks("not-run");
  let cleanupResiduals: SmokeCleanupResidual[] = [];
  try {
    for (const check of checks) {
      try {
        const result = await adapter.run(check.id, inspection.configuration);
        check.status = result === "skipped" ? "skipped" : "passed";
      } catch {
        check.status = "failed";
        break;
      }
    }
  } finally {
    try {
      cleanupResiduals = await adapter.cleanup();
    } catch {
      cleanupResiduals = ["clerk-session-revocation"];
    }
  }

  const hasFailedCheck = checks.some(({ status }) => status === "failed");
  const exitCode = hasFailedCheck || cleanupResiduals.length > 0 ? 1 : 0;

  return {
    kind: "portal-messenger-real-service-smoke",
    exitCode,
    preflightIssues: [],
    checks,
    cleanupResiduals,
    retainedByDesign: RETAINED_BY_DESIGN,
  };
}

const STATUS_LABEL: Record<SmokeCheckStatus, string> = {
  passed: "PASS",
  failed: "FAIL",
  skipped: "SKIP",
  "not-run": "NOT RUN",
};

export function formatSmokeReport(report: SmokeReport): string {
  const lines = ["Portal Messenger manual real-service smoke"];
  if (report.preflightIssues.length > 0) {
    lines.push(
      `UNAVAILABLE: Set or correct protected environment values: ${report.preflightIssues.join(", ")}. No service calls were made.`,
    );
  }
  for (const check of report.checks) {
    lines.push(`[${STATUS_LABEL[check.status]}] ${check.label}`);
  }
  lines.push(
    `Cleanup residuals: ${report.cleanupResiduals.length > 0 ? report.cleanupResiduals.join(", ") : "none"}.`,
  );
  lines.push(
    "Retained by design: Portal conversation history and Neon safety projections.",
  );
  return lines.join("\n");
}

export function smokeCommandArgs({
  preflight = false,
  artifactPath,
}: {
  preflight?: boolean;
  artifactPath?: string;
}): string[] {
  const args = ["bun", "scripts/real-service-smoke.ts"];
  if (preflight) args.push("--preflight");
  if (artifactPath) args.push("--artifact", artifactPath);
  return args;
}
