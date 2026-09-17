import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import simpleImportSort from "eslint-plugin-simple-import-sort";

const tsconfigRootDir = new URL("./", import.meta.url).pathname;

const nodeGlobals = {
  process: "readonly",
  console: "readonly",
  setTimeout: "readonly",
  setInterval: "readonly",
  clearTimeout: "readonly",
  clearInterval: "readonly",
  Buffer: "readonly",
  fetch: "readonly",
  crypto: "readonly",
  exports: "readonly",
  require: "readonly",
  module: "readonly",
  __dirname: "readonly",
  __filename: "readonly",
  global: "readonly"
};

export default [
  {
    ignores: ["dist", "node_modules"]
  },
  js.configs.recommended,
  ...tseslint.config({
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir
      },
      globals: nodeGlobals
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      import: importPlugin,
      "simple-import-sort": simpleImportSort
    },
    rules: {
      "simple-import-sort/imports": "off",
      "simple-import-sort/exports": "off",
      "import/order": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-misused-promises": "off"
    }
  }),
  {
    files: ["**/*.js"],
    languageOptions: {
      globals: nodeGlobals
    }
  }
];
