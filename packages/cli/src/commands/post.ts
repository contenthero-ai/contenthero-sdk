/**
 * `contenthero post` - the content pipeline (posts, destinations, assets).
 *   post list | get | create | update | archive | schedule | publish
 *   post destination add | update
 *   post asset add
 *
 * A post is the container: create it, attach destinations (platforms) and assets
 * (media URLs), then schedule or publish. Stages accept an id, slug, or name and
 * resolve server-side. Writes need pipeline:write (assets need assets:write,
 * publish needs publish:write); the key's scopes are the consent.
 */

import type { Command } from 'commander'
import type {
  CreatePostInput,
  PostAsset,
  PostDetail,
  PostDestination,
  PostListResult,
  PostPlatform,
  PostStatus,
  PostSummary,
  PublishPostResult,
  UpdatePostInput,
} from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit, keyValues, table } from '../output.js'
import { CliError, EXIT } from '../errors.js'
import { compact } from '../generation.js'
import { toInt, toJson } from '../args.js'

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
const STATUSES: PostStatus[] = ['draft', 'active', 'completed', 'archived']
const CLEAR = ['null', 'clear', 'none']

function assertPlatform(value: string | undefined): void {
  if (value && !PLATFORMS.includes(value as PostPlatform)) {
    throw new CliError(`Invalid platform "${value}". Expected one of: ${PLATFORMS.join(', ')}.`, EXIT.USAGE)
  }
}
function assertStatus(value: string | undefined): void {
  if (value && !STATUSES.includes(value as PostStatus)) {
    throw new CliError(`Invalid status "${value}". Expected one of: ${STATUSES.join(', ')}.`, EXIT.USAGE)
  }
}

function summaryHuman(p: PostSummary, action?: string): string {
  return keyValues([
    ...(action ? [[action, p.title] as [string, string]] : [['Title', p.title] as [string, string]]),
    ['Id', p.id],
    ['Status', p.status],
    ['Platform', p.platform ?? ''],
    ...(p.scheduledAt ? [['Scheduled', p.scheduledAt] as [string, string]] : []),
    ...(p.publishedAt ? [['Published', p.publishedAt] as [string, string]] : []),
  ])
}

function destinationHuman(d: PostDestination): string {
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

export function registerPost(program: Command): void {
  const post = program.command('post').description('Content pipeline: posts, destinations, assets')

  post
    .command('list')
    .description('List posts (newest-updated first)')
    .option('--status <status>', `filter by status: ${STATUSES.join(', ')}`)
    .option('--platform <platform>', 'filter by platform')
    .option('--stage <stage>', 'filter by pipeline stage (id, slug, or name)')
    .option('--search <text>', 'case-insensitive title search')
    .option('--favorite', 'only favorited posts')
    .option('--limit <n>', 'how many to return (default 50)', toInt)
    .option('--offset <n>', 'pagination offset', toInt)
    .action(async (opts: Record<string, unknown>, command: Command) => {
      assertStatus(opts.status as string | undefined)
      assertPlatform(opts.platform as string | undefined)
      const { client, ctx } = makeClient(command)
      const result = await client.listPosts({
        status: opts.status as string | undefined,
        platform: opts.platform as string | undefined,
        pipelineStage: opts.stage as string | undefined,
        search: opts.search as string | undefined,
        isFavorite: opts.favorite === true ? true : undefined,
        limit: opts.limit as number | undefined,
        offset: opts.offset as number | undefined,
      })
      emit(result, ctx, (r: PostListResult) => {
        const t = table(
          ['ID', 'STATUS', 'PLATFORM', 'TITLE'],
          r.posts.map((p) => [p.id.slice(0, 8), p.status, p.platform ?? '', p.title]),
        )
        return `${t}\n\n${r.posts.length} of ${r.total}${r.hasMore ? ' (more available)' : ''}`
      })
    })

  post
    .command('get')
    .description('Get one post with its destinations and assets')
    .argument('<id>', 'the post id')
    .action(async (id: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const p = await client.getPost(id)
      emit(p, ctx, (post: PostDetail) => {
        const head = keyValues([
          ['Title', post.title],
          ['Id', post.id],
          ['Status', post.status],
          ['Platform', post.platform ?? ''],
          ...(post.scheduledAt ? [['Scheduled', post.scheduledAt] as [string, string]] : []),
          ...(post.description ? [['Description', post.description] as [string, string]] : []),
        ])
        const dests = post.destinations.length
          ? '\n\nDestinations:\n' +
            table(
              ['PLATFORM', 'FORMAT', 'ACCOUNT', 'STATUS'],
              post.destinations.map((d) => [
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

  post
    .command('create')
    .description('Create a post (requires pipeline:write)')
    .argument('<title>', 'post title')
    .requiredOption('--platform <platform>', `primary platform: ${PLATFORMS.join(', ')}`)
    .option('--description <text>', 'description / caption draft')
    .option('--stage <stage>', 'pipeline stage id, slug, or name (defaults to the first stage)')
    .option('--cover-url <url>', 'public URL for the post cover')
    .option('--cover-output-id <id>', 'media token (output id, first-8, or "-N") for the cover')
    .option('--tags <list>', 'comma-separated tag names (must exist; see `tag list`)')
    .action(async (title: string, opts: Record<string, unknown>, command: Command) => {
      assertPlatform(opts.platform as string)
      const { client, ctx } = makeClient(command)
      const input = compact<CreatePostInput>({
        title,
        platform: opts.platform as PostPlatform,
        description: opts.description as string | undefined,
        stage: opts.stage as string | undefined,
        coverUrl: opts.coverUrl as string | undefined,
        coverOutputId: opts.coverOutputId as string | undefined,
        tags: parseTagsOpt(opts.tags),
      })
      emit(await client.createPost(input), ctx, (p: PostSummary) => summaryHuman(p, 'Created'))
    })

  post
    .command('update')
    .description("Update a post's fields, including its pipeline stage (requires pipeline:write)")
    .argument('<id>', 'the post id')
    .option('--title <text>')
    .option('--description <text>')
    .option('--platform <platform>')
    .option('--status <status>')
    .option('--stage <stage>', 'move the post to this stage (id, slug, or name)')
    .option('--script <text>')
    .option('--notes <text>')
    .option('--cover-url <url>', 'public URL for the post cover')
    .option('--cover-output-id <id>', 'media token (output id, first-8, or "-N") for the cover')
    .option('--tags <list>', 'comma-separated tag names (replaces the set; must exist)')
    .option('--schedule <when>', 'ISO-8601 publish time for the post AND its destinations, or "clear"')
    .option('--destinations <json>', 'the post\'s destinations as JSON. REPLACES the set, keyed by platform; [] detaches all', toJson)
    .option('--assets <json>', 'the post\'s assets as JSON, IN ORDER. REPLACES the list; [] clears it', toJson)
    .action(async (id: string, opts: Record<string, unknown>, command: Command) => {
      assertPlatform(opts.platform as string | undefined)
      assertStatus(opts.status as string | undefined)
      const { client, ctx } = makeClient(command)
      const input = compact<UpdatePostInput>({
        title: opts.title as string | undefined,
        description: opts.description as string | undefined,
        platform: opts.platform as PostPlatform | undefined,
        status: opts.status as PostStatus | undefined,
        stage: opts.stage as string | undefined,
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
        destinations: opts.destinations as UpdatePostInput['destinations'],
        assets: opts.assets as UpdatePostInput['assets'],
      })
      emit(await client.updatePost(id, input), ctx, (p: PostSummary) => summaryHuman(p, 'Updated'))
    })

  post
    .command('publish')
    .description('Publish a post NOW to its destinations (requires publish:write; pushes to live socials)')
    .argument('<id>', 'the post id')
    .option('--platform <platform>', 'publish only this platform (default: all destinations)')
    .action(async (id: string, opts: { platform?: string }, command: Command) => {
      assertPlatform(opts.platform)
      const { client, ctx } = makeClient(command)
      const result = await client.publishPost(id, { platform: opts.platform as PostPlatform | undefined })
      emit(result, ctx, (r: PublishPostResult) => {
        const t = table(
          ['PLATFORM', 'OK', 'URL / ERROR'],
          r.results.map((d) => [d.platform, d.success ? 'yes' : 'no', d.url ?? d.error ?? '']),
        )
        return `${t}\n\nPublished ${r.publishedCount}, failed ${r.failedCount}`
      })
      if (result.failedCount > 0) process.exitCode = EXIT.GENERAL
    })
}
