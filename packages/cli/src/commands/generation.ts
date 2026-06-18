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
import { GenerationTimeoutError, type Generation } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit } from '../output.js'
import { generationHuman } from '../generation.js'
import { EXIT } from '../errors.js'
import { toInt } from '../args.js'

const DEFAULT_TIMEOUT_SEC = 600

export function registerGeneration(program: Command): void {
  const generation = program
    .command('generation')
    .description('Poll in-flight generations (status / wait)')

  generation
    .command('status')
    .description('Show the current status and URLs of a generation by its outputId')
    .argument('<id>', 'the outputId from a generate / upscale command')
    .action(async (id: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const gen = await client.getGeneration(id)
      emit(gen, ctx, generationHuman)
    })

  generation
    .command('wait')
    .description('Wait for one or more generations to finish, then show their URLs')
    .argument('<id...>', 'one or more outputIds to wait on')
    .option('--no-wait', 'take an instant snapshot instead of blocking')
    .option('--timeout <seconds>', 'how long to block before handing back', toInt, DEFAULT_TIMEOUT_SEC)
    .action(async (ids: string[], opts: { wait?: boolean; timeout?: number }, command: Command) => {
      const { client, ctx } = makeClient(command)
      const blocking = opts.wait !== false
      const timeoutSec = opts.timeout ?? DEFAULT_TIMEOUT_SEC

      const results: Generation[] = await Promise.all(
        ids.map(async (id) => {
          if (!blocking) return client.getGeneration(id)
          try {
            return await client.waitForGeneration(id, { timeoutMs: timeoutSec * 1000 })
          } catch (err) {
            if (err instanceof GenerationTimeoutError) return client.getGeneration(id)
            throw err
          }
        }),
      )

      emit(results, ctx, (rows: Generation[]) => rows.map(generationHuman).join('\n\n'))

      if (results.some((g) => g.status === 'failed')) {
        process.exitCode = EXIT.GENERAL
      } else if (results.some((g) => g.status !== 'completed')) {
        process.exitCode = EXIT.TIMEOUT
      }
    })
}
