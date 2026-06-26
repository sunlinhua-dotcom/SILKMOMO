import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".claude/**",
    ".playwright-mcp/**",
    "scripts/seed-*.js",
    "node_modules/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 本地素材库（不入库），含临时 E2E 脚本，非项目源码，无需 lint
    "refs/**",
  ]),
]);

export default eslintConfig;
