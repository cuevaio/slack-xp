import {
  createDeploymentDryRun,
  formatReleaseReport,
  validateReleasePackage,
} from "@/lib/release-docs";

const root = process.cwd();
const dryRun = process.argv.includes("--dry-run");

if (dryRun) {
  const report = await createDeploymentDryRun(root);
  console.log(formatReleaseReport(report));
  console.log("\nCredential-free deployment rehearsal:");
  for (const [index, phase] of report.phases.entries()) {
    console.log(`${index + 1}. ${phase}`);
  }
  console.log(
    "\nNo service credentials were read and no network calls or mutations were made.",
  );

  process.exitCode = report.exitCode;
} else {
  const report = await validateReleasePackage(root);
  console.log(formatReleaseReport(report));
  process.exitCode = report.exitCode;
}
