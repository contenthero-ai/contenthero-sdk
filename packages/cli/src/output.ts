/**
 * Output rendering. JSON is the default (agent-first); `--human` opts into a
 * compact table / key-value rendering. A command supplies both: the raw data
 * (always the JSON form) and a `human` formatter used only under --human.
 */

import pc from 'picocolors'
import { describeCharge, type Charge } from '@contenthero/sdk'

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

/**
 * The id a person sees for an item: its short id, the one the app shows and copies, and which every command accepts
 * back. With none (a type that has no short id, or an older server) the full id, never a truncated one: a UUID's
 * first 8 characters resolve only as a media token, so a list that printed them handed people ids most commands
 * refuse. `--json` keeps both fields untouched.
 */
export function displayId(item: { id: string; shortId?: string | null }): string {
  return item.shortId || item.id
}

/**
 * The item's app link as a key-value row, after its Id. The link is the server's `appUrl`; with none (a type that
 * has no page, or an older server) there is no row rather than a guessed url.
 */
export function linkRow(item: { appUrl?: string | null }): Array<[string, string]> {
  return item.appUrl ? [['App URL', item.appUrl]] : []
}

/** The cost row for a paid result, labeled by the SDK's one wording ("Cost" or "Estimated cost"); none without a receipt. */
export function costRows(charge: Charge | null | undefined): Array<[string, string]> {
  const cost = describeCharge(charge)
  return cost ? [[cost.label, cost.text]] : []
}
