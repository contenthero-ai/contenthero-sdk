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
import { toInt } from '../args.js'

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
    .action(async (title: string, opts: Record<string, unknown>, command: Command) => {
      assertPlatform(opts.platform as string)
      const { client, ctx } = makeClient(command)
      const input = compact<CreatePostInput>({
        title,
        platform: opts.platform as PostPlatform,
        description: opts.description as string | undefined,
        stage: opts.stage as string | undefined,
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
      })
      emit(await client.updatePost(id, input), ctx, (p: PostSummary) => summaryHuman(p, 'Updated'))
    })

  post
    .command('archive')
    .description('Archive a post (status -> archived; reversible)')
    .argument('<id>', 'the post id')
    .action(async (id: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      emit(await client.archivePost(id), ctx, (p: PostSummary) => summaryHuman(p, 'Archived'))
    })

  post
    .command('schedule')
    .description('Set or clear the scheduled publish time on a post and its destinations')
    .argument('<id>', 'the post id')
    .argument('<when>', 'ISO-8601 timestamp, or "clear" to unschedule')
    .action(async (id: string, when: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const scheduledAt = CLEAR.includes(when.toLowerCase()) ? null : when
      emit(await client.schedulePost(id, scheduledAt), ctx, (p: PostSummary) =>
        summaryHuman(p, scheduledAt ? 'Scheduled' : 'Unscheduled'),
      )
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

  // -- post destination -----------------------------------------------------
  const destination = post.command('destination').description('Manage a post\'s publish destinations')

  destination
    .command('add')
    .description('Attach (or replace) a destination on a post (requires pipeline:write)')
    .argument('<postId>', 'the post id')
    .requiredOption('--platform <platform>', `destination platform: ${PLATFORMS.join(', ')}`)
    .option('--format <format>', "platform format, e.g. post, reel, story, short, thread")
    .option('--account <id>', 'connected account id (from `connected-account list`)')
    .option('--scheduled <iso>', 'ISO-8601 scheduled time for this destination')
    .option('--settings <json>', 'platform publish config as a JSON object (shape from `platform get`)')
    .action(async (postId: string, opts: Record<string, unknown>, command: Command) => {
      assertPlatform(opts.platform as string)
      const { client, ctx } = makeClient(command)
      const d = await client.addPostDestination(postId, {
        platform: opts.platform as PostPlatform,
        format: opts.format as string | undefined,
        connectedAccountId: opts.account as string | undefined,
        scheduledAt: opts.scheduled as string | undefined,
        platformSettings: parsePlatformSettings(opts.settings as string | undefined),
      })
      emit(d, ctx, destinationHuman)
    })

  destination
    .command('update')
    .description('Update one of a post\'s destinations (requires pipeline:write)')
    .argument('<postId>', 'the post id')
    .argument('<destinationId>', 'the destination id (from `post get`)')
    .option('--format <format>')
    .option('--account <id>', 'connected account id')
    .option('--scheduled <iso>', 'ISO-8601 scheduled time')
    .option('--status <status>')
    .option('--settings <json>', 'platform publish config as a JSON object (replaces existing; shape from `platform get`)')
    .action(async (postId: string, destinationId: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const d = await client.updatePostDestination(postId, destinationId, {
        format: opts.format as string | undefined,
        connectedAccountId: opts.account as string | undefined,
        scheduledAt: opts.scheduled as string | undefined,
        status: opts.status as string | undefined,
        platformSettings: parsePlatformSettings(opts.settings as string | undefined),
      })
      emit(d, ctx, destinationHuman)
    })

  // -- post asset -----------------------------------------------------------
  const asset = post.command('asset').description('Manage a post\'s assets')

  asset
    .command('add')
    .description('Attach an asset to a post by URL (requires assets:write)')
    .argument('<postId>', 'the post id')
    .requiredOption('--type <type>', 'asset type: image, video, audio, document, link')
    .requiredOption('--url <url>', 'public URL of the asset')
    .option('--name <name>', 'optional display name')
    .action(async (postId: string, opts: Record<string, unknown>, command: Command) => {
      const types = ['image', 'video', 'audio', 'document', 'link']
      if (!types.includes(opts.type as string)) {
        throw new CliError(`Invalid --type "${opts.type}". Expected one of: ${types.join(', ')}.`, EXIT.USAGE)
      }
      const { client, ctx } = makeClient(command)
      const a = await client.addPostAsset(postId, {
        assetType: opts.type as 'image' | 'video' | 'audio' | 'document' | 'link',
        assetUrl: opts.url as string,
        displayName: opts.name as string | undefined,
      })
      emit(a, ctx, () =>
        keyValues([
          ['Asset', a.id],
          ['Type', a.assetType ?? ''],
          ['Name', a.displayName ?? ''],
          ['URL', a.assetUrl ?? ''],
        ]),
      )
    })
}
