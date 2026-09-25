/**
 * `contenthero brand-kit` - brand kits (the brand identity documents).
 *   brand-kit list | get | create | extract | reorder | update
 *   brand-kit knowledge list | get | search | add | remove
 *
 * Reads are open; writes need brandkit:write. A kit's content is its sections, each one Markdown document,
 * written by key with `update --sections` (JSON). A section is archived with `archive brand_kit_section <id>`.
 */

import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import type { Command } from 'commander'
import type {
  BrandImportOutcome,
  BrandKit,
  BrandKitSectionsRead,
  BrandKitSummary,
  BrandKitSummaryRead,
  BrandKnowledgeDetail,
  BrandKnowledgeItem,
  BrandKnowledgeListResult,
  BrandKnowledgeMatch,
  CreateBrandKitInput,
  JobEnqueueOutcome,
  UpdateBrandKitInput,
} from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit, keyValues, table } from '../output.js'
import { CliError, EXIT } from '../errors.js'
import { compact } from '../generation.js'
import { collect, toInt, toJson, toList } from '../args.js'

/**
 * Turn repeated `--logo` / `--asset` refs into the declarative media list the API takes.
 *
 * A ref is either a url or a generation token, told apart by PARSING the scheme rather than guessing: a
 * token is not a url and never will be, so `http(s):` is the whole test. An `outputId` entry tells the
 * server to copy that generation's bytes into the kit, which is how media gets in without a website to
 * extract from.
 *
 * The FIRST logo is the primary one (the kit's cover) because a list has to name one and position is the
 * only signal a flat flag carries. Anything richer (layout, color mode, moving primary without reordering)
 * is a JSON body through the API.
 */
function mediaRefs(refs: string[] | undefined): Array<Record<string, unknown>> | undefined {
  if (!refs || refs.length === 0) return undefined
  return refs.map((ref, i) =>
    /^https?:\/\//i.test(ref) ? { url: ref, ...(i === 0 ? { is_primary: true } : {}) } : { outputId: ref, ...(i === 0 ? { is_primary: true } : {}) },
  )
}

/**
 * An account ref: a tracked-account id, a full profile url, or `platform:handle`.
 *
 * A url carries its own platform, so it needs no prefix. A bare handle cannot say whether it is instagram
 * or youtube, which is why that form takes one.
 */
function accountRefs(refs: string[] | undefined) {
  if (!refs?.length) return undefined
  return refs.map((raw) => {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) return raw
    if (/^https?:\/\//i.test(raw)) return { handleOrUrl: raw }
    const [platform, ...rest] = raw.split(':')
    if (!rest.length) {
      throw new CliError(`"${raw}" needs a platform: pass a profile url, or platform:handle.`, EXIT.USAGE)
    }
    return { platform, handleOrUrl: rest.join(':') }
  })
}

/**
 * The brand identity options `create` and `update` share, declared ONCE for both.
 *
 * ⚠️ WHY SHARED. They used to be two hand-written option lists, and `create` fell behind: it lacked design
 * principles and both account lists, although the SDK's `CreateBrandKitInput` accepts every one of them, and its
 * handler even READ --brand-account for a flag it never registered. The MCP/CLI parity test in `packages/mcp` found
 * it. On `update` a list flag REPLACES the stored list, which is the one wording difference, so the mode carries it.
 *
 * The kit's CONTENT is not here: it is its sections, written with `--sections` (brand-kit-foundation-v1, Revision 7).
 * The flags that wrote the retired columns (--business-name, --primary-offer, --niche, --positioning, --audience,
 * --voice-profile, --content-strategy, --visual-style, --design-principle) are gone with them.
 */
function identityOptions(cmd: Command, mode: 'create' | 'update'): Command {
  const replaces = mode === 'update' ? '. REPLACES the list' : ''
  return cmd
    .option(
      '--brand-account <ref>',
      `the owner's OWN profile: a tracked-account id, or a profile url / platform:handle to ADD one. Repeatable${replaces}`,
      collect,
    )
    .option('--inspiration-account <ref>', `a competitor/creator profile: same forms as --brand-account. Repeatable${replaces}`, collect)
    .option('--logo <ref>', `a logo: a url, or a generation id to copy in (e.g. out9-2). Repeatable; the first is primary${replaces}`, collect)
    .option('--asset <ref>', `a brand asset: a url, or a generation id to copy in. Repeatable${replaces}`, collect)
}

/** The shared identity fields, read back from the options `identityOptions` declared. */
function identityInput(opts: Record<string, unknown>): UpdateBrandKitInput {
  return {
    brandAccounts: accountRefs(opts.brandAccount as string[] | undefined),
    inspirationAccounts: accountRefs(opts.inspirationAccount as string[] | undefined),
    logos: mediaRefs(opts.logo as string[] | undefined),
    assets: mediaRefs(opts.asset as string[] | undefined),
  }
}

/** One section as Markdown under a one-line header, and its history when read with it. */
function sectionsHuman(r: BrandKitSectionsRead): string {
  if (!r.sections.length) return `No sections in brand kit "${r.name}" match that filter.`
  return r.sections
    .map((s) =>
      [
        `=== [${s.tab}] ${s.sectionName} | key ${s.key}${s.role ? ` | role ${s.role}` : ''} | v${s.version} ===`,
        '',
        s.body || '(empty)',
        ...(s.revisions ?? []).flatMap((rev) => ['', `--- v${rev.version}, ${rev.bodySource}, ${rev.createdAt} ---`, '', rev.body || '(empty)']),
      ].join('\n'),
    )
    .join('\n\n')
}

/** What an import started, as display rows: each job's state, then how to follow it. */
function importRows(started: BrandImportOutcome, kitId: string): [string, string][] {
  if (started.error) return [['Import', `not started: ${started.error}`]]
  if (!started.extract && !started.synthesis) return [['Import', 'nothing to import (no website, no own YouTube or Instagram)']]
  const state = (o: JobEnqueueOutcome | null) => (!o ? 'not needed' : o.status === 'deduped' ? 'already running' : o.status)
  return [
    ['Visual extraction', state(started.extract)],
    ['Analysis', state(started.synthesis)],
    ['Next', `poll with: contenthero brand-kit get ${kitId}`],
  ]
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
          ['ID', 'NAME', 'DEFAULT', 'FAV'],
          rows.map((k) => [
            k.id.slice(0, 8),
            k.name,
            k.isDefault ? 'yes' : '',
            k.isFavorited ? 'yes' : '',
          ]),
        ),
      )
    })

  brandKit
    .command('get')
    .description(
      'Get one brand kit: --detail summary lists every section without its body; a section filter returns just ' +
        'those sections with their bodies (add --history for earlier versions); neither returns the whole kit',
    )
    .argument('<id>', 'the brand kit id')
    .option('--detail <level>', "'summary' (every section, no bodies) or 'full' (the default); not with a filter")
    .option('--keys <list>', 'section keys, comma-separated', toList)
    .option('--roles <list>', 'section roles, comma-separated', toList)
    .option('--tabs <list>', "'overview', 'voice' and/or 'visual', comma-separated", toList)
    .option('--history', "with a filter, also return each section's earlier versions")
    .action(async (id: string, opts: Record<string, unknown>, command: Command) => {
      const detail = opts.detail as string | undefined
      if (detail !== undefined && detail !== 'summary' && detail !== 'full') {
        throw new CliError(`--detail must be 'summary' or 'full', got "${detail}".`, EXIT.USAGE)
      }
      const filter = compact({
        keys: opts.keys as string[] | undefined,
        roles: opts.roles as string[] | undefined,
        tabs: opts.tabs as string[] | undefined,
      })
      const filtered = Object.values(filter).some((v) => Array.isArray(v) && v.length > 0)
      if (detail === 'summary' && filtered) {
        throw new CliError('--detail summary cannot be combined with a section filter.', EXIT.USAGE)
      }
      if (opts.history && !filtered) {
        throw new CliError('--history needs a section filter (--keys, --roles or --tabs).', EXIT.USAGE)
      }
      const { client, ctx } = makeClient(command)
      if (detail === 'summary') {
        const index = await client.getBrandKit(id, { detail: 'summary' })
        emit(index, ctx, (k: BrandKitSummaryRead) =>
          table(
            ['TAB', 'SECTION', 'KEY', 'ROLE', 'VERSION', 'CHARS', 'COVERS'],
            k.sections.map((s) => [s.tab, s.sectionName, s.key, s.role ?? '', s.version, s.charCount || '', s.outline.join(' / ')]),
          ),
        )
        return
      }
      if (filtered) {
        const read = await client.getBrandKit(id, { ...filter, history: opts.history ? true : undefined })
        emit(read, ctx, sectionsHuman)
        return
      }
      const kit = await client.getBrandKit(id)
      emit(kit, ctx, (k: BrandKit) =>
        keyValues([
          ['Name', k.name],
          ['Id', k.id],
          ['Sections', k.sections.map((s) => s.sectionName).join(', ')],
          ['Brand accounts', k.brandAccounts.length],
          ['Inspiration accounts', k.inspirationAccounts.length],
          ['Knowledge items', k.knowledge.length],
        ]),
      )
    })

  identityOptions(
    brandKit
      .command('create')
      .description('Create a brand kit: empty, imported from its websites and accounts, or as a copy (requires brandkit:write)')
      .option('--name <text>', "the kit's name; optional when a website or social profile url is given")
      .option('--website-url <url>', "one of the brand's websites. Repeatable; the first is the primary site", collect)
      .option('--extract', 'import the kit from its websites and own --brand-account profiles (returns immediately)')
      .option('--duplicate-from <id>', 'copy an existing brand kit instead of starting empty')
      .option('--sections <json>', 'section content as JSON: [{ key, body }] to fill a starter section, [{ sectionName, tab, body? }] to add one', toJson),
    'create',
  )
    .action(async (opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const seedsFromAccount =
        ((opts.brandAccount as string[] | undefined)?.length ?? 0) +
          ((opts.inspirationAccount as string[] | undefined)?.length ?? 0) >
        0
      const websiteUrls = opts.websiteUrl as string[] | undefined
      if (!opts.name && !websiteUrls?.length && !opts.duplicateFrom && !seedsFromAccount) {
        throw new CliError(
          'Pass --name, --website-url, --brand-account/--inspiration-account, or --duplicate-from',
          EXIT.USAGE,
        )
      }
      if (opts.extract && !websiteUrls?.length && !(opts.brandAccount as string[] | undefined)?.length) {
        throw new CliError('--extract needs something to import: --website-url, or the brand\'s own --brand-account', EXIT.USAGE)
      }
      const { brandKit, import: started } = await client.createBrandKit(
        compact({
          name: opts.name as string | undefined,
          websiteUrls,
          extract: opts.extract ? true : undefined,
          duplicateFrom: opts.duplicateFrom as string | undefined,
          ...identityInput(opts),
          sections: opts.sections as CreateBrandKitInput['sections'],
        }),
      )
      emit({ brandKit, import: started }, ctx, () =>
        keyValues([
          ['Created', brandKit.name],
          ['Id', brandKit.id],
          // Said plainly, because a kit that is still filling in otherwise reads as a kit that came back empty.
          ...(started ? importRows(started, brandKit.id) : []),
        ]),
      )
    })

  brandKit
    .command('extract')
    .description("Re-run a kit's import from its websites and own accounts (returns immediately)")
    .argument('<id>', 'the brand kit id')
    .action(async (id: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const started = await client.extractBrandKit(id)
      emit(started, ctx, () => keyValues([['Brand kit', id], ...importRows(started, id)]))
    })

  brandKit
    .command('reorder')
    .description('Reorder every brand kit. Pass ALL ids, in the order you want them')
    .argument('<ids...>', 'brand kit ids, in order')
    .action(async (ids: string[], _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const kits = await client.reorderBrandKits(ids)
      emit(kits, ctx, (rows: BrandKitSummary[]) =>
        table(['#', 'ID', 'NAME'], rows.map((k, i) => [String(i + 1), k.id.slice(0, 8), k.name])),
      )
    })

  identityOptions(
    brandKit
      .command('update')
      .description('Update a brand kit: section content, media and accounts (requires brandkit:write)')
      .argument('<id>', 'the brand kit id')
      .option('--name <text>')
      .option('--website-url <url>', "one of the brand's websites. Repeatable; the first is the primary site. Replaces the list", collect)
      .option('--default', 'make this the default brand kit, un-defaulting every other')
      .option(
        '--sections <json>',
        'section writes as JSON, only the sections you change, all or nothing: [{ key, body, expectedVersion }] edits one ' +
          '(or revertTo, sectionName, width); [{ sectionName, tab, body? }] adds one',
        toJson,
      ),
    'update',
  )
    .action(async (id: string, opts: Record<string, unknown>, command: Command) => {
      const input = compact<UpdateBrandKitInput>({
        name: opts.name as string | undefined,
        websiteUrls: opts.websiteUrl as string[] | undefined,
        ...identityInput(opts),
        isDefault: opts.default ? true : undefined,
        sections: opts.sections as UpdateBrandKitInput['sections'],
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
