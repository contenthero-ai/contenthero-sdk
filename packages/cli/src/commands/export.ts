/**
 * `contenthero export` - render a project into a file (the MCP's `export`), the counterpart of `contenthero import`.
 *
 *   export <projectId> [--format mp4|png|jpg|pdf|pptx] [--resolution <r>] [--frame <n>] [--no-watermark] [--loudness <lufs|off>] [--wait]
 *   export get <exportId>                                        one export: its file, state and details (requires editor:read)
 *   export list <projectId> [--limit] [--cursor]                 its exports, newest first (requires editor:read)
 */
import type { Command } from 'commander'
import {
  GenerationTimeoutError,
  describeExportShareLink,
  withCodeWarnings,
  withExportLoudness,
  type ExportJob,
  type ExportListResult,
  type Loudness,
} from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit, statusCommand, table, withMore } from '../output.js'
import { EXIT } from '../errors.js'
import { toInt, toLoudness, withPageFlags } from '../args.js'

export function registerExport(program: Command): void {
  const exportCommand = program
    .command('export')
    .description('Export a project to a file: video, stills, documents, and for an editor project its sound, subtitles and transcript (`contenthero schema get export` lists every format) (requires editor:write)')
    .argument('<projectId>', 'the project id')
    .option('--format <format>', 'a format `contenthero schema get export` lists (default mp4)')
    .option('--resolution <res>', 'output resolution for ANY format: 480p|720p|1080p|2k|4k. Defaults 720p for an editor mp4, the project native size for a still. 1080p+ is plan-gated')
    .option('--quality <q>', 'mp4 quality: low|recommended|high')
    .option('--frame <n>', 'editor still (png/jpg) only: timeline frame to render (default 0)', toInt)
    .option('--no-watermark', 'remove the watermark (plan-gated)')
    .option('--loudness <lufs|off>', "video and sound only: this export's loudness, a target in LUFS or off, in place of the project's own (default the project's)", toLoudness)
    .option('--max-chars-per-line <n>', 'subtitles only: longest line, 20 to 80 characters (default 42)', toInt)
    .option('--max-lines-per-card <n>', 'subtitles only: lines per card, 1 to 4 (default 2)', toInt)
    .option('--show-speakers', 'subtitles only: name who speaks, when there is more than one speaker')
    .option('--timecodes', 'transcripts only: start each paragraph with its timecode')
    .option('--wait', 'poll until the export finishes and print the URL')
    .option('--timeout <ms>', 'max wait when --wait (default 600000)', toInt)
    .action(async (projectId: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const input = {
        format: opts.format as string | undefined,
        resolution: opts.resolution as string | undefined,
        quality: opts.quality as string | undefined,
        ...(opts.frame !== undefined ? { frame: opts.frame as number } : {}),
        ...(opts.maxCharsPerLine !== undefined ? { maxCharsPerLine: opts.maxCharsPerLine as number } : {}),
        ...(opts.maxLinesPerCard !== undefined ? { maxLinesPerCard: opts.maxLinesPerCard as number } : {}),
        ...(opts.showSpeakers ? { showSpeakers: true } : {}),
        ...(opts.timecodes ? { timecodes: true } : {}),
        // commander sets opts.watermark=false when --no-watermark is passed; leave undefined otherwise.
        ...(opts.watermark === false ? { watermark: false } : {}),
        ...(opts.loudness !== undefined ? { loudness: opts.loudness as Loudness } : {}),
      }
      let job: ExportJobView
      try {
        job = opts.wait
          ? await client.exportProjectAndWait(projectId, input, { timeoutMs: (opts.timeout as number | undefined) ?? 600000 })
          : await client.startExport(projectId, input)
      } catch (err) {
        // Still running when the wait ended: the export is not lost, so name it and how to wait, and exit TIMEOUT.
        if (!(err instanceof GenerationTimeoutError)) throw err
        job = { exportId: err.outputId, shortId: err.shortId, appUrl: err.appUrl, status: 'rendering' }
        process.exitCode = EXIT.TIMEOUT
      }
      emit(job, ctx, () => exportHuman(job))
    })

  /*
    `export <projectId>` runs the export, and `export get` / `export list` are its subcommands
    (get_export and list_exports). Commander dispatches to a subcommand when the first operand names one, and
    otherwise runs the export with it as the project id.
  */
  exportCommand
    .command('get')
    .description('Read one export by id: its file, state and details; wait for one with `contenthero status --kind export` (requires editor:read)')
    .argument('<exportId>', 'the export id')
    .action(async (exportId: string, _opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const job = await client.getExport(exportId)
      emit(job, ctx, () => exportHuman(job))
    })

  withPageFlags(
    exportCommand
      .command('list')
      .description("List a project's exports, newest first: finished ones with their download and share page, running ones with their status (requires editor:read)")
      .argument('<projectId>', 'the project id'),
  ).action(async (projectId: string, opts: Record<string, unknown>, command: Command) => {
    const { client, ctx } = makeClient(command)
    const page = await client.listExports(projectId, { limit: opts.limit as number | undefined, cursor: opts.cursor as string | undefined })
    emit(page, ctx, (p: ExportListResult) =>
      p.exports.length === 0
        ? 'No exports.'
        : withMore(
            table(
              ['ID', 'CREATED', 'TYPE', 'STATUS', 'TITLE', 'SHARE PAGE'],
              p.exports.map((e) => [e.shortId || e.exportId, e.createdAt, e.exportType ?? '', e.status, e.title ?? '', e.shareUrl ?? '']),
            ),
            p.nextCursor,
          ),
    )
  })
}

/** An export as the CLI names it, from a start, a wait or a read: all an ended wait knows is what the start returned. */
type ExportJobView = Omit<ExportJob, 'shortId' | 'appUrl'> & { shortId?: string | null; appUrl?: string | null }

/**
 * One export for a person, the same from `export` and `export get`: its id and link, then its file
 * and share page once finished, its progress and how to wait while it runs, or why it failed.
 */
function exportHuman(job: ExportJobView): string {
  const head = `Export ${job.shortId || job.exportId}${job.appUrl ? ` (${job.appUrl})` : ''}`
  if (job.status === 'completed') {
    const share = describeExportShareLink(job.shareUrl)
    return withCodeWarnings(withExportLoudness(`${head} completed: ${job.outputUrl}${share ? `\n${share}` : ''}`, job.loudness), job.warnings)
  }
  if (job.status === 'failed') return withCodeWarnings(`${head} failed: ${job.errorMessage ?? 'unknown error'}`, job.warnings)
  const progress = typeof job.progress === 'number' ? ` (${Math.round(job.progress * 100)}%${job.stage ? `, ${job.stage}` : ''})` : ''
  const wait = statusCommand([{ id: job.exportId, shortId: job.shortId, kind: 'export' }])
  return withCodeWarnings(`${head} is ${job.status}${progress}. Wait: ${wait}`, job.warnings)
}
