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
  CardStatus,
  CardSummary,
  PublishCardResult,
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
const STATUSES: CardStatus[] = ['draft', 'active', 'completed', 'archived']
const CLEAR = ['null', 'clear', 'none']

function assertPlatform(value: string | undefined): void {
  if (value && !PLATFORMS.includes(value as PostPlatform)) {
    throw new CliError(`Invalid platform "${value}". Expected one of: ${PLATFORMS.join(', ')}.`, EXIT.USAGE)
  }
}
function assertStatus(value: string | undefined): void {
  if (value && !STATUSES.includes(value as CardStatus)) {
    throw new CliError(`Invalid status "${value}". Expected one of: ${STATUSES.join(', ')}.`, EXIT.USAGE)
  }
}

function summaryHuman(p: CardSummary, action?: string): string {
  return keyValues([
    ...(action ? [[action, p.title] as [string, string]] : [['Title', p.title] as [string, string]]),
    ['Id', p.id],
    ['Status', p.status],
    ['Platform', p.platform ?? ''],
    ...(p.scheduledAt ? [['Scheduled', p.scheduledAt] as [string, string]] : []),
    ...(p.publishedAt ? [['Published', p.publishedAt] as [string, string]] : []),
  ])
}

function destinationHuman(d: Post): string {
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
    ['Destination', d.id],
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
    .description('List posts (newest-updated first)')
    .option('--status <status>', `filter by status: ${STATUSES.join(', ')}`)
    .option('--platform <platform>', 'filter by platform')
    .option('--stage <stage>', 'filter by stage (id, slug, or name)')
    .option('--search <text>', 'case-insensitive title search')
    .option('--favorite', 'only favorited posts')
    .option('--limit <n>', 'how many to return (default 50)', toInt)
    .option('--offset <n>', 'pagination offset', toInt)
    .action(async (opts: Record<string, unknown>, command: Command) => {
      assertStatus(opts.status as string | undefined)
      assertPlatform(opts.platform as string | undefined)
      const { client, ctx } = makeClient(command)
      const result = await client.listCards({
        status: opts.status as string | undefined,
        platform: opts.platform as string | undefined,
        stage: opts.stage as string | undefined,
        search: opts.search as string | undefined,
        isFavorite: opts.favorite === true ? true : undefined,
        limit: opts.limit as number | undefined,
        offset: opts.offset as number | undefined,
      })
      emit(result, ctx, (r: CardListResult) => {
        const t = table(
          ['ID', 'STATUS', 'PLATFORM', 'TITLE'],
          r.cards.map((p) => [p.id.slice(0, 8), p.status, p.platform ?? '', p.title]),
        )
        return `${t}\n\n${r.cards.length} of ${r.total}${r.hasMore ? ' (more available)' : ''}`
      })
    })

  card
    .command('get')
    .description('Get one post with its posts and assets')
    .argument('<id>', 'the post id')
    .action(async (id: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const p = await client.getCard(id)
      emit(p, ctx, (post: CardDetail) => {
        const head = keyValues([
          ['Title', post.title],
          ['Id', post.id],
          ['Status', post.status],
          ['Platform', post.platform ?? ''],
          ...(post.scheduledAt ? [['Scheduled', post.scheduledAt] as [string, string]] : []),
        ])
        const dests = post.posts.length
          ? '\n\nDestinations:\n' +
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
              ['TYPE', 'NAME', 'URL'],
              post.assets.map((a) => [a.assetType ?? '', a.displayName ?? '', a.assetUrl ?? '']),
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
    .option('--status <status>')
    .option('--stage <stage>', 'move the post to this stage (id, slug, or name)')
    .option('--space <space>', "move the card to another space (id or slug); without --stage it lands in that space's matching stage, or its first")
    .option('--also <id>', 'another card id to apply this to; repeatable. Fields describing ONE card (title, notes, script, cover) still need exactly one', collect)
    .option('--script <text>')
    .option('--notes <text>')
    .option('--cover-url <url>', 'public URL for the post cover')
    .option('--cover-output-id <id>', 'media token (output id, first-8, or "-N") for the cover')
    .option('--tags <list>', 'comma-separated tag names (replaces the set; must exist)')
    .option('--schedule <when>', 'ISO-8601 publish time for the post AND its posts, or "clear"')
    .option('--posts <json>', 'the post\'s posts as JSON. REPLACES the set, keyed by platform; [] detaches all', toJson)
    .option('--assets <json>', 'the post\'s assets as JSON, IN ORDER. REPLACES the list; [] clears it', toJson)
    .action(async (id: string, opts: Record<string, unknown>, command: Command) => {
      assertPlatform(opts.platform as string | undefined)
      assertStatus(opts.status as string | undefined)
      const { client, ctx } = makeClient(command)
      const input = compact<UpdateCardInput>({
        title: opts.title as string | undefined,
        platform: opts.platform as PostPlatform | undefined,
        status: opts.status as CardStatus | undefined,
        stage: opts.stage as string | undefined,
        spaceId: opts.space as string | undefined,
        script: opts.script as string | undefined,
        notes: opts.notes as string | undefined,
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
    .description('Publish a post NOW to its posts (requires publish:write; pushes to live socials)')
    .argument('<id>', 'the post id')
    .option('--platform <platform>', 'publish only this platform (default: all posts)')
    .action(async (id: string, opts: { platform?: string }, command: Command) => {
      assertPlatform(opts.platform)
      const { client, ctx } = makeClient(command)
      const result = await client.publishCard(id, { platform: opts.platform as PostPlatform | undefined })
      emit(result, ctx, (r: PublishCardResult) => {
        const t = table(
          ['PLATFORM', 'OK', 'URL / ERROR'],
          r.results.map((d) => [d.platform, d.success ? 'yes' : 'no', d.url ?? d.error ?? '']),
        )
        return `${t}\n\nPublished ${r.publishedCount}, failed ${r.failedCount}`
      })
      if (result.failedCount > 0) process.exitCode = EXIT.GENERAL
    })
}
