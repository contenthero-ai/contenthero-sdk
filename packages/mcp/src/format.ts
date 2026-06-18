/**
 * Helpers that turn SDK results and errors into MCP CallToolResult content.
 * Tool errors are returned as `isError` results (not thrown) so the agent sees
 * a readable message instead of a transport failure.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type {
  Avatar,
  AvatarSummary,
  Balance,
  BrandKit,
  BrandKitSummary,
  BrandAccountPerformance,
  BrandKitSectionRecord,
  CostEstimate,
  Generation,
  GenerateResult,
  InspirationAccountDetail,
  InspirationContent,
  MediaItem,
  MediaSummary,
  Outlier,
  OutliersResult,
  PipelineStage,
  PostAsset,
  PostDestination,
  PostDetail,
  PostListResult,
  PostSummary,
  PublishPostResult,
  TrackedAccount,
  Transcription,
  Voice,
  VoiceSummary,
} from '@contenthero/sdk'
import { ContentHeroError, InsufficientCreditsError, RateLimitError } from '@contenthero/sdk'

function text(body: string, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: body }], isError }
}

/** A finished image/video generation: list the asset URLs. */
export function completedResult(gen: Generation): CallToolResult {
  const urls = gen.outputUrls ?? []
  const noun = urls.length === 1 ? gen.contentType : `${gen.contentType}s`
  const header = `Done. ${urls.length} ${noun} from ${gen.modelId} (outputId ${gen.outputId}):`
  return text([header, ...urls.map((u, i) => `${i + 1}. ${u}`)].join('\n'))
}

/** Suggested seconds to wait before re-polling a job, by content type. */
export function pollAfterSecondsFor(contentType: string): number {
  return contentType === 'image' ? 5 : 15
}

/** A slow job that did not finish within the smart-wait window. */
export function pendingResult(outputId: string, pollAfterSeconds = 15): CallToolResult {
  return text(
    `Still rendering (outputId ${outputId}). This is normal for video. Call get_generation_status (or wait_for_generation) with this outputId in ~${pollAfterSeconds}s [poll_after_seconds: ${pollAfterSeconds}] to get the final URLs.`,
  )
}

/** Synchronous audio result (already complete on submit). */
export function audioResult(result: GenerateResult): CallToolResult {
  const urls = result.outputUrls ?? []
  const header = `Done. Audio generated (outputId ${result.outputId}):`
  return text([header, ...urls.map((u, i) => `${i + 1}. ${u}`)].join('\n'))
}

/** Result of a get_cost preflight: the estimate, with nothing generated or charged. */
export function costResult(est: CostEstimate): CallToolResult {
  const what = est.modelId ?? est.contentType ?? 'this generation'
  const credits = `${est.creditsEstimate} credit${est.creditsEstimate === 1 ? '' : 's'}`
  return text(`Estimated cost: ${credits} for ${what}. No generation ran and nothing was charged.`)
}

/** Result of polling a generation via get_generation_status. */
export function generationStatusResult(gen: Generation): CallToolResult {
  if (gen.status === 'completed') return completedResult(gen)
  if (gen.status === 'failed') {
    return text(`Generation ${gen.outputId} failed: ${gen.error ?? 'unknown error'}`, true)
  }
  const secs = pollAfterSecondsFor(gen.contentType)
  return text(
    `Generation ${gen.outputId} is still ${gen.status}. Call get_generation_status (or wait_for_generation) again in ~${secs}s [poll_after_seconds: ${secs}].`,
  )
}

/** Result of wait_for_generation: one or more generations (snapshot or post-wait). */
export function generationBatchResult(gens: Generation[]): CallToolResult {
  if (gens.length === 1) return generationStatusResult(gens[0]!)
  const rows = gens.map((gen) => {
    if (gen.status === 'completed') {
      const urls = gen.outputUrls ?? []
      return `- ${gen.outputId}: completed | ${urls.join(', ') || '(no urls)'}`
    }
    if (gen.status === 'failed') {
      return `- ${gen.outputId}: failed | ${gen.error ?? 'unknown error'}`
    }
    const secs = pollAfterSecondsFor(gen.contentType)
    return `- ${gen.outputId}: ${gen.status} [poll_after_seconds: ${secs}]`
  })
  return text([`${gens.length} generation(s):`, ...rows].join('\n'))
}

/** A finished transcription: header line plus the transcript body. */
export function transcriptResult(t: Transcription): CallToolResult {
  const lang = t.language ? ` (${t.language})` : ''
  const header = `Transcript${lang}, ${t.wordCount} words (outputId ${t.outputId}):`
  return text([header, '', t.transcript].join('\n'))
}

/** Join the non-empty lines (drops null/empty entries). */
function lines(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => !!p).join('\n')
}

/** List of avatars, each with the fields an agent needs to drive lip-sync. */
export function avatarListResult(avatars: AvatarSummary[]): CallToolResult {
  if (!avatars.length) {
    return text('No avatars found. Create one in the ContentHero app first.')
  }
  const rows = avatars.map(
    (a) =>
      `- ${a.name} (id ${a.id})${a.isDefault ? ' [default]' : ''} | image: ${a.imageUrl ?? 'none'} | voice: ${a.defaultVoiceId ?? 'none'}`,
  )
  return text([`${avatars.length} avatar(s):`, ...rows].join('\n'))
}

/** One avatar's full detail, including its looks. */
export function avatarResult(a: Avatar): CallToolResult {
  const traits = [a.gender, a.age, a.ethnicity].filter(Boolean).join(', ')
  return text(
    lines([
      `${a.name} (id ${a.id})${a.isDefault ? ' [default]' : ''}`,
      `image (base look, use as imageUrl for generate_lip_sync): ${a.imageUrl ?? 'none'}`,
      `default voice (use as voiceId): ${a.defaultVoiceId ?? 'none'}`,
      a.description ? `description: ${a.description}` : null,
      traits ? `traits: ${traits}` : null,
      a.niche.length ? `niche: ${a.niche.join(', ')}` : null,
      a.looks.length ? `looks (${a.looks.length}):` : 'looks: none',
      ...a.looks.map(
        (l) =>
          `  - ${l.name ?? l.lookType ?? 'look'} (id ${l.id})${l.isDefault ? ' [default]' : ''}: ${l.imageUrl ?? 'none'}`,
      ),
    ]),
  )
}

/** List of saved voices. */
export function voiceListResult(voices: VoiceSummary[]): CallToolResult {
  if (!voices.length) return text('No saved voices found.')
  const rows = voices.map(
    (v) =>
      `- ${v.name ?? '(unnamed)'} (voiceId ${v.voiceId})${v.isFavorited ? ' [favorite]' : ''}${v.previewUrl ? ` | preview: ${v.previewUrl}` : ''}`,
  )
  return text([`${voices.length} voice(s):`, ...rows].join('\n'))
}

/** One voice's full detail. */
export function voiceResult(v: Voice): CallToolResult {
  const traits = [v.gender, v.age, v.accent, v.language].filter(Boolean).join(', ')
  return text(
    lines([
      `${v.name ?? '(unnamed)'} (voiceId ${v.voiceId})${v.isFavorited ? ' [favorite]' : ''}`,
      v.provider ? `provider: ${v.provider}` : null,
      traits ? `traits: ${traits}` : null,
      v.description ? `description: ${v.description}` : null,
      v.useCase ? `use case: ${v.useCase}` : null,
      v.previewUrl ? `preview: ${v.previewUrl}` : null,
    ]),
  )
}

/** List of brand kits. */
export function brandKitListResult(kits: BrandKitSummary[]): CallToolResult {
  if (!kits.length) return text('No brand kits found. Create one in the ContentHero app first.')
  const rows = kits.map(
    (k) =>
      `- ${k.name}${k.businessName && k.businessName !== k.name ? ` (${k.businessName})` : ''} (id ${k.id})${k.isDefault ? ' [default]' : ''}${k.nicheDefinition ? ` | niche: ${k.nicheDefinition}` : ''}`,
  )
  return text([`${kits.length} brand kit(s):`, ...rows].join('\n'))
}

/**
 * One brand kit in full. The kit is deeply structured (visual identity, voice,
 * curated sections, linked accounts, knowledge), so return a short header plus
 * the whole object as JSON: faithful and complete, and an agent reads it cleanly.
 */
export function brandKitResult(kit: BrandKit): CallToolResult {
  const header = `Brand kit "${kit.name}"${kit.isDefault ? ' [default]' : ''} (id ${kit.id}):`
  return text([header, '', JSON.stringify(kit, null, 2)].join('\n'))
}

/** A created/updated/archived brand-kit section. */
export function brandKitSectionResult(s: BrandKitSectionRecord, verb = 'Section'): CallToolResult {
  const fieldCount = Array.isArray(s.fields) ? s.fields.length : 0
  return text(`${verb}: "${s.sectionName}" in tab "${s.tab}" (id ${s.id}) | ${fieldCount} field(s).`)
}

/** A brand kit that was just archived. */
export function brandKitArchivedResult(kit: BrandKitSummary): CallToolResult {
  return text(`Archived brand kit "${kit.name}" (id ${kit.id}).`)
}

/** List of studio outputs (media). */
export function mediaListResult(items: MediaSummary[]): CallToolResult {
  if (!items.length) return text('No media found.')
  const rows = items.map((m) => {
    const vars = m.variationCount > 1 ? ` | ${m.variationCount} variations` : ''
    const promptStr = m.prompt ? ` | ${m.prompt.slice(0, 80)}${m.prompt.length > 80 ? '...' : ''}` : ''
    const kindTag =
      m.kind === 'board'
        ? ` | board${m.boardType ? `:${m.boardType}` : ''}`
        : m.kind && m.kind !== 'creation'
          ? ` | ${m.kind}`
          : ''
    return `- [${m.type}] ${m.model ?? ''} (id ${m.id})${kindTag}${vars} | ${m.status}${promptStr}`
  })
  return text([`${items.length} item(s) (newest first):`, ...rows].join('\n'))
}

/** One studio output's detail, with its variations. */
export function mediaResult(m: MediaItem): CallToolResult {
  const specs = [
    m.aspectRatio ? `aspect ${m.aspectRatio}` : null,
    m.resolution ? `res ${m.resolution}` : null,
    m.duration ? `${m.duration}s` : null,
  ]
    .filter(Boolean)
    .join(', ')
  return text(
    lines([
      `${m.type} from ${m.model ?? 'unknown'} (id ${m.id})${m.selectedVariation ? `, variation ${m.selectedVariation}` : ''}`,
      m.kind && m.kind !== 'creation' ? `kind: ${m.kind}${m.boardType ? ` (${m.boardType})` : ''}` : null,
      m.prompt ? `prompt: ${m.prompt}` : null,
      m.script ? `script: ${m.script}` : null,
      specs || null,
      `status: ${m.status}${m.creditsUsed != null ? ` | ${m.creditsUsed} credits` : ''}`,
      `variations (${m.variationCount}):`,
      ...m.variations.map(
        (v) => `  ${v.variation}. ${v.url ?? `(no url, ${v.status})`}${v.isFavorited ? ' [favorite]' : ''}`,
      ),
    ]),
  )
}

export function balanceResult(b: Balance): CallToolResult {
  return text(
    `Balance: ${b.balance} credits (tier: ${b.tier}, auto top-up: ${b.autoTopupEnabled ? 'on' : 'off'}).`,
  )
}

// -- posts (content pipeline) -------------------------------------------------

/** One line summarizing a post. */
function postLine(p: PostSummary): string {
  const where = p.platforms.length ? p.platforms.join('+') : (p.platform ?? 'general')
  const when = p.publishedAt
    ? ` | published ${p.publishedAt}`
    : p.scheduledAt
      ? ` | scheduled ${p.scheduledAt}`
      : ''
  return `- ${p.title || '(untitled)'} (id ${p.id}) | ${p.status} | ${where}${when}`
}

/** List of posts with pagination context. */
export function postListResult(result: PostListResult): CallToolResult {
  if (!result.posts.length) return text('No posts found.')
  const more = result.hasMore ? ` (showing ${result.posts.length} of ${result.total}; raise limit/offset for more)` : ''
  return text([`${result.total} post(s)${more}:`, ...result.posts.map(postLine)].join('\n'))
}

/** A single post summary line (create / update / schedule / archive results). */
export function postSummaryResult(p: PostSummary, prefix = 'Post'): CallToolResult {
  const stage = p.pipelineStageId ? ` | stage ${p.pipelineStageId}` : ''
  return text(`${prefix}: ${p.title || '(untitled)'} (id ${p.id}) | ${p.status}${stage}`)
}

/** One post in full, with its destinations and assets. */
export function postResult(p: PostDetail): CallToolResult {
  return text(
    lines([
      `${p.title || '(untitled)'} (id ${p.id}) | ${p.status} | platform: ${p.platform ?? 'general'}`,
      p.pipelineStageId ? `stage: ${p.pipelineStageId}` : null,
      p.scheduledAt ? `scheduled: ${p.scheduledAt}` : null,
      p.publishedAt ? `published: ${p.publishedAt}` : null,
      p.publishUrl ? `publish url: ${p.publishUrl}` : null,
      p.description ? `description: ${p.description}` : null,
      p.script ? `script: ${p.script}` : null,
      p.notes ? `notes: ${p.notes}` : null,
      `destinations (${p.destinations.length}):`,
      ...p.destinations.map(
        (d) =>
          `  - ${d.platform} (id ${d.id})${d.format ? ` ${d.format}` : ''} | ${d.status ?? 'draft'}${d.connectedAccountId ? ` | account ${d.connectedAccountId}` : ' | no connected account'}`,
      ),
      `assets (${p.assets.length}):`,
      ...p.assets.map((a) => `  - [${a.assetType ?? '?'}] ${a.assetUrl ?? '(no url)'} (id ${a.id})`),
    ]),
  )
}

/** List of pipeline stages (the agent resolves a stage from here before placing a post). */
export function pipelineStageListResult(stages: PipelineStage[]): CallToolResult {
  if (!stages.length) return text('No pipeline stages found.')
  const rows = stages.map(
    (s) => `- ${s.name} (id ${s.id}${s.slug ? `, slug ${s.slug}` : ''})${s.isDefault ? ' [default]' : ''}`,
  )
  return text([`${stages.length} pipeline stage(s) (in order):`, ...rows].join('\n'))
}

/** A created or updated destination. */
export function destinationResult(d: PostDestination): CallToolResult {
  return text(
    `Destination: ${d.platform} (id ${d.id})${d.format ? ` ${d.format}` : ''} | ${d.status ?? 'draft'}${d.connectedAccountId ? ` | account ${d.connectedAccountId}` : ' | no connected account (set one before publishing)'}.`,
  )
}

/** An attached asset. */
export function assetResult(a: PostAsset): CallToolResult {
  return text(`Asset attached: [${a.assetType ?? '?'}] ${a.assetUrl ?? '(no url)'} (id ${a.id}).`)
}

/** The result of publishing a post (per-destination outcomes). */
export function publishResult(r: PublishPostResult): CallToolResult {
  if (!r.results.length) {
    return text('Nothing to publish: this post has no destinations. Add one with add_post_destination first.', true)
  }
  const rows = r.results.map((d) =>
    d.success
      ? `- ${d.platform}: published${d.url ? ` | ${d.url}` : ''}`
      : `- ${d.platform}: FAILED | ${d.error ?? 'unknown error'}`,
  )
  const header = `Published ${r.publishedCount}/${r.results.length} destination(s)${r.failedCount ? `, ${r.failedCount} failed` : ''}:`
  return text([header, ...rows].join('\n'), r.publishedCount === 0)
}

// -- inspiration / research ---------------------------------------------------

/** Compact integer formatting (1.2M, 45.3K) for engagement counts. */
function compactNum(n: number | null): string {
  if (n == null) return '?'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

/** One line summarizing a tracked account. */
function accountLine(a: TrackedAccount): string {
  const handle = a.handle ? `@${a.handle}` : (a.name ?? '(unnamed)')
  return `- ${handle} (id ${a.id}) | ${a.platform ?? '?'} | ${compactNum(a.followerCount)} followers`
}

/** List of tracked accounts (inspiration or brand). */
export function trackedAccountListResult(accounts: TrackedAccount[], noun: string): CallToolResult {
  if (!accounts.length) return text(`No ${noun} found. Add one in the ContentHero app first.`)
  return text([`${accounts.length} ${noun}:`, ...accounts.map(accountLine)].join('\n'))
}

/** One line summarizing an outlier / content item. */
function outlierLine(o: Outlier): string {
  const score = o.outlierScore != null ? `${o.outlierScore.toFixed(1)}x` : 'n/a'
  const creator = o.sourceCreator || (o.accountHandle ? `@${o.accountHandle}` : '')
  return `- [${score}] ${o.title ?? '(untitled)'}${creator ? ` | ${creator}` : ''} | ${compactNum(o.viewCount)} views (id ${o.id})`
}

/** A page of outliers. */
export function outlierListResult(result: OutliersResult): CallToolResult {
  if (!result.outliers.length) {
    return text('No outliers found. Track some creators in the ContentHero app, or widen the filters.')
  }
  const more = result.hasMore ? ` (showing ${result.outliers.length} of ${result.total})` : ''
  return text(
    [`${result.total} outlier(s) by score${more}:`, ...result.outliers.map(outlierLine)].join('\n'),
  )
}

/** One inspiration account with its top content. */
export function inspirationAccountResult(d: InspirationAccountDetail): CallToolResult {
  const a = d.account
  const handle = a.handle ? `@${a.handle}` : (a.name ?? '(unnamed)')
  return text(
    lines([
      `${handle} (id ${a.id}) | ${a.platform ?? '?'} | ${compactNum(a.followerCount)} followers`,
      `tracked content: ${d.contentCount}`,
      d.topContent.length ? `top outliers:` : 'top outliers: none yet',
      ...d.topContent.map(outlierLine),
    ]),
  )
}

/** One tracked-content item in full, including transcript. */
export function inspirationContentResult(c: InspirationContent): CallToolResult {
  const stats = `${compactNum(c.viewCount)} views, ${compactNum(c.likeCount)} likes, ${compactNum(c.commentCount)} comments`
  const score = c.outlierScore != null ? `${c.outlierScore.toFixed(1)}x outlier` : null
  return text(
    lines([
      `${c.title ?? '(untitled)'} (id ${c.id})`,
      `${c.platform ?? '?'} ${c.contentType ?? ''} | ${c.sourceCreator ?? c.accountHandle ?? ''}`.trim(),
      `${stats}${score ? ` | ${score}` : ''}`,
      c.url ? `url: ${c.url}` : null,
      c.publishedAt ? `published: ${c.publishedAt}` : null,
      c.hashtags.length ? `hashtags: ${c.hashtags.join(' ')}` : null,
      c.description ? `description: ${c.description}` : null,
      c.transcript ? `transcript:\n${c.transcript}` : 'transcript: none',
    ]),
  )
}

/** Performance summary for a brand account. */
export function brandPerformanceResult(p: BrandAccountPerformance): CallToolResult {
  const a = p.account
  const handle = a.handle ? `@${a.handle}` : (a.name ?? '(unnamed)')
  const avgEng = p.averages.engagementRate != null ? `${(p.averages.engagementRate * 100).toFixed(1)}%` : 'n/a'
  const avgScore = p.averages.outlierScore != null ? `${p.averages.outlierScore.toFixed(2)}x` : 'n/a'
  return text(
    lines([
      `${handle} (id ${a.id}) | ${a.platform ?? '?'} | ${compactNum(a.followerCount)} followers`,
      `content tracked: ${p.contentCount}`,
      `totals: ${compactNum(p.totals.views)} views, ${compactNum(p.totals.likes)} likes, ${compactNum(p.totals.comments)} comments`,
      `averages: ${compactNum(p.averages.views)} views/post, ${avgEng} engagement, ${avgScore} outlier score`,
      p.topContent.length ? `top content:` : null,
      ...p.topContent.map(outlierLine),
    ]),
  )
}

/** Map any thrown error onto a readable isError result. */
export function errorResult(err: unknown): CallToolResult {
  if (err instanceof InsufficientCreditsError) {
    const parts: string[] = []
    if (err.required != null) parts.push(`need ${err.required}`)
    if (err.balance != null) parts.push(`have ${err.balance}`)
    const detail = parts.length ? ` (${parts.join(', ')})` : ''
    return text(`Insufficient credits${detail}. Top up to continue.`, true)
  }
  if (err instanceof RateLimitError) {
    const wait = err.retryAfter != null ? ` Retry in ${err.retryAfter}s.` : ''
    return text(`Rate limit exceeded.${wait || ' Wait a moment before retrying.'}`, true)
  }
  if (err instanceof ContentHeroError || err instanceof Error) {
    return text(err.message, true)
  }
  return text('Unknown error', true)
}
