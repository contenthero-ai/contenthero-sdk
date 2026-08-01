/**
 * `contenthero audio ...` - audio editing (existing audio -> audio).
 *
 * The sibling of `generate` for the audio-transform shape. `audio isolate`
 * removes background noise and music from a recording, leaving clean speech.
 * Isolation is synchronous (the processed URL comes back inline); --cost previews
 * the credit charge without running.
 */

import type { Command } from 'commander'
import type { EditAudioRequest } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { compact, runEditAudio } from '../generation.js'
import { toFloat, toInt, toJson } from '../args.js'

const VOICE_ISOLATION_MODEL_ID = 'elevenlabs-voice-isolator'
const AUDIO_ENHANCE_MODEL_ID = 'auphonic-enhance'
const DEFAULT_TIMEOUT_SEC = 600

export function registerAudio(program: Command): void {
  const audio = program.command('audio').description('Audio editing (existing audio -> audio)')

  audio
    .command('isolate')
    .description('Isolate vocals from an audio file (remove background noise and music)')
    .argument('<source>', 'source audio (URL or output id) to isolate')
    .option('--duration <seconds>', 'source audio length in seconds (required for --cost)', toFloat)
    .option('--project <id>', 'editor project to place the result on (omit for a standalone library output)')
    .option('--placement <json>', 'placement intent as JSON, e.g. {"mode":"atPlayhead"} (omit to place at the playhead when known, else append)', toJson)
    .option('--playhead <frame>', 'current playhead frame, for playhead-relative placement', toInt)
    .option('--cost', 'estimate the credit cost instead of running')
    .option('--no-wait', 'return the outputId immediately instead of waiting')
    .option('--timeout <seconds>', 'how long to wait before handing back the outputId', toInt, DEFAULT_TIMEOUT_SEC)
    .action(async (source: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const request = compact<EditAudioRequest>({
        modelId: VOICE_ISOLATION_MODEL_ID,
        sourceUrl: source,
        durationSeconds: opts.duration as number | undefined,
        projectId: opts.project as string | undefined,
        placement: opts.placement as EditAudioRequest['placement'],
        playheadFrame: opts.playhead as number | undefined,
      })
      await runEditAudio(client, ctx, request, {
        cost: opts.cost === true,
        wait: opts.wait !== false,
        timeoutSec: (opts.timeout as number) ?? DEFAULT_TIMEOUT_SEC,
      })
    })

  audio
    .command('enhance')
    .description('Enhance an audio file (level loudness, clean up background noise). Asynchronous.')
    .argument('<source>', 'source audio (URL or output id) to enhance')
    .option('--duration <seconds>', 'source audio length in seconds (required for --cost, and when the source is not a stored ContentHero asset)', toFloat)
    .option('--cost', 'estimate the credit cost instead of running')
    .option('--no-wait', 'return the outputId immediately instead of waiting')
    .option('--timeout <seconds>', 'how long to wait before handing back the outputId', toInt, DEFAULT_TIMEOUT_SEC)
    .action(async (source: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const request = compact<EditAudioRequest>({
        modelId: AUDIO_ENHANCE_MODEL_ID,
        sourceUrl: source,
        durationSeconds: opts.duration as number | undefined,
      })
      await runEditAudio(client, ctx, request, {
        cost: opts.cost === true,
        wait: opts.wait !== false,
        timeoutSec: (opts.timeout as number) ?? DEFAULT_TIMEOUT_SEC,
      })
    })
}
