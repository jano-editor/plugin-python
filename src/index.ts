import type { LanguagePlugin, PluginContext, HighlightToken } from "@jano-editor/plugin-types";

// Python highlighting. A small tokenizer with state, so triple quoted strings that span
// lines (docstrings) are colored correctly.

const KEYWORDS = new Set([
  "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del",
  "elif", "else", "except", "finally", "for", "from", "global", "if", "import", "in",
  "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try", "while",
  "with", "yield", "match", "case", "type",
]);

const CONSTANTS = new Set(["True", "False", "None", "NotImplemented", "Ellipsis", "__name__", "__file__"]);

const BUILTINS = new Set([
  "abs", "all", "any", "bin", "bool", "breakpoint", "bytearray", "bytes", "callable",
  "chr", "classmethod", "compile", "complex", "delattr", "dict", "dir", "divmod",
  "enumerate", "eval", "exec", "filter", "float", "format", "frozenset", "getattr",
  "globals", "hasattr", "hash", "help", "hex", "id", "input", "int", "isinstance",
  "issubclass", "iter", "len", "list", "locals", "map", "max", "min", "next", "object",
  "oct", "open", "ord", "pow", "print", "property", "range", "repr", "reversed", "round",
  "set", "setattr", "slice", "sorted", "staticmethod", "str", "sum", "super", "tuple",
  "vars", "zip",
]);

const State = { Normal: 0, TripleDouble: 1, TripleSingle: 2 } as const;
type State = (typeof State)[keyof typeof State];

interface Result {
  tokens: HighlightToken[];
  end: State;
}

const NUMBER = /^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)[jJ]?/;
const IDENT = /^[A-Za-z_]\w*/;
// string prefixes like f, r, b, rb, fr (any case)
const STRING_START = /^(?:[rRbBfFuU]|[rR][bBfF]|[bBfF][rR])?("""|'''|"|')/;

/** Tokenizes one line, starting in `state`. With collect=false only the end state is computed. */
function tokenize(line: string, state: State, collect = true): Result {
  const tokens: HighlightToken[] = [];
  const add = (start: number, end: number, type: string) => {
    if (collect && end > start) tokens.push({ start, end, type });
  };
  let i = 0;

  while (i < line.length) {
    if (state !== State.Normal) {
      const quote = state === State.TripleDouble ? '"""' : "'''";
      const close = findClose(line, i, quote);
      const end = close === -1 ? line.length : close + 3;
      add(i, end, "string");
      i = end;
      if (close !== -1) state = State.Normal;
      continue;
    }

    const c = line[i];
    const rest = line.slice(i);

    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    if (c === "#") {
      add(i, line.length, "comment");
      break;
    }

    const str = STRING_START.exec(rest);
    if (str) {
      const quote = str[1];
      const bodyStart = i + str[0].length;
      const close = findClose(line, bodyStart, quote);
      if (close === -1 && quote.length === 3) {
        // triple quoted string continues on the next lines
        add(i, line.length, "string");
        state = quote === '"""' ? State.TripleDouble : State.TripleSingle;
        break;
      }
      const end = close === -1 ? line.length : close + quote.length;
      add(i, end, "string");
      i = end;
      continue;
    }

    if (c === "@") {
      const m = /^@[\w.]+/.exec(rest);
      const end = i + (m ? m[0].length : 1);
      add(i, end, "attribute");
      i = end;
      continue;
    }

    const num = /\d/.test(c) || (c === "." && /\d/.test(line[i + 1] ?? "")) ? NUMBER.exec(rest) : null;
    if (num) {
      add(i, i + num[0].length, "number");
      i += num[0].length;
      continue;
    }

    const ident = IDENT.exec(rest);
    if (ident) {
      const word = ident[0];
      const end = i + word.length;
      const before = line.slice(0, i).trimEnd();
      const after = line.slice(end).trimStart();
      let type: string | null = null;
      if (/\bdef$/.test(before)) type = "function";
      else if (/\bclass$/.test(before)) type = "type";
      else if (before.endsWith(".")) type = after.startsWith("(") ? "function" : "property";
      else if (KEYWORDS.has(word)) type = "keyword";
      else if (CONSTANTS.has(word)) type = "constant";
      else if (word === "self" || word === "cls") type = "variable";
      else if (BUILTINS.has(word)) type = "builtin";
      else if (after.startsWith("(")) type = /^[A-Z]/.test(word) ? "type" : "function";
      else if (/^[A-Z][A-Z0-9_]+$/.test(word)) type = "constant";
      else if (/^[A-Z]/.test(word)) type = "type";
      if (type) add(i, end, type);
      i = end;
      continue;
    }

    if ("{}()[]:;,.".includes(c)) {
      add(i, i + 1, "punctuation");
      i++;
      continue;
    }

    // operators, longest match first
    const op = /^(?:\*\*=?|\/\/=?|<<=?|>>=?|->|:=|[-+*/%&|^<>!=~@]=?)/.exec(rest);
    const len = op ? op[0].length : 1;
    add(i, i + len, "operator");
    i += len;
  }

  return { tokens, end: state };
}

/** Index of the closing quote at or after `from`, skipping escaped characters, or -1. */
function findClose(line: string, from: number, quote: string): number {
  for (let i = from; i < line.length; i++) {
    if (line[i] === "\\") i++;
    else if (line.startsWith(quote, i)) return i;
  }
  return -1;
}

// ----- start state of a line -----

// like vim's "syntax sync minlines": look back this many lines for an open docstring
const SYNC_LINES = 500;

// the editor renders lines top to bottom in one go, so the end state of the previous
// line is reused. it is cleared after the frame, edits elsewhere can't leave it stale.
let memo: { lines: readonly string[]; index: number; text: string; end: State } | null = null;
let clearScheduled = false;

function startState(index: number, lines: readonly string[]): State {
  if (memo && memo.lines === lines && memo.index === index - 1 && memo.text === lines[index - 1]) {
    return memo.end;
  }
  let state: State = State.Normal;
  for (let i = Math.max(0, index - SYNC_LINES); i < index; i++) {
    state = tokenize(lines[i], state, false).end;
  }
  return state;
}

function highlightLine(line: string, index: number, lines: readonly string[]): HighlightToken[] {
  const { tokens, end } = tokenize(line, startState(index, lines));
  memo = { lines, index, text: line, end };
  if (!clearScheduled) {
    clearScheduled = true;
    queueMicrotask(() => {
      memo = null;
      clearScheduled = false;
    });
  }
  return tokens;
}

// ----- plugin -----

const plugin: LanguagePlugin = {
  name: "Python",
  extensions: [".py", ".pyi", ".pyw"],

  highlightLine,

  // keep the indent on Enter: one level deeper after ":", one level less after return/pass/...
  onCursorAction(ctx: PluginContext) {
    if (!ctx.action || ctx.action.type !== "newline") return null;

    const curLine = ctx.action.cursor.position.line;
    const prevLine = curLine > 0 ? ctx.lines[curLine - 1] : "";
    let indent = /^\s*/.exec(prevLine)?.[0] ?? "";
    const code = prevLine.replace(/#.*$/, "").trimEnd();
    const unit = ctx.settings.insertSpaces ? " ".repeat(ctx.settings.tabSize) : "\t";

    if (code.endsWith(":")) {
      indent += unit;
    } else if (/^\s*(?:return|pass|break|continue|raise)\b/.test(code) && indent.endsWith(unit)) {
      indent = indent.slice(0, -unit.length);
    }
    if (indent.length === 0) return null;

    return {
      edits: [
        {
          range: { start: { line: curLine, col: 0 }, end: { line: curLine, col: 0 } },
          text: indent,
        },
      ],
      cursors: [{ position: { line: curLine, col: indent.length }, anchor: null }],
    };
  },
};

export default plugin;
export { tokenize, State };
