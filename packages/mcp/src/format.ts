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
  CostEstimate,
  Generation,
  GenerateResult,
  MediaItem,
  MediaSummary,
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
