/**
 * `contenthero media` - the account's studio outputs ("creations").
 *   media list [--type --kind --status --limit]   recent outputs, newest first
 *   media get <id>                                 one output, with its variations
 *
 * Spans creations, reference boards, and looks; filter with --kind. An id may be
 * the full output id, its first 8 chars, or either with a "-N" variation suffix.
 */

import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { Command } from 'commander'
import type { MediaItem, MediaSummary, MediaType, UploadedMedia } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit, keyValues, table } from '../output.js'
import { CliError, EXIT } from '../errors.js'
import { toInt } from '../args.js'

const MEDIA_TYPES: MediaType[] = ['image', 'video', 'audio', 'transcript']
const KINDS = ['creation', 'board', 'look', 'upload'] as const
type Kind = (typeof KINDS)[number]

/** Minimal extension -> MIME map for local uploads (defaults to octet-stream). */
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', svg: 'image/svg+xml', mp4: 'video/mp4', mov: 'video/quicktime',
  webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4',
  ogg: 'audio/ogg', pdf: 'application/pdf', json: 'application/json', txt: 'text/plain',
}

function mimeForFile(path: string): string {
  const ext = extname(path).replace('.', '').toLowerCase()
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

/** Shorten a prompt for table display. */
function clip(text: string | null, max = 48): string {
  if (!text) return ''
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? oneLine.slice(0, max - 1) + '…' : oneLine
}

function uploadedHuman(m: UploadedMedia): string {
  return keyValues([
    ['Output id', m.outputId],
    ['URL', m.url],
  ])
}

export function registerMedia(program: Command): void {
  const media = program.command('media').description("Browse the account's studio outputs")

  media
    .command('list')
    .description('List recent studio outputs (newest first)')
    .option('--type <type>', `filter by media type: ${MEDIA_TYPES.join(', ')}`)
    .option('--kind <kind>', `filter by asset class: ${KINDS.join(', ')}`)
    .option('--status <status>', "status filter (defaults to 'completed')")
    .option('--favorite', 'only outputs with a favorited variation')
    .option('--archived', 'only outputs with an archived variation')
    .option('--limit <n>', 'how many to return (default 20)', toInt)
    .action(async (opts: Record<string, unknown>, command: Command) => {
      if (opts.type && !MEDIA_TYPES.includes(opts.type as MediaType)) {
        throw new CliError(
          `Invalid --type "${opts.type}". Expected one of: ${MEDIA_TYPES.join(', ')}.`,
          EXIT.USAGE,
        )
      }
      if (opts.kind && !KINDS.includes(opts.kind as Kind)) {
        throw new CliError(
          `Invalid --kind "${opts.kind}". Expected one of: ${KINDS.join(', ')}.`,
          EXIT.USAGE,
        )
      }
      const { client, ctx } = makeClient(command)
      const items = await client.listMedia({
        contentType: opts.type as MediaType | undefined,
        kind: opts.kind as Kind | undefined,
        status: opts.status as string | undefined,
        favorited: opts.favorite ? true : undefined,
        archived: opts.archived ? true : undefined,
        limit: opts.limit as number | undefined,
      })
      emit(items, ctx, (rows: MediaSummary[]) =>
        table(
          ['ID', 'TYPE', 'KIND', 'MODEL', 'STATUS', 'PROMPT'],
          rows.map((m) => [
            m.id.slice(0, 8),
            m.type,
            m.kind ?? '',
            m.model ?? '',
            m.status,
            clip(m.prompt),
          ]),
        ),
      )
    })

  media
    .command('get')
    .description('Get one studio output by id, with its variations')
    .argument('<id>', 'output id (full or first-8), optionally with a "-N" variation suffix')
    .action(async (id: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const item = await client.getMedia(id)
      emit(item, ctx, (m: MediaItem) => {
        const head = keyValues([
          ['Id', m.id],
          ['Type', m.type],
          ['Kind', m.kind ?? 'creation'],
          ['Model', m.model ?? ''],
          ['Status', m.status],
          ...(m.prompt ? [['Prompt', clip(m.prompt, 80)] as [string, string]] : []),
          ...(m.creditsUsed != null ? [['Credits used', m.creditsUsed] as [string, number]] : []),
        ])
        const variations = table(
          ['VAR', 'STATUS', 'FAV', 'ARCH', 'URL'],
          m.variations.map((v) => [
            v.variation,
            v.status,
            v.isFavorited ? 'yes' : '',
            v.isArchived ? 'yes' : '',
            v.url ?? '',
          ]),
        )
        return `${head}\n\n${variations}`
      })
    })

  media
    .command('upload')
    .description('Upload a local file as first-class media (requires assets:write)')
    .argument('<file>', 'path to the local file')
    .option('--content-type <mime>', 'MIME type override (else inferred from the extension)')
    .option('--name <name>', 'file name override (else the basename)')
    .action(async (file: string, opts: Record<string, unknown>, command: Command) => {
      let bytes: Buffer
      try {
        bytes = await readFile(file)
      } catch {
        throw new CliError(`Cannot read file: ${file}`, EXIT.USAGE)
      }
      const fileName = (opts.name as string | undefined) ?? basename(file)
      const contentType = (opts.contentType as string | undefined) ?? mimeForFile(file)
      const { client, ctx } = makeClient(command)
      const m = await client.uploadMedia(bytes, { fileName, contentType })
      emit(m, ctx, uploadedHuman)
    })

  media
    .command('import')
    .description('Import a remote URL as first-class media (requires assets:write)')
    .argument('<url>', 'public http(s) URL to fetch and re-host')
    .option('--content-type <mime>', 'MIME type override (else taken from the response)')
    .option('--name <name>', 'file name override (used for the extension)')
    .action(async (url: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const m = await client.importMedia({
        url,
        contentType: opts.contentType as string | undefined,
        fileName: opts.name as string | undefined,
      })
      emit(m, ctx, uploadedHuman)
    })
}
