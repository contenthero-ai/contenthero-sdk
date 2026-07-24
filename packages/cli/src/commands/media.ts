/**
 * `contenthero media` - the account's studio outputs ("creations").
 *   media list [--type --kind --status --limit]   recent outputs, newest first
 *   media get <id>                                 one output, with its variations
 *
 * Spans creations, reference boards, and looks; filter with --kind. An id may be
 * the full output id, its first 8 chars, or either with a "-N" variation suffix.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { Command } from 'commander'
import type { MediaBatchItem, MediaItem, MediaSource, MediaSummary, MediaType, UploadedMedia } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit, keyValues, table } from '../output.js'
import { CliError, EXIT } from '../errors.js'
import { toInt } from '../args.js'

/** Split a `data:<mime>;base64,<data>` URL into a Buffer. Returns null on any non-data-URL. */
function bufferFromDataUrl(dataUrl: string): Buffer | null {
  const m = /^data:[^;]+;base64,(.+)$/s.exec(dataUrl)
  const b64 = m?.[1]
  return b64 ? Buffer.from(b64, 'base64') : null
}

const MEDIA_TYPES: MediaType[] = ['image', 'video', 'audio', 'transcript']
const KINDS = ['creation', 'board', 'look', 'upload'] as const
type Kind = (typeof KINDS)[number]
const SOURCES: MediaSource[] = ['creations', 'uploads']

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

/** Default file extension per media type, for --save when a URL has none. */
const EXT_BY_TYPE: Record<string, string> = {
  image: '.png', video: '.mp4', audio: '.mp3', transcript: '.txt',
}

/** Pick a file extension for a downloaded variation (from the URL, else the type). */
function saveExt(url: string, type: string): string {
  try {
    const ext = extname(new URL(url).pathname)
    if (ext) return ext
  } catch {
    /* fall through to the type default */
  }
  return EXT_BY_TYPE[type] ?? ''
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
    .description("List recent media (newest first). --source uploads for the editor Uploads tab.")
    .option('--source <source>', `which library: ${SOURCES.join(', ')} (default creations)`)
    .option('--type <type>', `filter by media type: ${MEDIA_TYPES.join(', ')}`)
    .option('--kind <kind>', `creations only: filter by asset class: ${KINDS.join(', ')}`)
    .option('--status <status>', "status filter (defaults to 'completed')")
    .option('--favorite', 'creations only: only outputs with a favorited variation')
    .option('--archived', 'creations only: only outputs with an archived variation')
    .option('--limit <n>', 'how many to return (default 20)', toInt)
    .action(async (opts: Record<string, unknown>, command: Command) => {
      if (opts.source && !SOURCES.includes(opts.source as MediaSource)) {
        throw new CliError(
          `Invalid --source "${opts.source}". Expected one of: ${SOURCES.join(', ')}.`,
          EXIT.USAGE,
        )
      }
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
        source: opts.source as MediaSource | undefined,
        contentType: opts.type as MediaType | undefined,
        kind: opts.kind as Kind | undefined,
        status: opts.status as string | undefined,
        favorited: opts.favorite ? true : undefined,
        archived: opts.archived ? true : undefined,
        limit: opts.limit as number | undefined,
      })
      emit(items, ctx, (rows: MediaSummary[]) =>
        table(
          ['ID', 'TYPE', 'KIND', 'NAME/MODEL', 'STATUS', 'PROMPT'],
          rows.map((m) => [
            m.id.slice(0, 8),
            m.type,
            m.kind ?? '',
            m.fileName ?? m.model ?? '',
            m.status,
            clip(m.prompt),
          ]),
        ),
      )
    })

  media
    .command('get')
    .description('Get one media item by id (studio output or, with --source uploads, an upload)')
    .argument('<id>', 'media id (full or first-8); creations also accept a "-N" variation suffix')
    .option('--source <source>', `which library the id belongs to: ${SOURCES.join(', ')} (default creations)`)
    .option(
      '--save <dir>',
      'download each variation to <dir> (materialize the bytes for local viewing or re-ingestion)',
    )
    .action(async (id: string, opts: Record<string, unknown>, command: Command) => {
      if (opts.source && !SOURCES.includes(opts.source as MediaSource)) {
        throw new CliError(
          `Invalid --source "${opts.source}". Expected one of: ${SOURCES.join(', ')}.`,
          EXIT.USAGE,
        )
      }
      const { client, ctx } = makeClient(command)
      const item = await client.getMedia(id, { source: opts.source as MediaSource | undefined })

      // --save materializes bytes to disk: the CLI's vision affordance. A terminal
      // cannot carry a model image block, so we hand back real files any consumer
      // (a human, a script, or an LLM harness re-reading them) can pick up.
      const saved: string[] = []
      if (opts.save) {
        const dir = String(opts.save)
        await mkdir(dir, { recursive: true })
        for (const v of item.variations) {
          if (!v.url) continue
          const res = await fetch(v.url)
          if (!res.ok) {
            throw new CliError(
              `Failed to download variation ${v.variation}: HTTP ${res.status}`,
              EXIT.GENERAL,
            )
          }
          const file = join(dir, `${item.id.slice(0, 8)}-v${v.variation}${saveExt(v.url, item.type)}`)
          await writeFile(file, Buffer.from(await res.arrayBuffer()))
          saved.push(file)
        }
      }

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
        const savedBlock = saved.length
          ? `\n\nSaved ${saved.length} file(s):\n${saved.map((s) => `  ${s}`).join('\n')}`
          : ''
        return `${head}\n\n${variations}${savedBlock}`
      })
    })

  media
    .command('watch')
    .description('Watch a VIDEO as low-res keyframes across a time window (inspect raw footage)')
    .argument('<idOrUrl>', 'a studio output id (first-8 ok) OR a media URL on our storage')
    .option('--from <sec>', 'start of the source-time window (seconds)', (v) => parseFloat(v))
    .option('--to <sec>', 'end of the source-time window (seconds)', (v) => parseFloat(v))
    .option('--frames <n>', 'how many keyframes (default 8)', (v) => parseInt(v, 10))
    .option('--save <dir>', 'write the keyframes to <dir>')
    .action(async (idOrUrl: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const base = /^https?:\/\//.test(idOrUrl) ? { url: idOrUrl } : { mediaId: idOrUrl }
      const item = {
        ...base,
        fromSec: opts.from as number | undefined,
        toSec: opts.to as number | undefined,
        frames: (opts.frames as number | undefined) ?? 8,
      } as MediaBatchItem
      const result = await client.getMediaBatch([item])
      const first = result.items[0]
      const keyframes = first?.keyframes ?? []

      const saved: string[] = []
      if (opts.save && keyframes.length > 0) {
        const dir = String(opts.save)
        await mkdir(dir, { recursive: true })
        for (let i = 0; i < keyframes.length; i++) {
          const kf = keyframes[i]
          const buf = kf ? bufferFromDataUrl(kf.dataUrl) : null
          if (!buf) continue
          const file = join(dir, `kf-${String(i + 1).padStart(2, '0')}.jpg`)
          await writeFile(file, buf)
          saved.push(file)
        }
      }

      emit(result, ctx, () => {
        if (!first?.ok) return `Could not resolve the media: ${first?.error ?? 'unknown error'}`
        if (keyframes.length === 0) return 'No keyframes returned (is it a video, and is the ffmpeg service configured?).'
        const savedBlock = saved.length
          ? `\nSaved ${saved.length} keyframe(s):\n${saved.map((s) => `  ${s}`).join('\n')}`
          : ''
        return `${keyframes.length} keyframe(s) at ${keyframes.map((k) => `${k.atSec}s`).join(', ')}.${savedBlock}`
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
