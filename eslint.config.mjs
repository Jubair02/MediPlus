import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import reactHooks from "eslint-plugin-react-hooks";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  plugins: { "react-hooks": reactHooks },
  rules: {
    // Kept off deliberately — each of these fires broadly across the existing codebase
    // for stylistic reasons, not correctness ones.
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/prefer-as-const": "off",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",
    "no-console": "off",

    // Everything below used to be "off" too, which left nothing static gating a
    // regression: `no-undef`, `no-unreachable` and `react-hooks/exhaustive-deps` in
    // particular catch real bugs, and silencing them meant `npm run lint` could not fail.
    // Correctness -> error; hygiene -> warn, so the signal is visible without blocking.
    // no-undef and no-redeclare stay off, but for a reason rather than by default:
    // both are core JS rules that TypeScript already enforces better. `no-undef` cannot
    // see type-space identifiers (it flags every `React.ReactNode` annotation) and
    // `no-redeclare` flags every function overload signature. tsc --noEmit is the gate
    // for undefined identifiers now that next.config.ts no longer ignores type errors.
    "no-undef": "off",
    "no-redeclare": "off",
    "no-unreachable": "error",
    "no-fallthrough": "error",
    "no-debugger": "error",
    "no-irregular-whitespace": "error",
    "no-mixed-spaces-and-tabs": "error",
    "no-case-declarations": "error",
    "no-useless-escape": "error",
    "no-empty": ["error", { "allowEmptyCatch": true }],
    "@typescript-eslint/ban-ts-comment": "error",
    "react-hooks/exhaustive-deps": "warn",
    "react-hooks/purity": "warn",
    // Advisory (cascading-render performance), and currently true of ~30 existing
    // fetch-on-mount effects. Kept visible as a warning so lint can still fail the
    // build on genuine errors rather than being switched off wholesale.
    "react-hooks/set-state-in-effect": "warn",
    "react-hooks/refs": "warn",
    "prefer-const": "warn",
    "no-unused-vars": "off", // superseded by the TS-aware rule below
    "@typescript-eslint/no-unused-vars": [
      "warn",
      { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_", "caughtErrors": "none" },
    ],
  },
}, {
  // ".claude/**" and "download/**" hold vendored third-party scripts; "examples/**"
  // imports packages that are not installed. None of it is this app's code, and lint
  // cannot be a gate while 300 errors come from files nobody here maintains.
  ignores: [
    "node_modules/**",
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "examples/**",
    "download/**",
    ".claude/**",
    "skills/**",
    "tool-results/**",
  ]
}];

export default eslintConfig;
