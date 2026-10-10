/**
 * `contenthero status <ids...>` - where any background job is: a generation or an edit's output, an export, a brand
 * kit read, an avatar, a content analysis, a transcript. Named after the MCP's get_status. Blocks until the jobs
 * finish unless `--no-wait`. An id alone names its job; `--kind` is for a full UUID, a transcript (its id is the
 * media or post it belongs to), or an id the server says is ambiguous.
 *
 * Returns exit 1 if any job failed or any id could not be answered for (every id still prints its own answer), exit 4
 * if any was still running when the timeout elapsed (the ids are still emitted so the caller can keep polling),
 * otherwise 0.
 */

import { Option, type Command } from 'commander'
import { JOB_KINDS, statusTargetOf, type JobKind, type JobStatusResult } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit, keyValues, statusCommandFor } from '../output.js'
import { generationHuman, DEFAULT_TIMEOUT_SEC } from '../generation.js'
import { EXIT } from '../errors.js'
import { toInt } from '../args.js'

/** One job for a person: a generation keeps its own rendering, every other kind its state, progress and steps. */
export function statusHuman(s: JobStatusResult): string {
  if (s.state === 'unanswered') return keyValues([['Id', s.id], ['State', 'unanswered'], ['Reason', s.reason]])
  if (s.kind === 'output') return generationHuman(s.detail)
  const pairs: Array<[string, string | number]> = [
    ['Id', s.id],
    ['Kind', s.kind],
    ['State', s.state],
  ]
  if (s.reason) pairs.push(['Reason', s.reason])
  if (s.progress !== null && s.progress !== undefined) pairs.push(['Progress', `${Math.round(s.progress * 100)}%`])
  for (const step of s.steps ?? []) pairs.push([`Step ${step.name}`, step.reason ? `${step.state} (${step.reason})` : step.state])
  if (s.appUrl) pairs.push(['App', s.appUrl])
  if (s.state !== 'completed' && s.state !== 'failed') {
    pairs.push(['Next', statusCommandFor([statusTargetOf(s)])])
  }
  return keyValues(pairs)
}

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('Show where background jobs are; blocks until they finish unless --no-wait')
    .argument('<ids...>', 'one or more job ids, each as the command that started it returned')
    .addOption(
      new Option('--kind <kind>', 'which kind of job the ids name; only for a full UUID, a transcript, or an ambiguous id').choices([
        ...JOB_KINDS,
      ]),
    )
    .option('--no-wait', 'take an instant snapshot instead of blocking')
    .option('--timeout <seconds>', 'how long to block before handing back', toInt, DEFAULT_TIMEOUT_SEC)
    .action(async (ids: string[], opts: { kind?: JobKind; wait?: boolean; timeout?: number }, command: Command) => {
      const { client, ctx } = makeClient(command)
      const blocking = opts.wait !== false
      const timeoutSec = opts.timeout ?? DEFAULT_TIMEOUT_SEC
      const targets = ids.map((id) => ({ id, kind: opts.kind }))

      // The SDK's one rule for several: each id answers on its own, finished, as last read at the deadline, or
      // unanswered with the server's reason, so one unknown id never hides the others.
      const results: JobStatusResult[] = blocking
        ? await client.waitForStatus(targets, { timeoutMs: timeoutSec * 1000 })
        : await client.getStatuses(targets)

      emit(results, ctx, (rows: JobStatusResult[]) => rows.map(statusHuman).join('\n\n'))

      if (results.some((s) => s.state === 'failed' || s.state === 'unanswered')) {
        process.exitCode = EXIT.GENERAL
      } else if (results.some((s) => s.state !== 'completed')) {
        process.exitCode = EXIT.TIMEOUT
      }
    })
}
