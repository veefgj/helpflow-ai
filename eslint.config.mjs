import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/generated/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/public/**",
      "**/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // Plain Node scripts (not part of any package's TS project) — e.g. scripts/bundle-app.mjs.
    files: ["**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
);
