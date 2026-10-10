/**
 * `contenthero transcribe <audioUrl>` - speech-to-text for an audio URL.
 *
 * Synchronous (no polling). Returns the transcript plus its language, word count and
 * the credits it cost; the result is also saved as a studio output, referenceable by
 * its outputId (see `contenthero media`). It is NOT free: transcription is metered per
 * minute, and only a user on their own ElevenLabs key is charged nothing.
 */

import { costRows } from '../output.js'
import type { Command } from 'commander'
import type { Transcription } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { displayId, emit, keyValues, linkRow } from '../output.js'

export function registerTranscribe(program: Command): void {
  program
    .command('transcribe')
    .description('Transcribe an audio URL to text (speech-to-text)')
    .argument('<audioUrl>', 'public URL of the audio to transcribe')
    .option('--language <code>', 'ISO language hint, e.g. en (auto-detected when omitted)')
    .option('--diarize', 'label each speaker (diarization)')
    .action(async (audioUrl: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const t = await client.transcribe({
        audioUrl,
        languageCode: opts.language as string | undefined,
        diarize: opts.diarize === true,
      })
      emit(t, ctx, (r: Transcription) =>
        keyValues([
          ['Output id', displayId({ id: r.outputId, shortId: r.shortId })],
          ...linkRow(r),
          ['Language', r.language],
          ['Words', r.wordCount],
          ...(r.durationSeconds != null
            ? [['Duration (s)', r.durationSeconds] as [string, number]]
            : []),
          ...costRows(r.charge),
          ['Transcript', r.transcript],
        ]),
      )
    })
}
