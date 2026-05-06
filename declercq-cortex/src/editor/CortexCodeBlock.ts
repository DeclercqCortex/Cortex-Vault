// Cluster 21 v1.1 — Code-block syntax highlighting via lowlight.
//
// Replaces StarterKit's CodeBlock (which renders raw text inside a
// <pre><code>) with @tiptap/extension-code-block-lowlight, which
// runs lowlight + highlight.js on the cell contents and emits a
// tree of <span class="hljs-..."> tokens that the user-visible CSS
// in src/index.css colors.
//
// We register a small curated set of languages (Python, JavaScript,
// TypeScript, Rust, Go, JSON, Bash, Shell, plus an alias for
// "shell" / "console" / "sh"). Adding more languages is one line
// each; bundle size grows by a few KB per language so we keep the
// list focused on what the user actually pastes.
//
// Markdown round-trip: tiptap-markdown's html: true serializes the
// hljs spans inside the <pre><code> as inline HTML (verbose but
// preserved); when reopened the language attr (data-language) is
// the source of truth and lowlight re-tokenizes from raw text.

import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { createLowlight } from "lowlight";

import bash from "highlight.js/lib/languages/bash";
import go from "highlight.js/lib/languages/go";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import typescript from "highlight.js/lib/languages/typescript";

export const CORTEX_CODE_LANGUAGES = [
  { value: "plaintext", label: "Plain text" },
  { value: "python", label: "Python" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "rust", label: "Rust" },
  { value: "go", label: "Go" },
  { value: "json", label: "JSON" },
  { value: "bash", label: "Bash" },
  { value: "shell", label: "Shell / console" },
] as const;

export const lowlight = createLowlight();

lowlight.register("plaintext", plaintext);
lowlight.register("python", python);
lowlight.register("py", python);
lowlight.register("javascript", javascript);
lowlight.register("js", javascript);
lowlight.register("typescript", typescript);
lowlight.register("ts", typescript);
lowlight.register("rust", rust);
lowlight.register("rs", rust);
lowlight.register("go", go);
lowlight.register("golang", go);
lowlight.register("json", json);
lowlight.register("bash", bash);
lowlight.register("sh", bash);
lowlight.register("shell", shell);
lowlight.register("console", shell);

/** TipTap CodeBlockLowlight extension preconfigured with the curated
 *  language registry. Default language is plaintext (no highlighting). */
export const CortexCodeBlock = CodeBlockLowlight.configure({
  lowlight,
  defaultLanguage: "plaintext",
  HTMLAttributes: { class: "cortex-code-block" },
});
