/**
 * `contenthero brand-kit` - brand kits (the brand identity documents).
 *   brand-kit list | get | update | archive
 *   brand-kit section add | update | archive
 *   brand-kit knowledge list | get | search | add | remove
 *
 * Reads are open; writes need brandkit:write. Free-form identity objects
 * (positioning, audience, voice profile, content strategy) and section fields
 * are passed as JSON.
 */

import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import type { Command } from 'commander'
import type {
  BrandKit,
  BrandKitSectionRecord,
  BrandKitSummary,
  BrandKnowledgeDetail,
  BrandKnowledgeItem,
  BrandKnowledgeListResult,
  BrandKnowledgeMatch,
  UpdateBrandKitInput,
} from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit, keyValues, table } from '../output.js'
import { CliError, EXIT } from '../errors.js'
import { compact } from '../generation.js'
import { collect, toInt, toJson } from '../args.js'

function recordHuman(s: BrandKitSectionRecord, action: string): string {
  return keyValues([
    [action, s.sectionName],
    ['Section id', s.id],
    ['Tab', s.tab],
    ['Sort order', s.sortOrder],
    ['Fields', s.fields.length],
  ])
}

export function registerBrandKit(program: Command): void {
  const brandKit = program.command('brand-kit').description('Brand kits (brand identity documents)')

  brandKit
    .command('list')
    .description('List the account\'s brand kits (default first; excludes archived unless --archived)')
    .option('--favorite', 'only favorited brand kits')
    .option('--archived', 'only archived brand kits (default excludes archived)')
    .action(async (opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const kits = await client.listBrandKits({
        favorited: opts.favorite ? true : undefined,
        archived: opts.archived ? true : undefined,
      })
      emit(kits, ctx, (rows: BrandKitSummary[]) =>
        table(
          ['ID', 'NAME', 'BUSINESS', 'DEFAULT', 'FAV'],
          rows.map((k) => [
            k.id.slice(0, 8),
            k.name,
            k.businessName ?? '',
            k.isDefault ? 'yes' : '',
            k.isFavorited ? 'yes' : '',
          ]),
        ),
      )
    })

  brandKit
    .command('get')
    .description('Get one brand kit in full (the whole brand document)')
    .argument('<id>', 'the brand kit id')
    .action(async (id: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const kit = await client.getBrandKit(id)
      emit(kit, ctx, (k: BrandKit) =>
        keyValues([
          ['Name', k.name],
          ['Id', k.id],
          ['Business', k.businessName ?? ''],
          ['Niche', k.nicheDefinition ?? ''],
          ['Primary offer', k.primaryOffer ?? ''],
          ['Visual style', k.visualStyle ?? ''],
          ['Sections', k.sections.length],
          ['Brand accounts', k.brandAccounts.length],
          ['Inspiration accounts', k.inspirationAccounts.length],
          ['Knowledge items', k.knowledge.length],
        ]),
      )
    })

  brandKit
    .command('update')
    .description('Update a brand kit\'s identity fields (requires brandkit:write)')
    .argument('<id>', 'the brand kit id')
    .option('--name <text>')
    .option('--business-name <text>')
    .option('--website-url <url>')
    .option('--primary-offer <text>')
    .option('--niche <text>', 'niche definition')
    .option('--visual-style <text>')
    .option('--positioning <json>', 'positioning object (JSON)', toJson)
    .option('--audience <json>', 'audience object (JSON)', toJson)
    .option('--voice-profile <json>', 'voice profile object (JSON)', toJson)
    .option('--content-strategy <json>', 'content strategy object (JSON)', toJson)
    .option('--design-principle <text>', 'a design principle; repeatable', collect)
    .action(async (id: string, opts: Record<string, unknown>, command: Command) => {
      const input = compact<UpdateBrandKitInput>({
        name: opts.name as string | undefined,
        businessName: opts.businessName as string | undefined,
        websiteUrl: opts.websiteUrl as string | undefined,
        primaryOffer: opts.primaryOffer as string | undefined,
        nicheDefinition: opts.niche as string | undefined,
        visualStyle: opts.visualStyle as string | undefined,
        positioning: opts.positioning as Record<string, unknown> | undefined,
        audience: opts.audience as Record<string, unknown> | undefined,
        voiceProfile: opts.voiceProfile as Record<string, unknown> | undefined,
        contentStrategy: opts.contentStrategy as Record<string, unknown> | undefined,
        designPrinciples: opts.designPrinciple as string[] | undefined,
      })
      if (Object.keys(input).length === 0) {
        throw new CliError('Nothing to update. Pass at least one field to change.', EXIT.USAGE)
      }
      const { client, ctx } = makeClient(command)
      const kit = await client.updateBrandKit(id, input)
      emit(kit, ctx, (k: BrandKit) =>
        keyValues([
          ['Updated', k.name],
          ['Id', k.id],
        ]),
      )
    })

  // -- brand-kit section ----------------------------------------------------
  const section = brandKit.command('section').description('Manage a brand kit\'s curated sections')

  section
    .command('add')
    .description('Add a curated section to a brand kit (requires brandkit:write)')
    .argument('<brandKitId>', 'the brand kit id')
    .requiredOption('--tab <tab>', 'the tab the section belongs to (e.g. voice, overview)')
    .requiredOption('--name <name>', 'the section title')
    .option('--sort-order <n>', 'order within the tab (default end)', toInt)
    .option('--fields <json>', 'field objects as a JSON array: [{ key, label, type, value }]', toJson)
    .action(async (brandKitId: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const s = await client.addBrandKitSection(brandKitId, {
        tab: opts.tab as string,
        sectionName: opts.name as string,
        sortOrder: opts.sortOrder as number | undefined,
        fields: opts.fields as unknown[] | undefined,
      })
      emit(s, ctx, (rec: BrandKitSectionRecord) => recordHuman(rec, 'Added section'))
    })

  section
    .command('update')
    .description('Update a brand-kit section (requires brandkit:write)')
    .argument('<brandKitId>', 'the brand kit id')
    .argument('<sectionId>', 'the section id (from `brand-kit get`)')
    .option('--name <name>', 'new section title')
    .option('--sort-order <n>', 'new order within the tab', toInt)
    .option('--fields <json>', 'replacement field objects as a JSON array', toJson)
    .action(async (brandKitId: string, sectionId: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const s = await client.updateBrandKitSection(brandKitId, sectionId, {
        sectionName: opts.name as string | undefined,
        sortOrder: opts.sortOrder as number | undefined,
        fields: opts.fields as unknown[] | undefined,
      })
      emit(s, ctx, (rec: BrandKitSectionRecord) => recordHuman(rec, 'Updated section'))
    })

  // -- brand-kit knowledge --------------------------------------------------
  const knowledge = brandKit
    .command('knowledge')
    .description('A brand kit\'s knowledge base: list, get, semantic search, add, remove')

  knowledge
    .command('list')
    .description('List the knowledge items in a brand kit (the complete index)')
    .argument('<brandKitId>', 'the brand kit id')
    .option('--limit <n>', 'how many to return (default 50)', toInt)
    .option('--offset <n>', 'pagination offset', toInt)
    .action(async (brandKitId: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const result = await client.listBrandKnowledge(brandKitId, {
        limit: opts.limit as number | undefined,
        offset: opts.offset as number | undefined,
      })
      emit(result, ctx, (r: BrandKnowledgeListResult) =>
        table(
          ['ID', 'TITLE', 'SOURCE', 'CREATED'],
          r.items.map((k) => [k.id.slice(0, 8), k.title ?? '', k.sourceType ?? '', k.createdAt ?? '']),
        ),
      )
    })

  knowledge
    .command('get')
    .description('Get one knowledge item with its stored body')
    .argument('<brandKitId>', 'the brand kit id')
    .argument('<knowledgeId>', 'the knowledge item id')
    .action(async (brandKitId: string, knowledgeId: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const item = await client.getBrandKnowledge(brandKitId, knowledgeId)
      emit(item, ctx, (k: BrandKnowledgeDetail) =>
        keyValues([
          ['Title', k.title ?? ''],
          ['Id', k.id],
          ['Source type', k.sourceType ?? ''],
          ['Source url', k.sourceUrl ?? ''],
          ['Body', k.content ?? '(use search for the full depth)'],
        ]),
      )
    })

  knowledge
    .command('search')
    .description('Semantic search over a brand kit\'s knowledge base')
    .argument('<brandKitId>', 'the brand kit id')
    .argument('<query>', 'what to search for (natural language)')
    .option('--limit <n>', 'max matches (default 8)', toInt)
    .option('--threshold <n>', 'minimum similarity 0-1 (default 0.45)', parseFloat)
    .action(async (brandKitId: string, query: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const matches = await client.searchBrandKnowledge(brandKitId, query, {
        limit: opts.limit as number | undefined,
        threshold: opts.threshold as number | undefined,
      })
      emit(matches, ctx, (ms: BrandKnowledgeMatch[]) =>
        ms.length
          ? ms
              .map(
                (m, i) =>
                  `[${i + 1}] ${m.title ?? '(untitled)'} (item ${m.knowledgeId ?? '?'}, score ${m.similarity.toFixed(3)})\n${m.content}`,
              )
              .join('\n\n')
          : 'No matching knowledge found.',
      )
    })

  knowledge
    .command('add')
    .description('Add an item to a brand kit\'s knowledge base (requires brandkit:write)')
    .argument('<brandKitId>', 'the brand kit id')
    .option('--text <text>', 'add a text note')
    .option('--url <url>', 'scrape and add a web page')
    .option('--youtube <url>', 'add a YouTube video transcript')
    .option('--file <path>', 'add a local document or image file (PDF, DOCX, PNG, etc.)')
    .option('--file-url <url>', 'add a hosted file by URL the server fetches (large files, video, audio)')
    .option('--file-ext <ext>', 'extension for --file-url when not in the URL, e.g. pdf')
    .option('--title <title>', 'optional title (else derived)')
    .action(async (brandKitId: string, opts: Record<string, unknown>, command: Command) => {
      const text = opts.text as string | undefined
      const url = opts.url as string | undefined
      const youtube = opts.youtube as string | undefined
      const file = opts.file as string | undefined
      const fileUrl = opts.fileUrl as string | undefined
      const provided = [text, url, youtube, file, fileUrl].filter((v) => v != null)
      if (provided.length !== 1) {
        throw new CliError(
          'Provide exactly one source: --text, --url, --youtube, --file, or --file-url.',
          EXIT.USAGE,
        )
      }
      const { client, ctx } = makeClient(command)
      let input
      if (text != null) {
        input = { sourceType: 'text' as const, text }
      } else if (url != null) {
        input = { sourceType: 'url' as const, url }
      } else if (youtube != null) {
        input = { sourceType: 'youtube' as const, url: youtube }
      } else if (fileUrl != null) {
        input = { sourceType: 'file' as const, fileUrl, fileExt: opts.fileExt as string | undefined }
      } else {
        const ext = extname(file!).replace(/^\./, '').toLowerCase()
        if (!ext) throw new CliError('Could not determine the file extension from --file.', EXIT.USAGE)
        let fileData: string
        try {
          fileData = readFileSync(file!).toString('base64')
        } catch (err) {
          throw new CliError(
            `Could not read --file: ${err instanceof Error ? err.message : String(err)}`,
            EXIT.USAGE,
          )
        }
        input = { sourceType: 'file' as const, fileData, fileExt: ext }
      }
      const item = await client.addBrandKnowledge(brandKitId, {
        ...input,
        title: opts.title as string | undefined,
      })
      emit(item, ctx, (k: BrandKnowledgeItem) =>
        keyValues([
          ['Added', k.title ?? '(untitled)'],
          ['Id', k.id],
          ['Source type', k.sourceType ?? ''],
        ]),
      )
    })

  knowledge
    .command('remove')
    .description('Remove a knowledge item and its embeddings (requires brandkit:write)')
    .argument('<brandKitId>', 'the brand kit id')
    .argument('<knowledgeId>', 'the knowledge item id to remove')
    .action(async (brandKitId: string, knowledgeId: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const res = await client.removeBrandKnowledge(brandKitId, knowledgeId)
      emit(res, ctx, (r: { id: string }) => keyValues([['Removed', r.id]]))
    })
}
