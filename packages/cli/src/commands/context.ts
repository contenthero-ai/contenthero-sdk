/**
 * `contenthero context` - read the LIVE context of what the user is currently viewing in the open app.
 *
 *   context [--project <id>] [--capture] [--save <path>]                  (requires context:read)
 *
 * Returns the most-recent-active session's surface + focus + selection, plus the live participant set.
 * Structured by default; `--capture` also pings the live tab for a fresh viewport screenshot (a short-lived
 * snapshotUrl). `--save` downloads that snapshot to a file (implies you passed --capture).
 */
import { writeFileSync } from 'node:fs'
import type { Command } from 'commander'
import { makeClient } from '../context.js'
import { emit } from '../output.js'
import { CliError, EXIT } from '../errors.js'

export function registerContext(program: Command): void {
  program
    .command('context')
    .description('Read what the user is currently viewing in the open app (requires context:read)')
    .option('--project <id>', 'scope to a specific project (editor/canvas)')
    .option('--capture', 'also capture a fresh screenshot of the live viewport (slower; briefly disturbs the page)')
    .option('--save <path>', 'download the captured viewport snapshot to this file (implies --capture)')
    .action(async (opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      // --save needs an image, so it implies --capture.
      const capture = Boolean(opts.capture) || Boolean(opts.save)
      const result = await client.getContext({ projectId: opts.project as string | undefined, capture })

      if (opts.save) {
        const url = typeof result.context?.snapshotUrl === 'string' ? result.context.snapshotUrl : null
        if (!url) throw new CliError('No snapshot available for the current context.', EXIT.USAGE)
        const res = await fetch(url)
        if (!res.ok) throw new CliError(`Failed to download snapshot (HTTP ${res.status}).`, EXIT.GENERAL)
        writeFileSync(opts.save as string, Buffer.from(await res.arrayBuffer()))
      }

      emit(result, ctx, () => {
        if (!result.context || !result.participant) return 'No live context: no one is currently viewing this in the app.'
        const c = result.context as Record<string, unknown>
        const saved = opts.save ? `\nSnapshot saved to ${String(opts.save)}` : ''
        return (
          `Live context on the ${String(c.surface)} surface (updated ${result.participant.updatedAt}).\n` +
          `${result.participants.length} live participant(s).` +
          saved
        )
      })
    })
}
