/**
 * Output rendering. JSON is the default (agent-first); `--human` opts into a
 * compact table / key-value rendering. A command supplies both: the raw data
 * (always the JSON form) and a `human` formatter used only under --human.
 */

import pc from 'picocolors'

/** Print a result: pretty JSON by default, the human formatter under --human. */
export function emit(
  data: unknown,
  opts: { json: boolean },
  human?: (data: never) => string,
): void {
  if (!opts.json && human) {
    process.stdout.write(human(data as never) + '\n')
  } else {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n')
  }
}

/** A two-space-gutter, left-aligned table with a dim header row. */
export function table(headers: string[], rows: Array<Array<string | number>>): string {
  const cells = rows.map((r) => r.map((c) => String(c ?? '')))
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...cells.map((r) => (r[i] ?? '').length), 0),
  )
  const line = (vals: string[]) => vals.map((v, i) => v.padEnd(widths[i] ?? 0)).join('  ').trimEnd()
  const out = [pc.dim(line(headers))]
  for (const r of cells) out.push(line(r))
  return out.join('\n')
}

/** A `key: value` block, keys dim and right-padded to align. */
export function keyValues(pairs: Array<[string, string | number | boolean]>): string {
  const width = Math.max(...pairs.map(([k]) => k.length), 0)
  return pairs
    .map(([k, v]) => `${pc.dim((k + ':').padEnd(width + 1))} ${String(v)}`)
    .join('\n')
}
