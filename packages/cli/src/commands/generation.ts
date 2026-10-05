/**
 * `contenthero generation` - poll in-flight generations.
 *   generation status <id>      one-shot snapshot of an outputId
 *   generation wait <id...>     block until one or more finish (batch)
 *
 * `wait` returns exit 1 if any generation failed, exit 4 if any was still
 * running when the timeout elapsed (the outputIds are still emitted so the
 * caller can keep polling), otherwise 0.
 */

import type { Command } from 'commander'
import type { Generation } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit } from '../output.js'
import { generationHuman, DEFAULT_TIMEOUT_SEC } from '../generation.js'
import { EXIT } from '../errors.js'
import { toInt } from '../args.js'


export function registerGeneration(program: Command): void {
  const generation = program
    .command('generation')
    .description('Check in-flight generations')

  generation
    .command('status')
    .description('Show one or more generations; blocks until they finish unless --no-wait')
    .argument('<id...>', 'one or more outputIds from a generate / upscale command')
    .option('--no-wait', 'take an instant snapshot instead of blocking')
    .option('--timeout <seconds>', 'how long to block before handing back', toInt, DEFAULT_TIMEOUT_SEC)
    .action(async (ids: string[], opts: { wait?: boolean; timeout?: number }, command: Command) => {
      const { client, ctx } = makeClient(command)
      // `generation wait` used to be a separate command. It was `status` over an array with blocking on, so
      // the two differed by a default rather than by what they did.
      const blocking = opts.wait !== false
      const timeoutSec = opts.timeout ?? DEFAULT_TIMEOUT_SEC

      // The SDK's one rule for several: each settled, failed, or as last read at the deadline, with no second read.
      const results: Generation[] = blocking
        ? await client.waitForGenerations(ids, { timeoutMs: timeoutSec * 1000 })
        : await Promise.all(ids.map((id) => client.getGeneration(id)))

      emit(results, ctx, (rows: Generation[]) => rows.map(generationHuman).join('\n\n'))

      if (results.some((g) => g.status === 'failed')) {
        process.exitCode = EXIT.GENERAL
      } else if (results.some((g) => g.status !== 'completed')) {
        process.exitCode = EXIT.TIMEOUT
      }
    })
}
