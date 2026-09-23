/**
 * `contenthero card` - the planner's unit of work. Space > Stage > Card > Post.
 *   card list | get | create | update | publish
 *
 * A card's POSTS (the platforms it goes out to) are set through `card update`,
 * which takes the whole set; there is no separate add/remove subcommand.
 *
 * A CARD is the container: create it, attach POSTS (one per platform) and assets
 * (media URLs), then schedule or publish. Stages accept an id, slug, or name and
 * resolve server-side; use `contenthero stage list` to discover them, and
 * `contenthero space list` to pick the board first. Writes need planner:write
 * (assets need assets:write, publish needs publish:write); the key's scopes are
 * the consent.
 */

import type { Command } from 'commander'
import type {
  CreateCardInput,
  CardAsset,
  CardDetail,
  Post,
  CardListResult,
  PostPlatform,
  CardSummary,
  PublishResult,
  UpdateCardInput,
} from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit, keyValues, table } from '../output.js'
import { CliError, EXIT } from '../errors.js'
import { compact } from '../generation.js'
import { collect, toInt, toJson } from '../args.js'

const PLATFORMS: PostPlatform[] = [
  'youtube',
  'instagram',
  'tiktok',
  'facebook',
  'linkedin',
  'x',
  'threads',
  'general',
]
const CLEAR = ['null', 'clear', 'none']

function assertPlatform(value: string | undefined): void {
  if (value && !PLATFORMS.includes(value as PostPlatform)) {
    throw new CliError(`Invalid platform "${value}". Expected one of: ${PLATFORMS.join(', ')}.`, EXIT.USAGE)
  }
}
/**
 * ⭐ REFUSED HERE, IN THE CLI'S OWN VOCABULARY, RATHER THAN LETTING THE API SAY IT.
 *
 * The server refuses this too, and the server is the authority. But its message names `expectedRevision`,
 * the FIELD, because that is what an SDK or MCP caller passes. A person at a terminal typed `--notes` and
 * needs to hear about `--expected-revision`, the FLAG, and where to get it. Sending a request we already
 * know will be refused also spends a round trip to learn something we knew locally.
 *
 * ⛔ **A BETTER MESSAGE, NOT A SECOND RULE.** Deleting this changes the wording a user sees and nothing
 * about what is allowed, which is the test for whether a client-side check is a convenience or a
 * duplicated decision. The compare-and-swap still happens in one place, in the database.
 */
export function assertNotesCarryRevision(cardId: string, notes: unknown, expectedRevision: unknown): void {
  if (notes === undefined || expectedRevision !== undefined) return
  throw new CliError(
    `Writing --notes requires --expected-revision. Run \`contenthero card get ${cardId}\` and pass the ` +
      'Revision it reports. A card\'s notes have several independent writers, so a write that cannot name ' +
      'the revision it read would silently erase the others.',
    EXIT.USAGE,
  )
}

function summaryHuman(p: CardSummary, action?: string): string {
  return keyValues([
    ...(action ? [[action, p.title] as [string, string]] : [['Title', p.title] as [string, string]]),
    ['Id', p.id],
    ['Platform', p.platform ?? ''],
    // A card has no status. Archive is the one lifecycle flag it carries on itself, and it is only shown
    // when true: a line reading "Archived: no" on every live card is noise.
    ...(p.isArchived ? [['Archived', p.archivedAt ?? 'yes'] as [string, string]] : []),
    ...(p.scheduledAt ? [['Scheduled', p.scheduledAt] as [string, string]] : []),
    ...(p.publishedAt ? [['Published', p.publishedAt] as [string, string]] : []),
  ])
}

function postHuman(d: Post): string {
  const settingsKeys = d.platformSettings
    ? Object.keys(d.platformSettings).filter((k) => {
        const v = (d.platformSettings as Record<string, unknown>)[k]
        if (v == null) return false
        if (Array.isArray(v)) return v.length > 0
        if (typeof v === 'string') return v.length > 0
        return true
      })
    : []
  return keyValues([
    ['Post', d.id],
    ['Platform', d.platform ?? ''],
    ['Format', d.format ?? ''],
    ['Connected account', d.connectedAccountId ?? '(none)'],
    ['Status', d.status ?? ''],
    ...(d.scheduledAt ? [['Scheduled', d.scheduledAt] as [string, string]] : []),
    ...(settingsKeys.length ? [['Settings', settingsKeys.join(', ')] as [string, string]] : []),
  ])
}

/** Parse a comma-separated --tags option into an array of names. */
function parseTagsOpt(value: unknown): string[] | undefined {
  if (typeof value !== 'string') return undefined
  return value.split(',').map((s) => s.trim()).filter(Boolean)
}

/** Parse a --settings JSON-object argument into platformSettings. */
function parsePlatformSettings(json: string | undefined): Record<string, unknown> | undefined {
  if (json === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new CliError('--settings must be valid JSON (e.g. \'{"caption":"hi"}\').', EXIT.USAGE)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CliError('--settings must be a JSON object.', EXIT.USAGE)
  }
  return parsed as Record<string, unknown>
}

export function registerCard(program: Command): void {
  const card = program.command('card').description('Planner cards: the unit of work on a space board')

  card
    .command('list')
    .description("List one space's cards (newest-updated first; defaults to the default space)")
    .option('--space <id>', "which space's board (from `contenthero space list`); default space if omitted")
    .option('--archived', 'only ARCHIVED cards (excluded by default)')
    .option('--platform <platform>', 'filter by platform')
    .option('--stage <stage>', 'filter by stage (id, slug, or name)')
    .option('--search <text>', 'case-insensitive title search')
    .option('--favorite', 'only favorited posts')
    .option('--limit <n>', 'how many to return (default 50)', toInt)
    .option('--offset <n>', 'pagination offset', toInt)
    .action(async (opts: Record<string, unknown>, command: Command) => {
      assertPlatform(opts.platform as string | undefined)
      const { client, ctx } = makeClient(command)
      const result = await client.listCards({
        spaceId: opts.space as string | undefined,
        archived: opts.archived === true ? true : undefined,
        platform: opts.platform as string | undefined,
        stage: opts.stage as string | undefined,
        search: opts.search as string | undefined,
        isFavorite: opts.favorite === true ? true : undefined,
        limit: opts.limit as number | undefined,
        offset: opts.offset as number | undefined,
      })
      emit(result, ctx, (r: CardListResult) => {
        /**
         * ⭐⭐⭐ NAME THE SCOPE, AND NAME IT IN THE EMPTY CASE TOO.
         *
         * This lists ONE space and falls back to the default when `--space` is omitted, so both "4 of 4" and
         * an empty table are answers about a board the caller may not have meant. Measured 2026-09-14 on the
         * MCP twin of this command: a wrong-scope EMPTY list reads as "the thing you asked for does not
         * exist", and that is the reading that sent a whole investigation down the wrong path.
         *
         * ⚠️ WORDED IDENTICALLY TO `cardListResult` IN THE MCP. Two surfaces over one API should not
         * describe the same fact two ways; a user moving between them should recognize the sentence.
         */
        const where = r.space ? ` in ${r.space.name}` : ''
        if (!r.cards.length) return `No cards found${where}.`
        const t = table(
          ['ID', 'PLATFORM', 'TITLE'],
          r.cards.map((p) => [p.id.slice(0, 8), p.platform ?? '', p.title]),
        )
        return `${t}\n\n${r.cards.length} of ${r.total}${where}${r.hasMore ? ' (more available)' : ''}`
      })
    })

  card
    .command('get')
    .description('Get one card with its posts and assets')
    .argument('<id>', 'the post id')
    .action(async (id: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const p = await client.getCard(id)
      emit(p, ctx, (post: CardDetail) => {
        const head = keyValues([
          ['Title', post.title],
          ['Id', post.id],
          ['Platform', post.platform ?? ''],
          // ⚠️ A CARD HAS NO STATUS. The POSTS table below keeps its own `STATUS` column, which is a
          // real per-destination publish state and a different thing entirely.
          ...(post.archivedAt ? [['Archived', post.archivedAt] as [string, string]] : []),
          ...(post.scheduledAt ? [['Scheduled', post.scheduledAt] as [string, string]] : []),
          // ⭐ ALWAYS SHOWN, INCLUDING AT 0, because it is not a fact about the card so much as the token
          // `card update --notes` requires. The rows above are conditional because they describe state;
          // omitting this one would hide it exactly on a card nobody has edited yet.
          ['Revision', String(post.revision)] as [string, string],
        ])
        const dests = post.posts.length
          ? '\n\nPosts:\n' +
            table(
              ['PLATFORM', 'FORMAT', 'ACCOUNT', 'STATUS'],
              post.posts.map((d) => [
                d.platform ?? '',
                d.format ?? '',
                d.connectedAccountId ?? '',
                d.status ?? '',
              ]),
            )
          : ''
        const assets = post.assets.length
          ? '\n\nAssets:\n' +
            table(
              // ID is the reference the next command takes: for an `inspiration` row it is the
              // tracked-content id `contenthero content get` resolves to the full record.
              ['TYPE', 'NAME', 'ID', 'URL'],
              post.assets.map((a) => [a.assetType ?? '', a.displayName ?? '', a.assetId ?? '', a.assetUrl ?? '']),
            )
          : ''
        return head + dests + assets
      })
    })

  card
    .command('create')
    .description('Create a post (requires planner:write)')
    .argument('<title>', 'post title')
    .requiredOption('--platform <platform>', `primary platform: ${PLATFORMS.join(', ')}`)
    .option('--space <space>', "which space's board (from `contenthero space list`); default space if omitted")
    .option('--stage <stage>', 'stage id, slug, or name (defaults to the first stage)')
    .option('--cover-url <url>', 'public URL for the post cover')
    .option('--cover-output-id <id>', 'media token (output id, first-8, or "-N") for the cover')
    .option('--tags <list>', 'comma-separated tag names (must exist; see `tag list`)')
    .action(async (title: string, opts: Record<string, unknown>, command: Command) => {
      assertPlatform(opts.platform as string)
      const { client, ctx } = makeClient(command)
      const input = compact<CreateCardInput>({
        title,
        platform: opts.platform as PostPlatform,
        spaceId: opts.space as string | undefined,
        stage: opts.stage as string | undefined,
        coverUrl: opts.coverUrl as string | undefined,
        coverOutputId: opts.coverOutputId as string | undefined,
        tags: parseTagsOpt(opts.tags),
      })
      emit(await client.createCard(input), ctx, (p: CardSummary) => summaryHuman(p, 'Created'))
    })

  card
    .command('update')
    .description("Update a post's fields, including its stage (requires planner:write)")
    .argument('<id>', 'the post id')
    .option('--title <text>')
    .option('--platform <platform>')
    .option('--stage <stage>', 'move the post to this stage (id, slug, or name)')
    .option('--space <space>', "move the card to another space (id or slug); without --stage it lands in that space's matching stage, or its first")
    .option('--also <id>', 'another card id to apply this to; repeatable. Fields describing ONE card (title, notes, cover) still need exactly one', collect)
    .option('--notes <text>', 'working notes; REQUIRES --expected-revision, from `card get`')
    .option(
      '--expected-revision <n>',
      'the revision `card get` reported. Required with --notes: a card\'s notes have several independent writers, and a write that cannot name the revision it read would silently erase the others',
      toInt,
    )
    .option('--cover-url <url>', 'public URL for the post cover')
    .option('--cover-output-id <id>', 'media token (output id, first-8, or "-N") for the cover')
    .option('--tags <list>', 'comma-separated tag names (replaces the set; must exist)')
    .option('--schedule <when>', 'ISO-8601 publish time for the card AND its posts, or "clear"')
    .option('--posts <json>', 'the card\'s posts as JSON. REPLACES the set, keyed by platform; [] detaches all', toJson)
    .option('--assets <json>', 'the post\'s assets as JSON, IN ORDER. REPLACES the list; [] clears it', toJson)
    .action(async (id: string, opts: Record<string, unknown>, command: Command) => {
      assertPlatform(opts.platform as string | undefined)
      assertNotesCarryRevision(id, opts.notes, opts.expectedRevision)
      const { client, ctx } = makeClient(command)
      const input = compact<UpdateCardInput>({
        title: opts.title as string | undefined,
        platform: opts.platform as PostPlatform | undefined,
        stage: opts.stage as string | undefined,
        spaceId: opts.space as string | undefined,
        notes: opts.notes as string | undefined,
        expectedRevision: opts.expectedRevision as number | undefined,
        coverUrl: opts.coverUrl as string | undefined,
        coverOutputId: opts.coverOutputId as string | undefined,
        tags: parseTagsOpt(opts.tags),
        // 'clear' unschedules. compact() drops undefined but keeps null, which is the difference between
        // "leave the schedule alone" and "remove it".
        scheduledAt:
          opts.schedule === undefined
            ? undefined
            : CLEAR.includes(String(opts.schedule).toLowerCase())
              ? null
              : (opts.schedule as string),
        posts: opts.posts as UpdateCardInput['posts'],
        assets: opts.assets as UpdateCardInput['assets'],
      })
      /**
       * `--also` widens the positional id into a SET, matching `update_card`'s cardIds and the folder
       * commands' shape. One card keeps the single-card output every existing script parses; a set gets
       * a count, because printing ten summaries to answer "did it work" is worse than saying so.
       */
      const also = (opts.also as string[] | undefined) ?? []
      if (also.length > 0) {
        const cards = await client.updateCards([id, ...also], input)
        emit(cards, ctx, (list: CardSummary[]) => `Updated ${list.length} cards.`)
        return
      }
      emit(await client.updateCard(id, input), ctx, (p: CardSummary) => summaryHuman(p, 'Updated'))
    })

  card
    .command('publish')
    .description('Publish a card\'s posts NOW (requires publish:write; pushes to live socials)')
    .argument('<id>', 'the post id')
    .option('--platform <platform>', 'publish only this platform (default: every post on the card)')
    .action(async (id: string, opts: { platform?: string }, command: Command) => {
      assertPlatform(opts.platform)
      const { client, ctx } = makeClient(command)
      const result = await client.publishPost(id, { platform: opts.platform as PostPlatform | undefined })
      emit(result, ctx, (r: PublishResult) => {
        const t = table(
          ['PLATFORM', 'OK', 'URL / ERROR'],
          r.results.map((d) => [d.platform, d.success ? 'yes' : 'no', d.url ?? d.error ?? '']),
        )
        return `${t}\n\nPublished ${r.publishedCount}, failed ${r.failedCount}`
      })
      if (result.failedCount > 0) process.exitCode = EXIT.GENERAL
    })
}
