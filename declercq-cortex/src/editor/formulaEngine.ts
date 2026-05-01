// formulaEngine — Cluster 18 Pass 2.
//
// A small lexer + parser + evaluator for Excel-style formulas inside
// table cells. Lives entirely in the frontend; the on-disk format
// stores the raw `=…` string in a `data-formula` attribute on the
// cell, and the evaluated result as the cell's text content. The
// formula is re-evaluated on cell blur (Cluster 18 v1.0 decision —
// see cluster_18_table_excel_layer.md).
//
// Grammar (informal)
// ------------------
//   formula     := '=' expr
//   expr        := term (( '+' | '-' ) term)*
//   term        := power (( '*' | '/' ) power)*
//   power       := unary ( '^' unary )*
//   unary       := '-' unary | primary
//   primary     := number
//                | string
//                | cellOrRange
//                | functionCall
//                | '(' expr ')'
//   cellOrRange := CELLREF ( ':' CELLREF )?
//   functionCall:= IDENT '(' (expr (',' expr)*)? ')'
//
// Cell references use Excel-style A1 notation (column letters, 1-based
// row numbers). Ranges are inclusive on both ends.
//
// Functions in v1.0
// -----------------
// SUM, AVG (alias MEAN), COUNT, MIN, MAX, MEDIAN, IF
// Plus arithmetic operators + - * / ^ and unary minus.
//
// Errors
// ------
// FormulaResult is a tagged union: { kind: "ok", value, displayed } or
// { kind: "error", message }. The renderer surfaces ok.displayed in
// italic; on error it shows "—" with a tooltip carrying the message.
// Circular references are detected via a visited-set parameter that the
// caller threads through nested cell-ref resolution.

// =====================================================================
// Public types
// =====================================================================

export type FormulaResult =
  | {
      kind: "ok";
      /** The computed value as a JS number or string. */
      value: number | string;
      /** Human-friendly representation suitable for putting in the cell's
       *  text content (e.g. "12.5", "Hello"). */
      displayed: string;
    }
  | {
      kind: "error";
      message: string;
    };

/**
 * The host (the editor's table) provides this so the engine can resolve
 * cell references and ranges. The host knows the table's TableMap and
 * can read each cell's textContent (or, for cells that themselves
 * contain a formula, the formula's evaluated displayed value).
 */
export interface TableContext {
  /** Total column count (so we can validate ranges). */
  columnCount: number;
  /** Total row count. */
  rowCount: number;
  /**
   * Resolve a cell reference. col and row are 0-based.
   * Returns the cell's text content. The implementation may follow
   * formula chains; if so, it should pass the visited set down to
   * detect circular references.
   */
  cellAt(col: number, row: number, visited: Set<string>): string;
}

/**
 * Top-level entry point. Given a formula string starting with `=`,
 * returns the evaluation result. The caller passes a fresh visited
 * set; the evaluator updates it during cell-ref resolution to detect
 * cycles.
 */
export function evaluateFormula(
  raw: string,
  ctx: TableContext,
  visited: Set<string> = new Set(),
): FormulaResult {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("=")) {
    return { kind: "error", message: "Formula must start with =" };
  }
  const body = trimmed.slice(1).trim();
  if (!body) {
    return { kind: "error", message: "Empty formula" };
  }

  let tokens: Token[];
  try {
    tokens = lex(body);
  } catch (err) {
    return { kind: "error", message: `Lex error: ${(err as Error).message}` };
  }

  let ast: Expr;
  try {
    const parser = new Parser(tokens);
    ast = parser.parseExpr();
    if (!parser.atEnd()) {
      return {
        kind: "error",
        message: `Unexpected token after expression: ${parser.peek().type}`,
      };
    }
  } catch (err) {
    return {
      kind: "error",
      message: `Parse error: ${(err as Error).message}`,
    };
  }

  let value: Value;
  try {
    value = evaluate(ast, ctx, visited);
  } catch (err) {
    return {
      kind: "error",
      message: (err as Error).message,
    };
  }

  return {
    kind: "ok",
    value: scalarOf(value),
    displayed: formatScalar(scalarOf(value)),
  };
}

// =====================================================================
// Lexer
// =====================================================================

type TokenType =
  | "NUMBER"
  | "STRING"
  | "IDENT"
  | "CELLREF"
  | "OP"
  | "LPAREN"
  | "RPAREN"
  | "COMMA"
  | "COLON"
  | "EOF";

interface Token {
  type: TokenType;
  text: string;
  /** Numeric value (for NUMBER tokens). */
  number?: number;
  /** Cell ref decomposed (for CELLREF tokens). */
  cellCol?: number;
  cellRow?: number;
}

function lex(input: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];

    // Whitespace
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }

    // Single-char punctuation
    if (ch === "(") {
      out.push({ type: "LPAREN", text: ch });
      i++;
      continue;
    }
    if (ch === ")") {
      out.push({ type: "RPAREN", text: ch });
      i++;
      continue;
    }
    if (ch === ",") {
      out.push({ type: "COMMA", text: ch });
      i++;
      continue;
    }
    if (ch === ":") {
      out.push({ type: "COLON", text: ch });
      i++;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "^") {
      out.push({ type: "OP", text: ch });
      i++;
      continue;
    }

    // Cluster 18 v1.2 — two-character comparison operators with one-
    // char fallbacks. We peek the next char to disambiguate `<` vs
    // `<=` etc.
    if (ch === "<" || ch === ">" || ch === "=" || ch === "!") {
      const next = input[i + 1];
      if (ch === "<" && next === "=") {
        out.push({ type: "OP", text: "<=" });
        i += 2;
        continue;
      }
      if (ch === ">" && next === "=") {
        out.push({ type: "OP", text: ">=" });
        i += 2;
        continue;
      }
      if (ch === "=" && next === "=") {
        out.push({ type: "OP", text: "==" });
        i += 2;
        continue;
      }
      if (ch === "!" && next === "=") {
        out.push({ type: "OP", text: "!=" });
        i += 2;
        continue;
      }
      if (ch === "<" || ch === ">") {
        // Single < or > on its own is a comparison op.
        out.push({ type: "OP", text: ch });
        i++;
        continue;
      }
      // Bare `=` mid-formula is treated as `==` (Excel-compat). This
      // is unambiguous because the leading `=` of the formula is
      // already consumed before the lexer runs.
      if (ch === "=") {
        out.push({ type: "OP", text: "==" });
        i++;
        continue;
      }
      // Bare `!` is invalid (we don't have logical NOT). Fall through.
      throw new Error(`Unexpected character: ${ch}`);
    }

    // String literal — single or double quotes
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let body = "";
      while (j < input.length && input[j] !== quote) {
        if (input[j] === "\\" && j + 1 < input.length) {
          body += input[j + 1];
          j += 2;
        } else {
          body += input[j];
          j++;
        }
      }
      if (j >= input.length) throw new Error("Unterminated string literal");
      out.push({ type: "STRING", text: body });
      i = j + 1;
      continue;
    }

    // Number — leading digit or `.`
    if ((ch >= "0" && ch <= "9") || ch === ".") {
      let j = i;
      while (
        j < input.length &&
        ((input[j] >= "0" && input[j] <= "9") ||
          input[j] === "." ||
          input[j] === "e" ||
          input[j] === "E" ||
          (j > i &&
            (input[j] === "+" || input[j] === "-") &&
            (input[j - 1] === "e" || input[j - 1] === "E")))
      ) {
        j++;
      }
      const text = input.slice(i, j);
      const n = Number(text);
      if (!Number.isFinite(n)) {
        throw new Error(`Invalid number: ${text}`);
      }
      out.push({ type: "NUMBER", text, number: n });
      i = j;
      continue;
    }

    // Identifier / cell reference — starts with letter
    if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_") {
      let j = i;
      while (
        j < input.length &&
        ((input[j] >= "A" && input[j] <= "Z") ||
          (input[j] >= "a" && input[j] <= "z") ||
          (input[j] >= "0" && input[j] <= "9") ||
          input[j] === "_")
      ) {
        j++;
      }
      const text = input.slice(i, j);
      // Try parsing as a cell reference (e.g., A1, AB12).
      const cell = parseCellRef(text);
      if (cell) {
        out.push({
          type: "CELLREF",
          text,
          cellCol: cell.col,
          cellRow: cell.row,
        });
      } else {
        out.push({ type: "IDENT", text: text.toUpperCase() });
      }
      i = j;
      continue;
    }

    throw new Error(`Unexpected character: ${ch}`);
  }
  out.push({ type: "EOF", text: "" });
  return out;
}

/**
 * Parse a string like "A1" / "AB12" into 0-based (col, row). Returns
 * null if the string isn't a well-formed cell ref.
 */
function parseCellRef(text: string): { col: number; row: number } | null {
  const m = /^([A-Za-z]+)(\d+)$/.exec(text);
  if (!m) return null;
  const letters = m[1].toUpperCase();
  const rowOneBased = parseInt(m[2], 10);
  if (!Number.isFinite(rowOneBased) || rowOneBased < 1) return null;
  let col = 0;
  for (const c of letters) {
    col = col * 26 + (c.charCodeAt(0) - 64); // 'A' → 1
  }
  // Convert to 0-based.
  return { col: col - 1, row: rowOneBased - 1 };
}

// =====================================================================
// Parser
// =====================================================================

type Expr =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "cell"; col: number; row: number }
  | {
      kind: "range";
      startCol: number;
      startRow: number;
      endCol: number;
      endRow: number;
    }
  | { kind: "binop"; op: string; left: Expr; right: Expr }
  | { kind: "unary"; op: string; operand: Expr }
  | { kind: "call"; name: string; args: Expr[] };

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  atEnd(): boolean {
    return this.tokens[this.pos]?.type === "EOF";
  }
  peek(): Token {
    return this.tokens[this.pos];
  }
  advance(): Token {
    return this.tokens[this.pos++];
  }
  expect(type: TokenType, text?: string): Token {
    const t = this.peek();
    if (t.type !== type || (text != null && t.text !== text)) {
      throw new Error(
        `Expected ${type}${text ? ` "${text}"` : ""}, got ${t.type}${t.text ? ` "${t.text}"` : ""}`,
      );
    }
    return this.advance();
  }

  /**
   * Top-level entry. Comparison sits above arithmetic so that
   * `=A1+1>B1+2` parses as `(A1+1) > (B1+2)`. Comparisons are not
   * chainable (`1<2<3` is a parse error) — matches Excel and avoids
   * surprises.
   */
  parseExpr(): Expr {
    return this.parseComparison();
  }

  /** comparison := add ( (==|!=|<|<=|>|>=) add )? */
  parseComparison(): Expr {
    const left = this.parseAdd();
    const t = this.peek();
    if (
      t.type === "OP" &&
      (t.text === "==" ||
        t.text === "!=" ||
        t.text === "<" ||
        t.text === "<=" ||
        t.text === ">" ||
        t.text === ">=")
    ) {
      const op = this.advance().text;
      const right = this.parseAdd();
      return { kind: "binop", op, left, right };
    }
    return left;
  }

  /** add := term (('+' | '-') term)* */
  parseAdd(): Expr {
    let left = this.parseTerm();
    while (
      this.peek().type === "OP" &&
      (this.peek().text === "+" || this.peek().text === "-")
    ) {
      const op = this.advance().text;
      const right = this.parseTerm();
      left = { kind: "binop", op, left, right };
    }
    return left;
  }

  /** term := power (('*' | '/') power)* */
  parseTerm(): Expr {
    let left = this.parsePower();
    while (
      this.peek().type === "OP" &&
      (this.peek().text === "*" || this.peek().text === "/")
    ) {
      const op = this.advance().text;
      const right = this.parsePower();
      left = { kind: "binop", op, left, right };
    }
    return left;
  }

  /** power := unary ('^' unary)*  — right-associative */
  parsePower(): Expr {
    const left = this.parseUnary();
    if (this.peek().type === "OP" && this.peek().text === "^") {
      this.advance();
      const right = this.parsePower(); // right-assoc
      return { kind: "binop", op: "^", left, right };
    }
    return left;
  }

  /** unary := '-' unary | primary */
  parseUnary(): Expr {
    if (this.peek().type === "OP" && this.peek().text === "-") {
      this.advance();
      const operand = this.parseUnary();
      return { kind: "unary", op: "-", operand };
    }
    if (this.peek().type === "OP" && this.peek().text === "+") {
      this.advance();
      return this.parseUnary(); // unary plus is a no-op
    }
    return this.parsePrimary();
  }

  /** primary := NUMBER | STRING | cellOrRange | functionCall | '(' expr ')' */
  parsePrimary(): Expr {
    const t = this.peek();
    if (t.type === "NUMBER") {
      this.advance();
      return { kind: "number", value: t.number ?? 0 };
    }
    if (t.type === "STRING") {
      this.advance();
      return { kind: "string", value: t.text };
    }
    if (t.type === "LPAREN") {
      this.advance();
      const inner = this.parseExpr();
      this.expect("RPAREN");
      return inner;
    }
    if (t.type === "CELLREF") {
      this.advance();
      // Range?
      if (this.peek().type === "COLON") {
        this.advance();
        const end = this.expect("CELLREF");
        return {
          kind: "range",
          startCol: t.cellCol ?? 0,
          startRow: t.cellRow ?? 0,
          endCol: end.cellCol ?? 0,
          endRow: end.cellRow ?? 0,
        };
      }
      return { kind: "cell", col: t.cellCol ?? 0, row: t.cellRow ?? 0 };
    }
    if (t.type === "IDENT") {
      const name = this.advance().text;
      this.expect("LPAREN");
      const args: Expr[] = [];
      if (this.peek().type !== "RPAREN") {
        args.push(this.parseExpr());
        while (this.peek().type === "COMMA") {
          this.advance();
          args.push(this.parseExpr());
        }
      }
      this.expect("RPAREN");
      return { kind: "call", name, args };
    }
    throw new Error(
      `Unexpected token: ${t.type}${t.text ? ` "${t.text}"` : ""}`,
    );
  }
}

// =====================================================================
// Evaluator
// =====================================================================

/** Run-time value. Ranges return arrays; everything else is scalar. */
type Value = number | string | Value[];

function evaluate(expr: Expr, ctx: TableContext, visited: Set<string>): Value {
  switch (expr.kind) {
    case "number":
      return expr.value;
    case "string":
      return expr.value;
    case "cell":
      return resolveCell(expr.col, expr.row, ctx, visited);
    case "range": {
      const out: Value[] = [];
      const c0 = Math.min(expr.startCol, expr.endCol);
      const c1 = Math.max(expr.startCol, expr.endCol);
      const r0 = Math.min(expr.startRow, expr.endRow);
      const r1 = Math.max(expr.startRow, expr.endRow);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          out.push(resolveCell(c, r, ctx, visited));
        }
      }
      return out;
    }
    case "unary": {
      const v = numericValue(evaluate(expr.operand, ctx, visited));
      if (expr.op === "-") return -v;
      return v;
    }
    case "binop": {
      const l = numericValue(evaluate(expr.left, ctx, visited));
      const r = numericValue(evaluate(expr.right, ctx, visited));
      switch (expr.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          if (r === 0) throw new Error("Division by zero");
          return l / r;
        case "^":
          return Math.pow(l, r);
        // Cluster 18 v1.2 — comparisons return 1 (true) or 0 (false)
        // numerically, matching Excel semantics. This composes with
        // arithmetic (e.g. `=(A1>10) * 5` yields 5 when A1>10 else 0)
        // and feeds IF cleanly (IF treats non-zero as true).
        case "==":
          return l === r ? 1 : 0;
        case "!=":
          return l === r ? 0 : 1;
        case "<":
          return l < r ? 1 : 0;
        case "<=":
          return l <= r ? 1 : 0;
        case ">":
          return l > r ? 1 : 0;
        case ">=":
          return l >= r ? 1 : 0;
      }
      throw new Error(`Unknown operator ${expr.op}`);
    }
    case "call":
      return callFunction(expr.name, expr.args, ctx, visited);
  }
}

function resolveCell(
  col: number,
  row: number,
  ctx: TableContext,
  visited: Set<string>,
): Value {
  if (col < 0 || row < 0 || col >= ctx.columnCount || row >= ctx.rowCount) {
    throw new Error(`Cell ${cellRefString(col, row)} out of range`);
  }
  const key = `${col},${row}`;
  if (visited.has(key)) {
    throw new Error(`Circular reference at ${cellRefString(col, row)}`);
  }
  visited.add(key);
  let raw: string;
  try {
    raw = ctx.cellAt(col, row, visited);
  } finally {
    visited.delete(key);
  }
  // Empty cell → 0 in numeric context, "" in string context. We return
  // the trimmed string; numericValue() handles the coercion.
  return raw.trim();
}

function callFunction(
  name: string,
  args: Expr[],
  ctx: TableContext,
  visited: Set<string>,
): Value {
  const upper = name.toUpperCase();

  // IF needs lazy evaluation of the unused branch (Excel-compat).
  if (upper === "IF") {
    if (args.length !== 3) {
      throw new Error("IF requires exactly 3 arguments");
    }
    const cond = numericValue(evaluate(args[0], ctx, visited));
    return evaluate(cond !== 0 ? args[1] : args[2], ctx, visited);
  }

  // All other functions are eager: evaluate every arg, then flatten
  // ranges into the numeric stream.
  const values = args.map((a) => evaluate(a, ctx, visited));
  const nums = flattenNumbers(values);

  switch (upper) {
    case "SUM":
      return nums.reduce((a, b) => a + b, 0);
    case "AVG":
    case "MEAN": {
      if (nums.length === 0) throw new Error("AVG of empty range");
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    }
    case "COUNT":
      return nums.length;
    case "MIN":
      if (nums.length === 0) throw new Error("MIN of empty range");
      return Math.min(...nums);
    case "MAX":
      if (nums.length === 0) throw new Error("MAX of empty range");
      return Math.max(...nums);
    case "MEDIAN": {
      if (nums.length === 0) throw new Error("MEDIAN of empty range");
      const sorted = [...nums].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
    }
  }
  throw new Error(`Unknown function: ${name}`);
}

function flattenNumbers(values: Value[]): number[] {
  const out: number[] = [];
  function visit(v: Value) {
    if (Array.isArray(v)) {
      for (const x of v) visit(x);
      return;
    }
    if (typeof v === "number") {
      if (Number.isFinite(v)) out.push(v);
      return;
    }
    // string — try to coerce; skip empty strings (Excel-compat for COUNT etc.)
    const trimmed = v.trim();
    if (!trimmed) return;
    const n = Number(trimmed);
    if (Number.isFinite(n)) out.push(n);
    // Non-numeric strings are skipped silently. (Strict mode could error.)
  }
  for (const v of values) visit(v);
  return out;
}

function numericValue(v: Value): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (!trimmed) return 0;
    const n = Number(trimmed);
    if (Number.isFinite(n)) return n;
    throw new Error(`Cannot convert "${v}" to number`);
  }
  // array — only valid in function args; in a binary op context this is
  // a malformed formula.
  throw new Error("Cannot use a range in a numeric context");
}

function scalarOf(v: Value): number | string {
  if (Array.isArray(v)) {
    // A range escaped through to the top level (e.g. `=A1:B5` with no
    // wrapping function). Show as a comma-joined string for readability.
    return v.map((x) => (Array.isArray(x) ? "[range]" : String(x))).join(", ");
  }
  return v;
}

function formatScalar(v: number | string): string {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "—";
    // Round to 6 decimal places to avoid 0.1+0.2 noise; trim trailing
    // zeros so integers stay integer-looking.
    const fixed = v.toFixed(6);
    return fixed.replace(/\.?0+$/, "");
  }
  return v;
}

// =====================================================================
// Helpers
// =====================================================================

/** Render (col, row) back into Excel-style "A1" form for error messages. */
function cellRefString(col: number, row: number): string {
  let c = col + 1;
  let letters = "";
  while (c > 0) {
    const rem = (c - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    c = Math.floor((c - 1) / 26);
  }
  return `${letters}${row + 1}`;
}

export const _formulaEngineInternals = {
  lex,
  parseCellRef,
  cellRefString,
  flattenNumbers,
  formatScalar,
};
