/**
 * `contenthero transcribe [audioUrl]` - speech-to-text, from one source:
 *
 * - an audio URL: synchronous, and saved as a studio output referenceable by its outputId (see
 *   `contenthero media`). Metered by the length heard, and `--cost` prices it first from the file's own length; only
 *   a user on their own ElevenLabs key is charged nothing.
 * - a tracked post's video (`--content-id`, `--slide` for a carousel's video) once `content analyze --kind video`
 *   has downloaded it, word by word. `--cost` prices it first. A long video runs past one request: this waits by
 *   asking again with the same post, which is free, and exits 4 when it is still running at the end of the wait.
 */

import type { Command } from 'commander'
import { describeTranscribeCost, describeTranscriptionState, transcriptionSource, type TranscribeCostEstimate, type Transcription } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { costRows, displayId, emit, keyValues, linkRow } from '../output.js'
import { CliError, EXIT } from '../errors.js'
import { toInt } from '../args.js'

/** How long to follow a post's transcription by default, in seconds. Each ask itself waits on the server. */
const TRANSCRIBE_TIMEOUT_SEC = 600

export function registerTranscribe(program: Command): void {
  program
    .command('transcribe')
    .description("Transcribe speech to text: an audio URL, or a tracked post's downloaded video with --content-id (spends credits; price it first with --cost)")
    .argument('[audioUrl]', 'public URL of the audio to transcribe (or name a post with --content-id)')
    .option('--content-id <id>', "a tracked post whose video to transcribe, once content analyze --kind video has downloaded it")
    .option('--slide <n>', "which video of a carousel post, by the 0-based slide content analyze reports (with --content-id)", toInt)
    .option('--cost', 'show what transcribing costs instead of transcribing (nothing runs, nothing is charged)')
    .option('--language <code>', 'ISO language hint for an audio file (auto-detected when omitted)')
    .option('--diarize', 'label each speaker (diarization), for an audio file')
    .option('--no-wait', "return at once while a post's transcription is still running")
    .option('--timeout <sec>', `how long to follow a post's transcription (default ${TRANSCRIBE_TIMEOUT_SEC})`, toInt)
    .action(async (audioUrl: string | undefined, opts: Record<string, unknown>, command: Command) => {
      const contentId = (opts.contentId as string | undefined)?.trim()
      if (!!audioUrl === !!contentId) throw new CliError('Pass exactly one source: an audio URL, or --content-id for a tracked post.', EXIT.USAGE)
      if (audioUrl && opts.slide !== undefined) throw new CliError("--slide picks a carousel post's video: name the post with --content-id.", EXIT.USAGE)
      if (contentId && (opts.language !== undefined || opts.diarize)) {
        throw new CliError("--language and --diarize apply to an audio file; a post's language is detected from its video.", EXIT.USAGE)
      }
      const { client, ctx } = makeClient(command)

      if (contentId) {
        const post = { contentId, ...(opts.slide !== undefined ? { slide: opts.slide as number } : {}) }
        if (opts.cost) {
          emit(await client.estimateTranscribeCost(post), ctx, (e: TranscribeCostEstimate) => describeTranscribeCost(e))
          return
        }
        // Asking again with the same post follows a running transcription, free; the server waits on each ask.
        const deadline = Date.now() + ((opts.timeout as number | undefined) ?? TRANSCRIBE_TIMEOUT_SEC) * 1000
        let t = await client.transcribe(post)
        while (opts.wait !== false && t.status === 'running' && Date.now() < deadline) t = await client.transcribe(post)
        emit(t, ctx, transcriptionHuman)
        if (t.status === 'running' && opts.wait !== false) process.exitCode = EXIT.TIMEOUT
        if (t.status === 'failed') process.exitCode = EXIT.GENERAL
        return
      }

      if (opts.cost) {
        emit(await client.estimateTranscribeCost({ audioUrl: audioUrl as string }), ctx, (e: TranscribeCostEstimate) => describeTranscribeCost(e))
        return
      }
      const t = await client.transcribe({
        audioUrl: audioUrl as string,
        languageCode: opts.language as string | undefined,
        diarize: opts.diarize === true,
      })
      emit(t, ctx, transcriptionHuman)
    })
}

/** A transcription under --human: the transcript with its source and cost, or where it stands and how to follow it. */
export function transcriptionHuman(t: Transcription): string {
  const post = transcriptionSource(t)
  const state = describeTranscriptionState(t)
  if (t.status === 'running') {
    const again = `contenthero transcribe --content-id ${t.contentId}${t.slide !== undefined ? ` --slide ${t.slide}` : ''}`
    return keyValues([['Status', `${state} Run \`${again}\` again to follow it, which is free.`], ...costRows(t.charge)])
  }
  if (t.status === 'failed') return keyValues([['Status', state ?? t.error], ...costRows(t.charge)])
  return keyValues([
    ...(t.outputId ? [['Output id', displayId({ id: t.outputId, shortId: t.shortId })] as [string, string]] : []),
    ...(post ? [['Post', post] as [string, string]] : []),
    ...linkRow(t),
    ...(t.language ? [['Language', t.language] as [string, string]] : []),
    ['Words', t.wordCount],
    ...(t.durationSeconds != null ? [['Duration (s)', t.durationSeconds] as [string, number]] : []),
    ...costRows(t.charge),
    ['Transcript', post && t.wordCount === 0 ? 'No speech was heard.' : t.transcript],
    ...(post && t.slide === undefined ? [['Read it word-timed', `contenthero content get ${t.contentId} --transcript segments`] as [string, string]] : []),
  ])
}
