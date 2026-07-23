import { access, readdir, readFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { LIVE_ENVIRONMENT_VARIABLES } from "@/lib/config";

export type ReleaseCheck = {
  id: string;
  label: string;
  status: "pass" | "fail";
  detail: string;
};

export type ReleasePackageReport = {
  checks: ReleaseCheck[];
  exitCode: 0 | 1;
};

export type DeploymentDryRun = ReleasePackageReport & {
  phases: string[];
  requiresCredentials: false;
};

const RELEASE_DOCUMENTS = [
  "README.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "docs/architecture.md",
  "docs/deployment.md",
  "docs/environment.md",
  "docs/office-event-protocol.md",
  "docs/operations.md",
  "docs/privacy-and-limitations.md",
  "docs/real-service-smoke.md",
] as const;

const DEPLOY_ENVIRONMENT_VARIABLES = [
  "APP_ENV",
  "SERVICE_MODE",
  ...LIVE_ENVIRONMENT_VARIABLES,
] as const;

const OPTIONAL_ENVIRONMENT_VARIABLES = [
  "OPERATOR_CLERK_USER_IDS",
  "PORTAL_MESSENGER_MAINTENANCE",
] as const;

const PORTAL_CHANNELS = [
  "general:*",
  "watercooler:*",
  "tech-support:*",
  "urgent:*",
  "all-hands:*",
  "office-events:*",
  "hr-reports",
] as const;

const PORTAL_PACKAGE_VERSIONS = {
  "@portalsdk/core": "0.1.4",
  "@portalsdk/react": "0.1.2",
  "@portalsdk/config": "0.1.4",
  "@portalsdk/cli": "0.4.1",
} as const;

export const DEPLOYMENT_DRY_RUN_PHASES = [
  "Fork and choose a production region",
  "Create separate development resources",
  "Verify the development stack",
  "Create separate production resources",
  "Deploy production configuration and migrations",
  "Verify the production deployment",
] as const;

function pass(id: string, label: string, detail: string): ReleaseCheck {
  return { id, label, status: "pass", detail };
}

function fail(id: string, label: string, detail: string): ReleaseCheck {
  return { id, label, status: "fail", detail };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function markdownDocuments(root: string): Promise<string[]> {
  const documents = ["README.md", "CONTRIBUTING.md", "CONTEXT.md"];
  const pending = [resolve(root, "docs")];

  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) {
      continue;
    }

    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
      } else if (entry.isFile() && extname(entry.name) === ".md") {
        documents.push(relative(root, path));
      }
    }
  }

  return documents.sort();
}

function markdownAnchor(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

function documentAnchors(source: string): Set<string> {
  const anchors = new Set<string>();
  const duplicates = new Map<string, number>();

  for (const line of source.split("\n")) {
    const heading = /^(?:#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!heading) {
      continue;
    }

    const base = markdownAnchor(heading[1]);
    const duplicate = duplicates.get(base) ?? 0;
    duplicates.set(base, duplicate + 1);
    anchors.add(duplicate === 0 ? base : `${base}-${duplicate}`);
  }

  return anchors;
}

function localMarkdownTargets(source: string): string[] {
  const targets: string[] = [];
  const pattern = /!?\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

  for (const match of source.matchAll(pattern)) {
    const target = match[1].replace(/^<|>$/g, "");
    if (
      target.startsWith("http://") ||
      target.startsWith("https://") ||
      target.startsWith("mailto:")
    ) {
      continue;
    }
    targets.push(target);
  }

  return targets;
}

async function checkReleaseDocuments(root: string): Promise<ReleaseCheck> {
  const missing: string[] = [];
  for (const relativePath of RELEASE_DOCUMENTS) {
    if (!(await exists(resolve(root, relativePath)))) {
      missing.push(relativePath);
    }
  }

  return missing.length === 0
    ? pass(
        "release-documents",
        "Release documentation",
        "Every fork, deploy, architecture, operations, privacy, and contribution document is present.",
      )
    : fail(
        "release-documents",
        "Release documentation",
        `Missing release documents: ${missing.join(", ")}.`,
      );
}

async function checkDocumentationLinks(root: string): Promise<ReleaseCheck> {
  const failures: string[] = [];
  const sourceCache = new Map<string, string>();

  for (const relativePath of await markdownDocuments(root)) {
    const absolutePath = resolve(root, relativePath);
    const source = await readFile(absolutePath, "utf8");
    sourceCache.set(absolutePath, source);

    for (const target of localMarkdownTargets(source)) {
      const [encodedPath, encodedAnchor] = target.split("#", 2);
      const targetPath = encodedPath
        ? resolve(dirname(absolutePath), decodeURIComponent(encodedPath))
        : absolutePath;

      if (!(await exists(targetPath))) {
        failures.push(`${relativePath} -> ${target}`);
        continue;
      }

      if (!encodedAnchor || extname(targetPath) !== ".md") {
        continue;
      }

      const targetSource =
        sourceCache.get(targetPath) ?? (await readFile(targetPath, "utf8"));
      sourceCache.set(targetPath, targetSource);
      const anchor = decodeURIComponent(encodedAnchor);
      if (!documentAnchors(targetSource).has(anchor)) {
        failures.push(`${relativePath} -> ${target}`);
      }
    }
  }

  return failures.length === 0
    ? pass(
        "documentation-links",
        "Documentation links",
        "All local documentation paths and section anchors resolve.",
      )
    : fail(
        "documentation-links",
        "Documentation links",
        `Broken local links: ${failures.join(", ")}.`,
      );
}

async function checkDeployButton(root: string): Promise<ReleaseCheck> {
  const readme = await readFile(resolve(root, "README.md"), "utf8");
  const match =
    /\[!\[Deploy with Vercel]\(https:\/\/vercel\.com\/button\)]\((https:\/\/vercel\.com\/clone\?[^)\s]+)\)/.exec(
      readme,
    );

  if (!match) {
    return fail(
      "deploy-button",
      "Vercel Deploy button",
      "README.md does not contain the expected Vercel Deploy button.",
    );
  }

  const url = new URL(match[1]);
  const environment = new Set(
    (url.searchParams.get("env") ?? "").split(",").filter(Boolean),
  );
  const missing = DEPLOY_ENVIRONMENT_VARIABLES.filter(
    (name) => !environment.has(name),
  );
  const defaults = JSON.parse(url.searchParams.get("envDefaults") ?? "{}") as {
    APP_ENV?: string;
    SERVICE_MODE?: string;
  };
  const valid =
    url.searchParams.get("repository-url") ===
      "https://github.com/cuevaio/slack-xp" &&
    missing.length === 0 &&
    defaults.APP_ENV === "production" &&
    defaults.SERVICE_MODE === "live" &&
    url.searchParams.get("envLink")?.endsWith("/docs/deployment.md");

  return valid
    ? pass(
        "deploy-button",
        "Vercel Deploy button",
        "The button targets the public repository and requests the complete live production environment.",
      )
    : fail(
        "deploy-button",
        "Vercel Deploy button",
        `The deploy URL is incomplete${missing.length > 0 ? `; missing: ${missing.join(", ")}` : ""}.`,
      );
}

async function checkEnvironmentReference(root: string): Promise<ReleaseCheck> {
  const [reference, example] = await Promise.all([
    readFile(resolve(root, "docs/environment.md"), "utf8"),
    readFile(resolve(root, ".env.example"), "utf8"),
  ]);
  const documented = [
    ...DEPLOY_ENVIRONMENT_VARIABLES,
    ...OPTIONAL_ENVIRONMENT_VARIABLES,
  ].filter((name) => !reference.includes(`\`${name}\``));
  const absentFromExample = [
    ...DEPLOY_ENVIRONMENT_VARIABLES,
    ...OPTIONAL_ENVIRONMENT_VARIABLES,
  ].filter((name) => !example.includes(`${name}=`));

  return documented.length === 0 && absentFromExample.length === 0
    ? pass(
        "environment-reference",
        "Environment reference",
        "Every required and optional runtime variable is documented and represented in .env.example.",
      )
    : fail(
        "environment-reference",
        "Environment reference",
        `Missing documentation: ${documented.join(", ") || "none"}; missing examples: ${absentFromExample.join(", ") || "none"}.`,
      );
}

async function checkVercelConfiguration(root: string): Promise<ReleaseCheck> {
  const [configurationSource, deploymentGuide] = await Promise.all([
    readFile(resolve(root, "vercel.json"), "utf8"),
    readFile(resolve(root, "docs/deployment.md"), "utf8"),
  ]);
  const configuration = JSON.parse(configurationSource) as {
    regions?: unknown[];
    crons?: Array<{ path?: string; schedule?: string }>;
  };
  const valid =
    configuration.regions?.length === 1 &&
    typeof configuration.regions[0] === "string" &&
    configuration.crons?.some(
      (cron) =>
        cron.path === "/api/cron/office-days" && cron.schedule === "0 0 * * *",
    ) &&
    deploymentGuide.includes("bun run db:migrate") &&
    deploymentGuide.includes("bun run portal:deploy") &&
    deploymentGuide.includes("bun run setup:check") &&
    deploymentGuide.includes("vercel.json");

  return valid
    ? pass(
        "vercel-configuration",
        "Vercel configuration",
        "One function region, the UTC Office Day Cron, explicit migrations, Portal deployment, and setup verification are documented.",
      )
    : fail(
        "vercel-configuration",
        "Vercel configuration",
        "vercel.json or the ordered deployment guide is missing a required release decision.",
      );
}

async function checkPortalConfiguration(root: string): Promise<ReleaseCheck> {
  const source = await readFile(resolve(root, "portal.config.ts"), "utf8");
  const missing = PORTAL_CHANNELS.filter(
    (channel) =>
      !new RegExp(
        `"${channel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:\\s*\\{[^}]*anonymous:\\s*false`,
      ).test(source),
  );
  const valid =
    missing.length === 0 &&
    /"all-hands:\*"\s*:\s*\{[^}]*mode:\s*"broadcast"/.test(source);

  return valid
    ? pass(
        "portal-configuration",
        "Portal customer configuration",
        "Every channel family refuses anonymous access and All Hands uses broadcast mode.",
      )
    : fail(
        "portal-configuration",
        "Portal customer configuration",
        `Portal policy is incomplete${missing.length > 0 ? `; missing anonymous refusal: ${missing.join(", ")}` : ""}.`,
      );
}

async function checkDependencyPolicy(root: string): Promise<ReleaseCheck> {
  const packageJson = JSON.parse(
    await readFile(resolve(root, "package.json"), "utf8"),
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const versions = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  const mismatches = Object.entries(PORTAL_PACKAGE_VERSIONS).filter(
    ([name, version]) => versions[name] !== version,
  );
  const hasBunLock = await exists(resolve(root, "bun.lock"));
  const competingLocks = (
    await Promise.all(
      ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"].map(
        async (name) => ({
          name,
          exists: await exists(resolve(root, name)),
        }),
      ),
    )
  ).filter((entry) => entry.exists);

  return mismatches.length === 0 && hasBunLock && competingLocks.length === 0
    ? pass(
        "dependency-policy",
        "Portal package and lockfile policy",
        "Portal packages are exact and bun.lock is the only lockfile.",
      )
    : fail(
        "dependency-policy",
        "Portal package and lockfile policy",
        "Portal package versions or the Bun-only lockfile policy have drifted.",
      );
}

export async function validateReleasePackage(
  root: string,
): Promise<ReleasePackageReport> {
  const checks = await Promise.all([
    checkReleaseDocuments(root),
    checkDocumentationLinks(root),
    checkDeployButton(root),
    checkEnvironmentReference(root),
    checkVercelConfiguration(root),
    checkPortalConfiguration(root),
    checkDependencyPolicy(root),
  ]);

  return {
    checks,
    exitCode: checks.some((check) => check.status === "fail") ? 1 : 0,
  };
}

export async function createDeploymentDryRun(
  root: string,
): Promise<DeploymentDryRun> {
  const report = await validateReleasePackage(root);
  return {
    ...report,
    phases: [...DEPLOYMENT_DRY_RUN_PHASES],
    requiresCredentials: false,
  };
}

export function formatReleaseReport(report: ReleasePackageReport): string {
  return report.checks
    .map(
      (check) =>
        `[${check.status.toUpperCase()}] ${check.label}: ${check.detail}`,
    )
    .join("\n");
}
