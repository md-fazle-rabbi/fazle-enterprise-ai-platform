import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier/flat";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Why: turns off ESLint rules that fight Prettier over formatting.
  prettier,
  {
    rules: {
      // Why: a stray console.log is a leaked debug line. warn and error stay allowed.
      "no-console": ["error", { allow: ["warn", "error"] }],
      // Why: an underscore prefix marks a parameter that is required but deliberately unused.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts"]),
]);

export default eslintConfig;
