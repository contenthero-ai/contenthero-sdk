/**
 * `contenthero editor` - read + edit a project's composition (canvas slides or editor timeline) via ops.
 *
 *   editor get   <projectId>                              (requires editor:read)
 *   editor apply <projectId> --ops <json> | --ops-file <path> [--intent <text>] [--expected-revision <n>]
 *
 * Ops are the shared editor/canvas op vocabulary (the same the manual UI + in-app agent use). Read first
 * with `editor get` to learn the current state + revision, then pass that revision as --expected-revision
 * for safe concurrent edits. All edits require the editor:write scope.
 */
import { readFileSync } from 'node:fs'
import type { Command } from 'commander'
import type { EditorOp } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit } from '../output.js'
import { CliError, EXIT } from '../errors.js'
import { toInt } from '../args.js'

function parseOps(raw: string): EditorOp[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new CliError(
      `Invalid ops JSON: ${e instanceof Error ? e.message : 'parse error'}. Expected a JSON array of op objects.`,
      EXIT.USAGE,
    )
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new CliError('Ops must be a non-empty JSON array of op objects.', EXIT.USAGE)
  }
  return parsed as EditorOp[]
}

export function registerEditor(program: Command): void {
  const editor = program
    .command('editor')
    .description("Read + edit a project's composition (canvas or timeline) via ops")

  editor
    .command('get')
    .description("Read a project's composition + revision (requires editor:read)")
    .argument('<projectId>', 'the project id')
    .action(async (projectId: string, _opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const comp = await client.getEditorComposition(projectId)
      emit(comp, ctx, () => `Project ${comp.projectId} (${comp.kind}, ${comp.surface}), revision ${comp.revision}`)
    })

  editor
    .command('apply')
    .description('Apply a batch of ops to a project composition (requires editor:write)')
    .argument('<projectId>', 'the project id')
    .option('--ops <json>', 'the ops as a JSON array string')
    .option('--ops-file <path>', 'read the ops JSON array from a file')
    .option('--intent <text>', 'a short description of the edit (for attribution)')
    .option('--expected-revision <n>', 'revision for optimistic concurrency (from `editor get`)', toInt)
    .action(async (projectId: string, opts: Record<string, unknown>, command: Command) => {
      const raw = opts.opsFile ? readFileSync(opts.opsFile as string, 'utf8') : (opts.ops as string | undefined)
      if (!raw) throw new CliError('Provide --ops <json> or --ops-file <path>.', EXIT.USAGE)
      const ops = parseOps(raw)
      const { client, ctx } = makeClient(command)
      const result = await client.applyEditorOps({
        projectId,
        ops,
        userIntent: opts.intent as string | undefined,
        expectedRevision: opts.expectedRevision as number | undefined,
      })
      emit(result, ctx, () => {
        const ok = result.results.filter((r) => r.ok).length
        return `Applied ${ok}/${result.results.length} ${result.surface} op(s). New revision: ${result.revision}.`
      })
    })
}
