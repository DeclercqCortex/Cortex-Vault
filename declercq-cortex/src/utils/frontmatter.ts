import matter from "gray-matter";

// A parsed markdown document — frontmatter separated from body.
export interface ParsedMarkdown {
  frontmatter: Record<string, unknown>;
  body: string;
  hasFrontmatter: boolean;
}

/**
 * Parse a raw markdown string into frontmatter + body.
 *
 * Behaviour:
 * - No frontmatter → { frontmatter: {}, body: raw, hasFrontmatter: false }
 * - Valid YAML frontmatter → parsed data + body below it
 * - Malformed frontmatter → treated as "no frontmatter", full raw text
 *   returned as body (so the user can see and fix it instead of seeing
 *   a blank screen with an error).
 */
export function parseFrontmatter(raw: string): ParsedMarkdown {
  try {
    const parsed = matter(raw);
    return {
      frontmatter: parsed.data,
      body: parsed.content,
      hasFrontmatter: Object.keys(parsed.data).length > 0,
    };
  } catch (e) {
    console.error("Frontmatter parse error:", e);
    return { frontmatter: {}, body: raw, hasFrontmatter: false };
  }
}

/**
 * Re-assemble a markdown file from its frontmatter + body. Empty frontmatter
 * returns the body unchanged (no leading `---` block).
 *
 * Known caveat: gray-matter's stringify can silently reorder keys or
 * normalise quoting. Round-trips are stable for flat key/value frontmatter,
 * which is all Phase 1 uses. Nested structures are fine but may reformat.
 */
export function serializeFrontmatter(
  frontmatter: Record<string, unknown>,
  body: string,
): string {
  if (Object.keys(frontmatter).length === 0) return body;
  // gray-matter's types don't admit our Record<string, unknown> directly.
  return matter.stringify(body, frontmatter as Record<string, unknown>);
}
