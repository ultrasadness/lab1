// The imports a TypeScript file holds, read from its text, for the two checks that keep imports in bounds:
// scripts/bot-imports.test.ts and scripts/bot-test-imports.test.ts. It reads the specifier after `from` in an import or
// export statement, across the lines of the statement; an import for its side effects; and import(). A `from` anywhere
// else is no import: in a comment, a string, or code such as `header('from')`. The looser pattern before #57's retro
// read each of those as one, and the bot's code was bent to get past it. So did a quoted `'from'` in an export, as a
// type naming the field (#61's retro): a `from` right after a quote or inside a word starts no specifier, and a
// specifier never spans lines.
const IMPORT = /^[ \t]*(?:import|export)\b[^;]*?(?<![\w$'"`])from\s*['"`]([^'"`\n]+)['"`]|^[ \t]*import\s*['"`]([^'"`\n]+)['"`]|\bimport\s*\(\s*['"`]([^'"`\n]+)['"`]/gm;

/** Each import in `source`, with the line its statement starts on. */
export function importsIn(source: string): { specifier: string; line: number }[] {
  return [...source.matchAll(IMPORT)].map((match) => ({
    specifier: (match[1] ?? match[2] ?? match[3])!,
    line: source.slice(0, match.index).split('\n').length,
  }));
}
