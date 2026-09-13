import type { CommandDefinition } from '@orbit/core';

/**
 * Local fuzzy match over command titles and keywords: no index, a few
 * dozen commands, scored so the obvious command comes first ("plan" →
 * "Plan my day"). Recent commands break ties.
 */
export interface ScoredCommand {
  command: CommandDefinition;
  score: number;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '');
}

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (const ch of hay) {
    if (ch === needle[i]) i += 1;
    if (i === needle.length) return true;
  }
  return needle.length === 0;
}

export function scoreCommand(command: CommandDefinition, query: string): number {
  const q = normalize(query.trim());
  if (!q) return 1;
  const title = normalize(command.title);
  if (title === q) return 100;
  if (title.startsWith(q)) return 90;
  const words = title.split(/\s+/u);
  if (words.some((w) => w.startsWith(q))) return 80;
  const keywords = command.keywords.map(normalize);
  if (keywords.some((k) => k.startsWith(q))) return 70;
  if (title.includes(q)) return 60;
  if (keywords.some((k) => k.includes(q))) return 50;
  // Every query word must start some title or keyword word ("plan day" → "Plan my day").
  const parts = q.split(/\s+/u);
  if (parts.length > 1 && parts.every((p) => [...words, ...keywords].some((w) => w.startsWith(p))))
    return 45;
  if (q.length >= 3 && isSubsequence(q, title.replace(/\s+/gu, ''))) return 30;
  return 0;
}

export function matchCommands(
  commands: readonly CommandDefinition[],
  query: string,
  recent: readonly string[] = [],
): ScoredCommand[] {
  const rank = (id: string) => {
    const i = recent.indexOf(id);
    return i === -1 ? recent.length : i;
  };
  return commands
    .map((command) => ({ command, score: scoreCommand(command, query) }))
    .filter((s) => s.score > 0)
    .map((s, index) => ({ ...s, index }))
    .sort(
      (a, b) => b.score - a.score || rank(a.command.id) - rank(b.command.id) || a.index - b.index,
    )
    .map(({ command, score }) => ({ command, score }));
}
