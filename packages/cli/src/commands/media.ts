/**
 * `contenthero media` - the account's studio outputs ("creations").
 *   media list [--source --collection --query --type --kind --status --limit --cursor --small-copies]   media you can place; stock with --source stock
 *   media search <query> [--kinds --limit --cursor --small-copies]         semantic search of the editable library
 *   media get <id>                                          one item, with its outputs
 *   media zoom <idOrUrl> <x,y,width,height>                 a region of an image, cut from the original at its own detail
 *
 * Spans creations, reference boards, and looks; filter with --kind. Every item is named by its media id: the short
 * id, plus "-N" for output N of a generation with several, exactly as these commands print it.
 */

import { writeFile, mkdir } from 'node:fs/promises'
import type { Command } from 'commander'
import {
  LIST_SORTS,
  MEDIA_LIST_SOURCES,
  MEDIA_LIST_TYPES,
  MEDIA_STOCK_COLLECTIONS,
  describeAudioFacts,
  describeFileSize,
  describeReferences,
  type MediaBatchItem,
  type MediaItem,
  type MediaKind,
  type MediaListSource,
  type MediaListType,
  type MediaStockCollection,
  type MediaSort,
  type MediaSource,
  type MediaListResult,
  type SearchMediaPage,
  type SortOrder,
} from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { costRows, emit, keyValues, table, linkRow, displayId, withMore, clip } from '../output.js'
import { CliError, EXIT } from '../errors.js'
import { toList, withPageFlags, withSortFlags } from '../args.js'
import { saveFiles } from '../save-files.js'

/** Split a `data:<mime>;base64,<data>` URL into a Buffer. Returns null on any non-data-URL. */
function bufferFromDataUrl(dataUrl: string): Buffer | null {
  const m = /^data:[^;]+;base64,(.+)$/s.exec(dataUrl)
  const b64 = m?.[1]
  return b64 ? Buffer.from(b64, 'base64') : null
}

const KINDS = ['creation', 'board', 'look'] as const
type Kind = (typeof KINDS)[number]
// `list` reads the library's files, all or one partition (`MEDIA_LIST_SOURCES`); a single-item `get` names its library.
const GET_SOURCES: MediaSource[] = ['creations', 'uploads', 'stock']
const SEARCH_KINDS: MediaKind[] = ['image', 'video', 'audio']

export function registerMedia(program: Command): void {
  const media = program.command('media').description("Browse the account's studio outputs")

  withSortFlags(withPageFlags(
    media
      .command('list')
      .description("List media you can place: the account's files (every file, or one part of the library), or with --source stock the stock catalog, which comes back in its own order and does not take the library's filters or sort")
      .option('--source <source>', `which media to read: ${MEDIA_LIST_SOURCES.join(', ')} (default all; stock is the stock catalog, not part of all)`)
      .option('--collection <collection>', "Stock only, and required with it. Which part of the stock catalog to read: 'photos', 'videos', 'gifs', 'stickers' or 'sounds'.")
      .option('--query <query>', "Stock only. Describe what to find. Omit it to read the collection's featured items.")
      .option('--type <types>', `filter by media type (comma-separated): ${MEDIA_LIST_TYPES.join(', ')}`, toList)
      .option('--kind <kind>', `creations only: filter by asset class: ${KINDS.join(', ')}`)
      .option('--favorite', 'only favorited files')
      .option('--archived', 'only archived files'),
  ), LIST_SORTS.media)
    .option('--small-copies', 'give each image its small copy, where the library keeps one: for drawing images small, never for downloading, delivering or showing large')
    .action(async (opts: Record<string, unknown>, command: Command) => {
      if (opts.source && !(MEDIA_LIST_SOURCES as readonly string[]).includes(opts.source as string)) {
        throw new CliError(
          `Invalid --source "${opts.source}". Expected one of: ${MEDIA_LIST_SOURCES.join(', ')}.`,
          EXIT.USAGE,
        )
      }
      if (opts.collection && !(MEDIA_STOCK_COLLECTIONS as readonly string[]).includes(opts.collection as string)) {
        throw new CliError(
          `Invalid --collection "${opts.collection}". Expected one of: ${MEDIA_STOCK_COLLECTIONS.join(', ')}.`,
          EXIT.USAGE,
        )
      }
      for (const t of (opts.type as string[] | undefined) ?? []) {
        if (!(MEDIA_LIST_TYPES as readonly string[]).includes(t)) {
          throw new CliError(`Invalid --type "${t}". Expected: ${MEDIA_LIST_TYPES.join(', ')}.`, EXIT.USAGE)
        }
      }
      if (opts.kind && !KINDS.includes(opts.kind as Kind)) {
        throw new CliError(
          `Invalid --kind "${opts.kind}". Expected one of: ${KINDS.join(', ')}.`,
          EXIT.USAGE,
        )
      }
      const { client, ctx } = makeClient(command)
      const page = await client.listMedia({
        source: opts.source as MediaListSource | undefined,
        collection: opts.collection as MediaStockCollection | undefined,
        query: opts.query as string | undefined,
        contentType: opts.type as MediaListType[] | undefined,
        kind: opts.kind as Kind | undefined,
        sort: opts.sort as MediaSort | undefined,
        order: opts.order as SortOrder | undefined,
        favorited: opts.favorite ? true : undefined,
        archived: opts.archived ? true : undefined,
        limit: opts.limit as number | undefined,
        cursor: opts.cursor as string | undefined,
        smallCopies: opts.smallCopies ? true : undefined,
      })
      // One row per file, each named by its own media id.
      emit(page, ctx, (p: MediaListResult) => {
        // A stock page shows what the item is and who it is credited to; the library's columns do not apply to it.
        if (p.media.length && p.media.every((m) => m.source === 'stock')) {
          return withMore(
            table(
              ['ID', 'TYPE', 'COLLECTION', 'NAME', 'CREDIT'],
              p.media.map((m) => [
                m.mediaId,
                m.type,
                m.collection ?? '',
                clip(m.name, 48),
                clip(m.license?.attribution ?? (m.creator ? `by ${m.creator}` : m.providerLabel ?? ''), 48),
              ]),
            ),
            p.nextCursor,
          )
        }
        return withMore(
          table(
            ['ID', 'FAV', 'TYPE', 'SOURCE', 'KIND', 'NAME/MODEL', 'SIZE', 'PROMPT'],
            p.media.map((m) => [
              m.mediaId,
              m.isFavorited ? '★' : '',
              m.type,
              m.source,
              m.kind ?? '',
              clip(m.name ?? m.fileName ?? m.model, 48),
              m.sizeBytes != null ? describeFileSize(m.sizeBytes) : '',
              clip(m.prompt, 48),
            ]),
          ),
          p.nextCursor,
        )
      })
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
        const files = item.variations.flatMap((v) => (v.url ? [{ mediaId: v.mediaId, name: v.mediaId, url: v.url }] : []))
        if (files.length) saved.push(...(await saveFiles(files, dir)).map((f) => f.path))
      }

      emit(item, ctx, (m: MediaItem) => {
        const head = keyValues([
          ['Id', m.mediaId], ...linkRow(m),
          ['Type', m.type],
          ['Kind', m.kind ?? 'creation'],
          ['Model', m.model ?? ''],
          ['Status', m.status ?? ''],
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
        // An audio item's recorded facts, in the SDK's one wording (the bitrate is labeled as derived).
        const audioRows = m.variations.flatMap((v) => {
          const facts = describeAudioFacts(v.audio)
          return facts ? [`  ${v.mediaId}: ${facts}`] : []
        })
        const audioBlock = audioRows.length ? `\n\nAudio:\n${audioRows.join('\n')}` : ''
        const savedBlock = saved.length
          ? `\n\nSaved ${saved.length} file(s):\n${saved.map((s) => `  ${s}`).join('\n')}`
          : ''
        // What it was made FROM, in the words the MCP and Studio use.
        const refs = describeReferences(m.references)
        const madeFrom = refs.length ? `\n\nMade from:\n${refs.map((r) => `  ${r}`).join('\n')}` : ''
        return `${head}\n\n${variations}${audioBlock}${madeFrom}${savedBlock}`
      })
    })

  media
    .command('zoom')
    .description("Cut a region from an image's original and get it at its own detail (never enlarged)")
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
}
