import { allow, defineConfig } from "@portalsdk/config";

const publicOfficeChannel = {
  anonymous: true,
  authz: (ctx: { claims: Record<string, unknown> }) =>
    allow({ publish: ctx.claims.anon !== true }),
};

export default defineConfig({
  channels: {
    "general:*": publicOfficeChannel,
    "watercooler:*": publicOfficeChannel,
    "tech-support:*": publicOfficeChannel,
    "urgent:*": publicOfficeChannel,
    "all-hands:*": { ...publicOfficeChannel, mode: "broadcast" },
    "office-events:*": { anonymous: false },
    "hr-reports": { anonymous: false },
  },
});
