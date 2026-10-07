/**
 * `contenthero media` - the account's studio outputs ("creations").
 *   media list [--type --kind --status --limit --cursor --small-copies]   recent outputs, newest first
 *   media search <query> [--kinds --limit --cursor --small-copies]         semantic search of the editable library
 *   media get <id>                                          one item, with its outputs
 *   media zoom <idOrUrl> <x,y,width,height>                 a region, cut from the original at its own detail
 *
 * Spans creations, reference boards, and looks; filter with --kind. Every item is named by its media id: the short
 * id, plus "-N" for output N of a generation with several, exactly as these commands print it.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { Command } from 'commander'
import { pendingOutputId, type ImportStarted, type ImportedMedia, type MediaBatchItem, type MediaItem, type MediaKind, type MediaSource, type MediaListResult, type MediaType, type SearchMediaPage, type UploadedMedia } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { DEFAULT_TIMEOUT_SEC } from '../generation.js'
import { costRows, emit, keyValues, table, linkRow, displayId, withMore, clip } from '../output.js'
import { CliError, EXIT } from '../errors.js'
import { toInt, toList, withPageFlags } from '../args.js'

/** Split a `data:<mime>;base64,<data>` URL into a Buffer. Returns null on any non-data-URL. */
function bufferFromDataUrl(dataUrl: string): Buffer | null {
  const m = /^data:[^;]+;base64,(.+)$/s.exec(dataUrl)
  const b64 = m?.[1]
  return b64 ? Buffer.from(b64, 'base64') : null
}

const MEDIA_TYPES: MediaType[] = ['image', 'video', 'audio', 'transcript']
const KINDS = ['creation', 'board', 'look', 'upload'] as const
type Kind = (typeof KINDS)[number]
// `list` can read every library (incl. the 'all' union); a single-item `get` needs a specific source.
const LIST_SOURCES: MediaSource[] = ['creations', 'uploads', 'stock', 'all']
const GET_SOURCES: MediaSource[] = ['creations', 'uploads', 'stock']
const SEARCH_KINDS: MediaKind[] = ['image', 'video', 'audio']

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


function uploadedHuman(m: UploadedMedia): string {
  return keyValues([
    ['Output id', m.outputId],
    ['URL', m.url],
  ])
}

/**
 * An import may have created NOTHING, so it cannot share `uploadedHuman`.
 *
 * ## Why this is not cosmetic
 *
 * `import_media` is idempotent: the same bytes twice give one library item, not two. Rendered through the
 * upload formatter, a duplicate printed `Output id:` followed by nothing, because `outputId` is null in that
 * case. That reads as a broken command rather than a deliberate no-op, which is worse than the behavior it
 * replaced.
 *
 * Three cases, because what the operator can DO next differs:
 *
 *   created            -> an id to reference
 *   duplicate, is a library item -> the EXISTING id, and a note that nothing was imported
 *   duplicate, is not  -> no id at all; the bytes are an export or a look, so say what they ARE
 *
 * The third is the case that caused the incident behind this work: an editor export still was imported and
 * became a row that owned no object. "Already imported" without naming what it is sends the operator hunting
 * for a library item that does not exist.
 *
 * ⚠️ `--json` is unaffected and still emits the full object. This is the HUMAN rendering only, so a script
 * reading `alreadyExisted` keeps working unchanged.
 */
export function importStartedHuman(m: Pick<ImportStarted, 'outputId' | 'status'>): string {
  return keyValues([
    ['Output id', m.outputId],
    ['Status', m.status],
    ['Next', `contenthero generation status ${m.outputId}`],
  ])
}

export function importedHuman(m: ImportedMedia): string {
  if (!m.alreadyExisted) {
    // Non-null whenever something was created; the fallback exists so a null can never render as a blank
    // value, which is the exact failure this function was written to remove.
    return keyValues([
      ['Output id', m.outputId ?? 'none'],
      ['URL', m.url],
    ])
  }
  if (m.outputId) {
    return keyValues([
      ['Status', 'Already in your library. Nothing was imported.'],
      ['Output id', m.outputId],
      ['URL', m.url],
    ])
  }
  return keyValues([
    ['Status', 'You already have this file. Nothing was imported.'],
    ['Already stored as', m.existing?.role ?? 'an existing file'],
    ['Object', m.existing?.objectName ?? ''],
    // Stated rather than left blank: an absent id is the ANSWER here, not a missing value.
    ['Output id', 'none (not a library item, reference it by URL)'],
    ['URL', m.url],
  ])
}

export function registerMedia(program: Command): void {
  const media = program.command('media').description("Browse the account's studio outputs")

  withPageFlags(
    media
      .command('list')
      .description("List recent media (newest first). --source uploads|stock|all beyond creations.")
      .option('--source <source>', `which library: ${LIST_SOURCES.join(', ')} (default creations)`)
      .option('--type <type>', `filter by media type: ${MEDIA_TYPES.join(', ')}`)
      .option('--kind <kind>', `creations only: filter by asset class: ${KINDS.join(', ')}`)
      .option('--status <status>', "status filter (defaults to 'completed')")
      .option('--favorite', 'creations only: only outputs with a favorited variation')
      .option('--archived', 'creations only: only outputs with an archived variation'),
  )
    .option('--small-copies', 'give each image its small copy, where the library keeps one: for drawing images small, never for downloading, delivering or showing large')
    .action(async (opts: Record<string, unknown>, command: Command) => {
      if (opts.source && !LIST_SOURCES.includes(opts.source as MediaSource)) {
        throw new CliError(
          `Invalid --source "${opts.source}". Expected one of: ${LIST_SOURCES.join(', ')}.`,
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
      const page = await client.listMedia({
        source: opts.source as MediaSource | undefined,
        contentType: opts.type as MediaType | undefined,
        kind: opts.kind as Kind | undefined,
        status: opts.status as string | undefined,
        favorited: opts.favorite ? true : undefined,
        archived: opts.archived ? true : undefined,
        limit: opts.limit as number | undefined,
        cursor: opts.cursor as string | undefined,
        smallCopies: opts.smallCopies ? true : undefined,
      })
      // One row per output (the atomic grain), each named by its own media id.
      emit(page, ctx, (p: MediaListResult) =>
        withMore(
          table(
            ['ID', 'FAV', 'TYPE', 'KIND', 'NAME/MODEL', 'STATUS', 'PROMPT'],
            p.media.map((m) => [
              m.mediaId,
              m.isFavorited ? '★' : '',
              m.type,
              m.kind ?? '',
              clip(m.fileName ?? m.model, 48),
              m.status,
              clip(m.prompt, 48),
            ]),
          ),
          p.nextCursor,
        ),
      )
    })

  withPageFlags(
    media
      .command('search')
      .description('Semantically search your library (creations, uploads, stock, brand) by describing the content')
      .argument('<query>', 'natural-language description of the media to find')
      .option('--kinds <kinds>', `restrict to media kinds (comma-separated): ${SEARCH_KINDS.join(', ')}`, toList),
  )
    .option('--small-copies', 'give each image its small copy, where the library keeps one: for drawing images small, never for downloading, delivering or showing large')
    .action(async (query: string, opts: Record<string, unknown>, command: Command) => {
      const kinds = opts.kinds as string[] | undefined
      if (kinds) {
        for (const k of kinds) {
          if (!SEARCH_KINDS.includes(k as MediaKind)) {
            throw new CliError(`Invalid --kinds value "${k}". Expected: ${SEARCH_KINDS.join(', ')}.`, EXIT.USAGE)
          }
        }
      }
      const { client, ctx } = makeClient(command)
      const page = await client.searchMedia(query, {
        kinds: kinds as MediaKind[] | undefined,
        limit: opts.limit as number | undefined,
        cursor: opts.cursor as string | undefined,
        smallCopies: opts.smallCopies ? true : undefined,
      })
      emit(page, ctx, (p: SearchMediaPage) =>
        withMore(
          table(
            ['ID', 'KIND', 'REL', 'SCENES', 'SUMMARY'],
            p.results.map((r) => [
              r.mediaId ?? '',
              r.kind ?? '',
              `${Math.round(r.relevance * 100)}%`,
              r.scenes.length
                ? r.scenes.map((s) => `${(s.startMs / 1000).toFixed(0)}-${(s.endMs / 1000).toFixed(0)}s`).join(' ')
                : '',
              clip(r.summary, 48),
            ]),
          ),
          p.nextCursor,
        ),
      )
    })

  media
    .command('get')
    .description('Get one media item by id (studio output, or an upload/stock item with --source)')
    .argument('<id>', 'media id (a1B2c3D4, or a1B2c3D4-2 for one output of several)')
    .option('--source <source>', `which library the id belongs to: ${GET_SOURCES.join(', ')} (default creations)`)
    .option(
      '--save <dir>',
      'download each output to <dir> (materialize the bytes for local viewing or re-ingestion)',
    )
    .action(async (id: string, opts: Record<string, unknown>, command: Command) => {
      if (opts.source && !GET_SOURCES.includes(opts.source as MediaSource)) {
        throw new CliError(
          `Invalid --source "${opts.source}". Expected one of: ${GET_SOURCES.join(', ')}.`,
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
              `Failed to download ${v.mediaId}: HTTP ${res.status}`,
              EXIT.GENERAL,
            )
          }
          const file = join(dir, `${v.mediaId}${saveExt(v.url, item.type)}`)
          await writeFile(file, Buffer.from(await res.arrayBuffer()))
          saved.push(file)
        }
      }

      emit(item, ctx, (m: MediaItem) => {
        const head = keyValues([
          ['Id', m.mediaId], ...linkRow(m),
          ['Type', m.type],
          ['Kind', m.kind ?? 'creation'],
          ['Model', m.model ?? ''],
          ['Status', m.status],
          ...(m.prompt ? [['Prompt', clip(m.prompt, 80)] as [string, string]] : []),
          ...costRows(m.charge),
        ])
        const variations = table(
          ['MEDIA ID', 'STATUS', 'FAV', 'ARCH', 'SIZE', 'URL'],
          m.variations.map((v) => [
            v.mediaId,
            v.status,
            v.isFavorited ? 'yes' : '',
            v.isArchived ? 'yes' : '',
            // Dimensions, and the ARTWORK's size when it is smaller than the file. A caller placing this
            // asset needs the artwork box to get the aspect right and to align by the visible edge; the
            // MCP reports the same, so neither surface knows more than the other.
            v.geometry
              ? v.geometry.content &&
                (v.geometry.content.width < v.geometry.width || v.geometry.content.height < v.geometry.height)
                ? `${v.geometry.width}x${v.geometry.height} (art ${v.geometry.content.width}x${v.geometry.content.height} @${v.geometry.content.x},${v.geometry.content.y})`
                : `${v.geometry.width}x${v.geometry.height}`
              : '',
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
    .argument('<idOrUrl>', 'a studio output id (short id, full id or first 8 characters) OR a media URL on our storage')
    .option('--from <sec>', 'start of the source-time window (seconds)', (v) => parseFloat(v))
    .option('--to <sec>', 'end of the source-time window (seconds)', (v) => parseFloat(v))
    .option('--frames <n>', 'how many keyframes (default 8)', (v) => parseInt(v, 10))
    .option('--frame-width <px>', 'each keyframe\'s width in pixels (default 640; 160 to 1280)', (v) => parseInt(v, 10))
    .option('--save <dir>', 'write the keyframes to <dir>')
    .action(async (idOrUrl: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const base = /^https?:\/\//.test(idOrUrl) ? { url: idOrUrl } : { mediaId: idOrUrl }
      const item = {
        ...base,
        fromSec: opts.from as number | undefined,
        toSec: opts.to as number | undefined,
        frames: (opts.frames as number | undefined) ?? 8,
        frameWidth: opts.frameWidth as number | undefined,
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
        // The server says why when it can; the guess remains only for a server too old to say.
        if (keyframes.length === 0) {
          return first.keyframeError
            ? `No keyframes: ${first.keyframeError}.`
            : 'No keyframes returned (is it a video, and is the ffmpeg service configured?).'
        }
        const savedBlock = saved.length
          ? `\nSaved ${saved.length} keyframe(s):\n${saved.map((s) => `  ${s}`).join('\n')}`
          : ''
        return `${keyframes.length} keyframe(s) at ${keyframes.map((k) => `${k.atSec}s`).join(', ')}.${savedBlock}`
      })
    })

  media
    .command('zoom')
    .description("Cut a region from a media file's original and get it at its own detail (never enlarged)")
    .argument('<idOrUrl>', 'a media id (a1B2c3D4-2) OR a media URL on our storage')
    .argument('<region>', "x,y,width,height in the file's own pixels (clamped to the file)")
    .option('--save <file>', 'write the cut to <file> (webp)')
    .action(async (idOrUrl: string, regionArg: string, opts: Record<string, unknown>, command: Command) => {
      const [x, y, width, height] = regionArg.split(',').map((v) => Number(v.trim()))
      if (![x, y, width, height].every((v) => Number.isFinite(v)) || !(width! > 0) || !(height! > 0)) {
        throw new CliError(`Invalid region "${regionArg}". Expected x,y,width,height with a positive width and height.`, EXIT.USAGE)
      }
      const { client, ctx } = makeClient(command)
      const base = /^https?:\/\//.test(idOrUrl) ? { url: idOrUrl } : { mediaId: idOrUrl }
      const result = await client.getMediaBatch([{ ...base, region: { x: x!, y: y!, width: width!, height: height! } } as MediaBatchItem])
      const first = result.items[0]
      let saved: string | null = null
      const cut = first?.crop?.dataUrl ? bufferFromDataUrl(first.crop.dataUrl) : null
      if (opts.save && cut) {
        saved = String(opts.save)
        await writeFile(saved, cut)
      }
      emit(result, ctx, () => {
        if (!first?.ok) return `Could not resolve the media: ${first?.error ?? 'unknown error'}`
        if (!first.crop) return `No region was cut: ${first.cropError ?? 'unknown reason'}`
        const c = first.crop
        return keyValues([
          ['Region', `${c.region.width}x${c.region.height} at (${c.region.x}, ${c.region.y})`],
          ['Size', `${c.width}x${c.height} (${c.pixelsPerSourcePixel} px per file px)`],
          ...(saved ? [['Saved', saved] as [string, string]] : []),
        ])
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
    .argument('<url>', 'public https URL to fetch and re-host')
    .option('--content-type <mime>', 'MIME type override (else taken from the response)')
    .option('--name <name>', 'file name override (used for the extension)')
    .option('--no-wait', 'return the outputId immediately instead of waiting for the import')
    .option('--timeout <seconds>', 'how long to wait before handing back the outputId', toInt, DEFAULT_TIMEOUT_SEC)
    .action(async (url: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const input = { url, contentType: opts.contentType as string | undefined, fileName: opts.name as string | undefined }
      if (opts.wait === false) {
        emit(await client.startImport(input), ctx, importStartedHuman)
        return
      }
      try {
        emit(await client.importMedia(input, { timeoutMs: ((opts.timeout as number) ?? DEFAULT_TIMEOUT_SEC) * 1000 }), ctx, importedHuman)
      } catch (err) {
        // Accepted and still running (or the poll dropped): the import is not lost, so hand back its id and exit
        // TIMEOUT, never an error that invites running it again. A refused url is terminal and still throws.
        const outputId = pendingOutputId(err)
        if (!outputId) throw err
        emit({ outputId, status: 'processing' }, ctx, importStartedHuman)
        process.exitCode = EXIT.TIMEOUT
      }
    })
}
