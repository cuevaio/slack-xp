import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const portalCli = resolve("node_modules/@portalsdk/cli/dist/index.js");
const patchedPortalCli = resolve(
  `node_modules/@portalsdk/cli/dist/deploy-${process.pid}.js`,
);
const extractWithoutVersion = "let t={project:{webhooks:null},channels:{}};";
const extractWithVersion =
  'let t={version:"1",project:{webhooks:null},channels:{}};';
const duplicateWithoutVersionId =
  "if(t===409)return{versionId:H(r),alreadyDeployed:!0};";
const duplicateWithActiveVersion =
  'if(t===409){let{status:o,data:s}=await this.send("GET","/v1/configs/active"),i=a=>a&&typeof a==="object"?Array.isArray(a)?a.map(i):Object.fromEntries(Object.keys(a).sort().map(l=>[l,i(a[l])])):a;if(o>=200&&o<300&&JSON.stringify(i(s.extract))===JSON.stringify(i(n.extract)))return{versionId:H(s),alreadyDeployed:!0};throw this.fail(t,r)}';

const source = await readFile(portalCli, "utf8");
if (
  !source.includes(extractWithoutVersion) ||
  !source.includes(duplicateWithoutVersionId)
) {
  throw new Error(
    "The Portal CLI compatibility patch no longer matches. Update @portalsdk/cli and remove this workaround.",
  );
}

await writeFile(
  patchedPortalCli,
  source
    .replace(extractWithoutVersion, extractWithVersion)
    .replace(duplicateWithoutVersionId, duplicateWithActiveVersion),
);

try {
  const child = Bun.spawn(["node", patchedPortalCli, "deploy"], {
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  process.exitCode = await child.exited;
} finally {
  await rm(patchedPortalCli, { force: true });
}
