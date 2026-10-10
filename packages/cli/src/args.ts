/**
 * Small commander option coercers. They throw a usage-coded CliError on bad
 * input so the central error boundary reports exit 2 with a clear message.
 */

import { Option, type Command } from 'commander'
import { PLACEMENT_ENDS, SORT_ORDERS, type Loudness, type Placement, type PlacementEnd } from '@contenthero/sdk'
import { CliError, EXIT } from './errors.js'

/** Parse an integer option value. */
export function toInt(value: string): number {
  const n = Number(value)
  if (!Number.isInteger(n)) {
    throw new CliError(`Expected an integer, got "${value}".`, EXIT.USAGE)
  }
  return n
}

/**
 * The paging flags every paged list takes (9.7b), in one wording: how many, and the cursor the page before printed
 * (`moreLine`). The server owns the default and the maximum.
 */
export function withPageFlags(command: Command): Command {
  return command
    .option('--limit <n>', 'how many to return', toInt)
    .option('--cursor <cursor>', "the previous page's cursor")
}

/**
 * The sort flags every sortable list takes (9.9), in one wording: a field of that list (its `LIST_SORTS` entry, so the
 * choices are the API's) and a direction. The server owns the default; a value outside the choices is a usage error.
 */
export function withSortFlags(command: Command, fields: readonly string[]): Command {
  return command
    .addOption(new Option('--sort <field>', 'the field to sort by').choices(fields))
    .addOption(new Option('--order <order>', 'the sort direction').choices(SORT_ORDERS))
}

/**
 * The placement flags every hand-arranged list takes (9.9, the ordering contract), in one wording: the item it lands
 * after or before, or an end. Neighbors and an end together are refused by the server. Read back with `placementFrom`.
 */
export function withPlacementFlags(command: Command): Command {
  return command
    .option('--after <id>', 'place it immediately after this item of the same list')
    .option('--before <id>', 'place it immediately before this item of the same list')
    .addOption(new Option('--position <end>', 'place it at an end of the list instead of beside an item').choices(PLACEMENT_ENDS))
}

/** The placement `withPlacementFlags` read, with only the flags given. */
export function placementFrom(opts: Record<string, unknown>): Placement {
  return {
    ...(opts.after !== undefined ? { afterId: opts.after as string } : {}),
    ...(opts.before !== undefined ? { beforeId: opts.before as string } : {}),
    ...(opts.position !== undefined ? { position: opts.position as PlacementEnd } : {}),
  }
}

/** Parse a numeric option value (integer or decimal). */
export function toFloat(value: string): number {
  const n = Number(value)
  if (Number.isNaN(n)) {
    throw new CliError(`Expected a number, got "${value}".`, EXIT.USAGE)
  }
  return n
}

/**
 * Parse a loudness option value: a target integrated loudness in LUFS, or `off`. The server owns the range it
 * accepts and states it when it refuses a number, so no range is checked here.
 */
export function toLoudness(value: string): Loudness {
  if (value.trim().toLowerCase() === 'off') return 'off'
  const n = Number(value)
  if (value.trim() === '' || !Number.isFinite(n)) {
    throw new CliError(`Expected a loudness in LUFS or "off", got "${value}".`, EXIT.USAGE)
  }
  return n
}

/** Collect a repeatable option (e.g. --ref a --ref b) into an array. */
export function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value]
}

/**
 * Split a comma-separated option (--tags a,b) into its non-empty items. The ONE parser for list flags: it was
 * written out three times (card tags, content analysis sections, media kinds) before this.
 */
export function toList(value: string): string[] {
  return value.split(',').map((s) => s.trim()).filter(Boolean)
}

/** The words that clear a value rather than set it (`--schedule clear`, `--title-font none`). One list for every flag. */
export const CLEAR_WORDS = ['null', 'clear', 'none'] as const

/** Whether an option value asks to clear the field. */
export function isClear(value: unknown): boolean {
  return (CLEAR_WORDS as readonly string[]).includes(String(value).toLowerCase())
}

/** Parse a JSON option value into an unknown, with a usage error on bad JSON. */
export function toJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    throw new CliError(`Expected valid JSON, got "${value}".`, EXIT.USAGE)
  }
}
