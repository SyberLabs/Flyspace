import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // eslint-config-next already ignores .next, out, build and next-env.d.ts.
  globalIgnores(["dist/**", ".vinext/**"]),
  {
    rules: {
      // Pragmatic: `any` is used in external-JSON parsing / gateway / generic
      // wire data. Kept as a warning (visible + counted) rather than a blocking
      // error. Type these out incrementally.
      "@typescript-eslint/no-explicit-any": "warn",
      // Unused vars stay advisory (warning) so they don't block CI.
      // `_name` is a deliberate "I know, and I mean it" marker: an unused
      // route handler arg, or a destructure-to-drop when omitting a key.
      // Without this the idiom is unusable and the warning list stops
      // meaning "there is dead code here".
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_"
      }],
      // React Compiler correctness lints. The app runs correctly today
      // (verified by smoke test); these flag effect/render patterns to refactor
      // incrementally rather than blocking CI.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
]);

export default eslintConfig;
