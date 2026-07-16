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
  BrandKnowledgeItem,
  BrandKnowledgeDetail,
  BrandKnowledgeListResult,
  BrandKnowledgeMatch,
  ConnectedAccount,
  CostEstimate,
  Element,
  Generation,
  GenerateResult,
  InspirationAccountDetail,
  InspirationContent,
  MediaItem,
  MediaSummary,
  MediaBatchResult,
  ResolvedMediaBatchItem,
  CreateMediaUploadResult,
  UploadedMedia,
  ModelInfo,
  PlatformSummary,
  PlatformSchema,
  Outlier,
  OutliersResult,
  PipelineStage,
  PostAsset,
  PostDestination,
  PostDetail,
  PostListResult,
  PostSummary,
  Tag,
  PublishPostResult,
  TrackedAccount,
  Transcription,
  Voice,
  VoiceSummary,
  ApplyEditorOpsResult,
  ProjectSummary,
  ProjectDetail,
  LiveContextResult,
  LayerTypeCatalog,
  TimelineTypeCatalog,
  TranscriptResult,
  ExportJob,
  ExportFormatCatalog,
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
          `  - ${l.name ?? l.lookType ?? 'look'} (id ${l.id})${l.isDefault ? ' [default]' : ''}${l.isFavorited ? ' [favorite]' : ''}${l.isArchived ? ' [archived]' : ''}: ${l.imageUrl ?? 'none'}`,
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
export function brandKnowledgeListResult(result: BrandKnowledgeListResult): CallToolResult {
  if (!result.items.length) {
    return text('No knowledge items in this brand kit yet. Add one with add_brand_knowledge.')
  }
  const more = result.hasMore ? ` (showing ${result.items.length} of ${result.total})` : ''
  const lines = result.items.map(
    (k) => `- ${k.title ?? '(untitled)'} [${k.sourceType ?? 'unknown'}] (id ${k.id})`,
  )
  return text([`${result.total} knowledge item(s)${more}:`, ...lines].join('\n'))
}

export function brandKnowledgeDetailResult(item: BrandKnowledgeDetail): CallToolResult {
  return text(
    [
      `${item.title ?? '(untitled)'} [${item.sourceType ?? 'unknown'}] (id ${item.id})`,
      item.sourceUrl ? `Source: ${item.sourceUrl}` : null,
      '',
      item.content ?? '(no stored body; use search_brand_knowledge for the full depth)',
    ]
      .filter((l) => l !== null)
      .join('\n'),
  )
}

export function brandKnowledgeSearchResult(matches: BrandKnowledgeMatch[]): CallToolResult {
  if (!matches.length) {
    return text('No matching knowledge found. Try a broader query or a lower threshold.')
  }
  const blocks = matches.map((m, i) => {
    const score = m.similarity.toFixed(3)
    const header = `[${i + 1}] ${m.title ?? '(untitled)'} (item ${m.knowledgeId ?? '?'}, score ${score})`
    return `${header}\n${m.content}`
  })
  return text([`${matches.length} match(es):`, ...blocks].join('\n\n'))
}

export function brandKnowledgeItemResult(item: BrandKnowledgeItem, verb = 'Added'): CallToolResult {
  return text(`${verb} knowledge item: "${item.title ?? '(untitled)'}" [${item.sourceType ?? 'unknown'}] (id ${item.id}).`)
}

/**
 * Confirmation of a universal favorite / unfavorite / archive / unarchive action.
 * `target` describes what was acted on: a studio variation slot when
 * variationIndex is set, otherwise a top-level asset by type + id.
 */
export function statusActionResult(
  action: 'Favorited' | 'Unfavorited' | 'Archived' | 'Unarchived',
  target: { assetType?: string; id: string; variationIndex?: number },
): CallToolResult {
  const what =
    target.variationIndex != null
      ? `variation ${target.variationIndex} of output ${target.id}`
      : `${target.assetType ?? 'asset'} ${target.id}`
  return text(`${action} ${what}.`)
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
        (v) => `  ${v.variation}. ${v.url ?? `(no url, ${v.status})`}${v.isFavorited ? ' [favorite]' : ''}${v.isArchived ? ' [archived]' : ''}`,
      ),
    ]),
  )
}

/** One resolved batch item's metadata line (no image; that is added separately). */
function batchItemLine(it: ResolvedMediaBatchItem, index: number, hasImage: boolean): string {
  const label = `[${index + 1}]`
  if (!it.ok) {
    const ref = it.mediaId ?? ('url' in it.input ? it.input.url : JSON.stringify(it.input))
    return `${label} ERROR (${ref}): ${it.error ?? 'could not resolve'}`
  }
  const idPart = it.mediaId
    ? `${it.type ?? 'media'} ${it.mediaId}${it.variation != null ? ` v${it.variation}` : ''}`
    : `${it.type ?? 'media'} (url)`
  const others =
    it.otherVariations.length > 0 ? ` | other variations: ${it.otherVariations.join(', ')}` : ''
  const model = it.model ? ` from ${it.model}` : ''
  const prompt = it.prompt ? `\n    prompt: ${it.prompt}` : ''
  // Explain the absence of an image so the model does not assume it failed.
  let note = ''
  if (!hasImage) {
    if (it.type === 'audio') note = '\n    (audio: no visual; use the url)'
    else if (it.type === 'video') note = '\n    (video: no still available for this view; use the url)'
    else if (it.type === 'transcript') note = '\n    (transcript: text only)'
  }
  return `${label} ${idPart}${model}${others}\n    ${it.url}${prompt}${note}`
}

/**
 * A vision-enabled media batch (get_media). Returns a text summary + one metadata
 * line per item, and, for each image item whose bytes were fetched, an IMAGE
 * content block so the calling model can SEE it. Images arrive as a parallel
 * array (fetched + base64-encoded by the caller, image items only; null for
 * video/audio/errors). This just assembles the result. See get-context §9.5.
 */
export function mediaBatchResult(
  result: MediaBatchResult,
  images: Array<{ data: string; mimeType: string } | null>,
): CallToolResult {
  const { items } = result
  const okCount = items.filter((i) => i.ok).length
  const shownImages = images.filter(Boolean).length
  const summary =
    `Resolved ${okCount}/${items.length} media item(s); ${shownImages} image(s) attached below.\n\n` +
    items.map((it, i) => batchItemLine(it, i, Boolean(images[i]))).join('\n')
  const content: CallToolResult['content'] = [{ type: 'text', text: summary }]
  items.forEach((_, i) => {
    const img = images[i]
    if (img) {
      content.push({ type: 'text', text: `Image for item [${i + 1}]:` })
      content.push({ type: 'image', data: img.data, mimeType: img.mimeType })
    }
  })
  return { content }
}

/** Phase 1 of an upload: the signed URL + the PUT-then-complete instructions. */
export function mediaUploadResult(r: CreateMediaUploadResult): CallToolResult {
  return text(
    lines([
      `Upload created (id ${r.outputId}). Two steps remain:`,
      `1. PUT the file bytes to this URL with the file's Content-Type (expires ${r.expiresAt}):`,
      `   ${r.uploadUrl}`,
      `2. Call complete_media_upload(outputId: "${r.outputId}") to finalize.`,
      'Once complete, reference the media by its outputId in generations or post assets.',
    ]),
  )
}

/** A finalized upload or import: a first-class media output. */
export function uploadedMediaResult(r: UploadedMedia): CallToolResult {
  return text(
    `Media ready (id ${r.outputId}): ${r.url}. Reference it by outputId in generate_* or add_post_asset, or find it via list_media / get_media.`,
  )
}

export function balanceResult(b: Balance): CallToolResult {
  return text(
    `Balance: ${b.balance} credits (tier: ${b.tier}, auto top-up: ${b.autoTopupEnabled ? 'on' : 'off'}).`,
  )
}

// -- reference elements (named reference library) -----------------------------

/** List of the account's saved reference elements. */
export function elementListResult(items: Element[]): CallToolResult {
  if (!items.length) {
    return text('No reference elements. Create one with create_element, then reference it in a Kling generation by elementId.')
  }
  const rows = items.map((e) => {
    const media = e.input_video_url ? '1 video' : `${e.input_urls.length} image(s)`
    return `- ${e.name} (id ${e.id}) | ${e.category} | ${media}${e.description ? ` | ${e.description.slice(0, 60)}` : ''}`
  })
  return text([`${items.length} element(s):`, ...rows].join('\n'))
}

/** Confirmation that an element was deleted. */
export function elementDeletedResult(id: string): CallToolResult {
  return text(`Deleted element ${id}.`)
}

/** One saved reference element. */
export function elementResult(e: Element, verb?: string): CallToolResult {
  if (verb) {
    return text(`${verb} element "${e.name}" (id ${e.id}, ${e.category}). Reference it in a Kling generation via references.elements [{ elementId: "${e.id}" }] and @${e.name} in the prompt.`)
  }
  return text(
    lines([
      `${e.name} (id ${e.id}) | ${e.category}`,
      e.description ? `description: ${e.description}` : null,
      e.input_video_url ? `video: ${e.input_video_url}` : `images (${e.input_urls.length}): ${e.input_urls.join(', ')}`,
      `Reference in a Kling prompt as @${e.name}; pass references.elements [{ elementId: "${e.id}" }].`,
    ]),
  )
}

// -- models (discovery catalog) -----------------------------------------------

/** Read a possibly-absent capability field from the loosely-typed bag. */
function cap(m: ModelInfo, key: string): any {
  return (m.capabilities as Record<string, unknown>)[key]
}

/** Human duration spec, e.g. "5s|10s", "4-12s", "8s", or null when not applicable. */
function durationSummary(d: any): string | null {
  if (!d || d.mode === 'none') return null
  if (d.mode === 'locked') return `${d.value}s`
  if (d.mode === 'discrete') return Array.isArray(d.options) ? `${d.options.join('s|')}s` : null
  if (d.mode === 'range') return `${d.min}-${d.max}s`
  return null
}

/** Compact, decision-relevant capability summary for the list view. */
function capabilitySummary(m: ModelInfo): string {
  const parts: string[] = []
  const inputs = cap(m, 'inputTypes')
  if (Array.isArray(inputs) && inputs.length) parts.push(`inputs:${inputs.join('+')}`)
  const dur = durationSummary(cap(m, 'duration'))
  if (dur) parts.push(`dur:${dur}`)
  const res = cap(m, 'resolution')?.supported
  if (Array.isArray(res) && res.length) parts.push(`res:${res.join('/')}`)
  const ar = cap(m, 'aspectRatio')?.supported
  if (Array.isArray(ar) && ar.length) parts.push(`ar:${ar.join('/')}`)
  if (cap(m, 'audio')?.supported) parts.push('audio')
  const refMax = Math.max(
    cap(m, 'maxImageRefs') ?? 0,
    cap(m, 'maxVideoRefs') ?? 0,
    cap(m, 'maxAudioRefs') ?? 0,
  )
  if (refMax > 0) parts.push(`refs:≤${refMax}`)
  return parts.join(' | ')
}

/** List of models in the discovery catalog. */
export function modelListResult(models: ModelInfo[]): CallToolResult {
  if (!models.length) return text('No models found.')
  const rows = models.map((m) => {
    const summary = capabilitySummary(m)
    const def = m.isDefault ? ' [default]' : ''
    return `- [${m.contentType}] ${m.modelId} (${m.displayName})${def} | ${m.kind}${summary ? ` | ${summary}` : ''}`
  })
  return text(
    [
      `${models.length} model(s). Call get_model(modelId) for the full request shape before generating:`,
      ...rows,
    ].join('\n'),
  )
}

/** One model's full request shape (the grounding view). */
export function modelResult(m: ModelInfo): CallToolResult {
  const res = cap(m, 'resolution')
  const ar = cap(m, 'aspectRatio')
  const dur = cap(m, 'duration')
  const gen = cap(m, 'generations')
  const audio = cap(m, 'audio')
  const features = cap(m, 'features') as Record<string, boolean> | undefined
  const enabledFeatures = features ? Object.keys(features).filter((k) => features[k]) : []
  const refLines = [
    cap(m, 'maxImageRefs') ? `image refs: up to ${cap(m, 'maxImageRefs')}` : null,
    cap(m, 'maxVideoRefs') ? `video refs: up to ${cap(m, 'maxVideoRefs')}` : null,
    cap(m, 'maxAudioRefs') ? `audio refs: up to ${cap(m, 'maxAudioRefs')}` : null,
  ].filter(Boolean) as string[]

  return text(
    lines([
      `${m.modelId} (${m.displayName})${m.isDefault ? ' [default]' : ''}`,
      `type: ${m.contentType} | operation: ${m.kind}`,
      m.description ? `description: ${m.description}` : null,
      m.tags.length ? `tags: ${m.tags.join(', ')}` : null,
      '',
      'Request shape:',
      `  prompt: ${cap(m, 'promptMode') ?? 'optional'}${cap(m, 'promptMaxChars') ? ` (max ${cap(m, 'promptMaxChars')} chars)` : ''}`,
      Array.isArray(cap(m, 'inputTypes')) && cap(m, 'inputTypes').length
        ? `  input types: ${cap(m, 'inputTypes').join(', ')}`
        : null,
      res?.supported?.length
        ? `  resolution: ${res.supported.join(', ')}${res.default ? ` (default ${res.default})` : ''}`
        : null,
      ar?.supported?.length
        ? `  aspect ratio: ${ar.supported.join(', ')}${ar.default ? ` (default ${ar.default})` : ''}`
        : null,
      durationSummary(dur) ? `  duration: ${durationSummary(dur)}${dur?.default ? ` (default ${dur.default}s)` : ''}` : null,
      audio?.supported ? `  audio: supported${audio.alwaysOn ? ' (always on)' : ''}` : null,
      cap(m, 'negativePrompt') ? '  negativePrompt: supported' : null,
      gen ? `  generations: ${gen.min}-${gen.max} (default ${gen.default})` : null,
      ...refLines.map((l) => `  ${l}`),
      enabledFeatures.length ? `  features: ${enabledFeatures.join(', ')}` : null,
      ...promptReferenceLines(m.promptReferences),
      '',
      "Build the request within this shape, preview cost with the matching generate tool's getCost option, then run it.",
    ]),
  )
}

export function platformListResult(platforms: PlatformSummary[]): CallToolResult {
  if (!platforms.length) return text('No publish platforms found.')
  const rows = platforms.map((p) => {
    const fmts = p.formats.map((f) => f.value).join(', ')
    return `- ${p.platform} (${p.name})${p.connected ? ' [connected]' : ''} | formats: ${fmts || 'post'}`
  })
  return text(
    [
      `${platforms.length} publish platform(s). Call get_platform(platform[, format]) for the exact fields, options, and limits a post requires:`,
      ...rows,
    ].join('\n'),
  )
}

export function platformResult(p: PlatformSchema): CallToolResult {
  const fmtBlocks = p.formats.map((fmt) => {
    const fields = Object.keys(p.fieldTemplatesByFormat[fmt] ?? {})
    return `  ${fmt}: ${fields.length ? fields.join(', ') : '(no fields)'}`
  })
  const enumLines = Object.entries(p.enums).map(([k, vals]) => {
    const rendered = vals
      .map((v) => (v && typeof v === 'object' && 'id' in (v as Record<string, unknown>) ? String((v as Record<string, unknown>).id) : String(v)))
      .join(', ')
    return `  ${k}: ${rendered}`
  })
  const limitLines = p.characterLimits
    ? Object.entries(p.characterLimits).map(([k, n]) => `  ${k}: ${n}`)
    : []
  return text(
    lines([
      `${p.platform} (${p.name})`,
      `formats: ${p.formats.join(', ')}`,
      `posting modes: ${p.postingModes.join(', ')}`,
      '',
      'Fields by format (set these as platformSettings on add_post_destination / update_post_destination):',
      ...fmtBlocks,
      enumLines.length ? '' : null,
      enumLines.length ? 'Allowed option values:' : null,
      ...enumLines,
      limitLines.length ? '' : null,
      limitLines.length ? 'Character limits:' : null,
      ...limitLines,
      '',
      'Fill platformSettings to this shape, then attach with add_post_destination (or update_post_destination).',
    ]),
  )
}

/** Render the reference-addressing guidance (how to tag references in the prompt). */
function promptReferenceLines(pr: ModelInfo['promptReferences']): Array<string | null> {
  if (!pr || pr.scheme === 'none') return []
  const tokens = pr.inputs
    .filter((i) => i.token)
    .map((i) => `${i.token}${i.max > 1 ? ` (up to ${i.max})` : ''}`)
    .join(', ')
  return [
    '',
    `Referencing (${pr.scheme}${pr.honored ? ', bound' : ', positional'}):`,
    `  ${pr.instruction}`,
    tokens ? `  tokens: ${tokens}` : null,
  ]
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
      p.tags?.length ? `tags: ${p.tags.join(', ')}` : null,
      `destinations (${p.destinations.length}):`,
      ...p.destinations.map((d) => {
        const set = settingsKeys(d.platformSettings)
        return `  - ${d.platform} (id ${d.id})${d.format ? ` ${d.format}` : ''} | ${d.status ?? 'draft'}${d.connectedAccountId ? ` | account ${d.connectedAccountId}` : ' | no connected account'}${set ? ` | settings: ${set}` : ''}`
      }),
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

/** The non-empty keys of a destination's platformSettings, for a compact summary. */
function settingsKeys(settings: Record<string, unknown> | null | undefined): string | null {
  if (!settings) return null
  const keys = Object.keys(settings).filter((k) => {
    const v = settings[k]
    if (v == null) return false
    if (Array.isArray(v)) return v.length > 0
    if (typeof v === 'string') return v.length > 0
    return true
  })
  return keys.length ? keys.join(', ') : null
}

/** A created or updated destination. */
export function destinationResult(d: PostDestination): CallToolResult {
  const set = settingsKeys(d.platformSettings)
  return text(
    `Destination: ${d.platform} (id ${d.id})${d.format ? ` ${d.format}` : ''} | ${d.status ?? 'draft'}${d.connectedAccountId ? ` | account ${d.connectedAccountId}` : ' | no connected account (set one before publishing)'}${set ? ` | settings: ${set}` : ' | no settings (set platformSettings to make it publishable)'}.`,
  )
}

/** An attached asset. */
export function assetResult(a: PostAsset): CallToolResult {
  return text(`Asset attached: [${a.assetType ?? '?'}] ${a.assetUrl ?? '(no url)'} (id ${a.id}).`)
}

/** A post's assets in their (new) order. */
export function assetOrderResult(assets: PostAsset[]): CallToolResult {
  if (!assets.length) return text('No assets on this post.')
  return text(
    [
      `Assets reordered (${assets.length}):`,
      ...assets.map((a, i) => `  ${i + 1}. [${a.assetType ?? '?'}] ${a.assetUrl ?? '(no url)'} (id ${a.id})`),
    ].join('\n'),
  )
}

/** Confirmation of a detached asset. */
export function assetRemovedResult(r: { id: string }): CallToolResult {
  return text(`Asset removed (id ${r.id}).`)
}

/** Confirmation of a detached destination. */
export function destinationRemovedResult(r: { id: string }): CallToolResult {
  return text(`Destination removed (id ${r.id}).`)
}

/** The account's tags. */
export function tagListResult(tags: Tag[]): CallToolResult {
  if (!tags.length) return text('No tags yet. Create one with create_tag.')
  return text(
    [`${tags.length} tag(s):`, ...tags.map((t) => `- ${t.name} (id ${t.id})`)].join('\n'),
  )
}

/** A created or renamed tag. */
export function tagResult(t: Tag, verb = 'Tag'): CallToolResult {
  return text(`${verb}: ${t.name} (id ${t.id}).`)
}

/** Confirmation of a deleted tag. */
export function tagDeletedResult(r: { id: string }): CallToolResult {
  return text(`Tag deleted (id ${r.id}). It was removed from all posts.`)
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

/** One line summarizing a connected account (a publish target). */
function connectedAccountLine(a: ConnectedAccount): string {
  const handle = a.accountHandle ? `@${a.accountHandle}` : (a.accountName ?? '(unnamed)')
  const status = a.connectionStatus ? ` | ${a.connectionStatus}` : ''
  return `- ${handle} (id ${a.id}) | ${a.platform ?? '?'}${a.isDefault ? ' [default]' : ''}${status}`
}

/** List of connected accounts (publish targets). */
export function connectedAccountListResult(accounts: ConnectedAccount[]): CallToolResult {
  if (!accounts.length) {
    return text('No connected accounts. Connect a social account in the ContentHero app to publish.')
  }
  return text(
    [`${accounts.length} connected account(s):`, ...accounts.map(connectedAccountLine)].join('\n'),
  )
}

/** One connected account in detail, including its capabilities. */
export function connectedAccountResult(a: ConnectedAccount): CallToolResult {
  const handle = a.accountHandle ? `@${a.accountHandle}` : (a.accountName ?? '(unnamed)')
  const caps = a.capabilities ? Object.keys(a.capabilities).filter((k) => (a.capabilities as Record<string, unknown>)[k]) : []
  return text(
    lines([
      `${handle} (id ${a.id}) | ${a.platform ?? '?'}${a.isDefault ? ' [default]' : ''}`,
      `status: ${a.connectionStatus ?? 'unknown'}${a.connectionType ? ` (${a.connectionType})` : ''}`,
      a.accountUrl ? `url: ${a.accountUrl}` : null,
      caps.length ? `capabilities: ${caps.join(', ')}` : null,
      a.lastValidatedAt ? `last validated: ${a.lastValidatedAt}` : null,
      `Use this id as connectedAccountId on add_post_destination to publish here.`,
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

// -- editor / canvas ops ------------------------------------------------------

/** The outcome of an applyEditorOps batch: the new revision + a per-op summary. */
export function editorOpsResult(r: ApplyEditorOpsResult): CallToolResult {
  const okCount = r.results.filter((x) => x.ok).length
  const failures = r.results.filter((x) => !x.ok)
  const created = r.results.flatMap((x) => x.createdIds ?? [])
  const lines = [
    `Applied ${okCount}/${r.results.length} ${r.surface} op(s). New revision: ${r.revision}.`,
  ]
  if (created.length) lines.push(`Created: ${created.join(', ')}.`)
  if (r.renderUrl) lines.push(`Preview: ${r.renderUrl}`)
  if (failures.length) {
    lines.push('Failed ops:')
    for (const f of failures) lines.push(`  - ${f.op}: ${f.error ?? 'unknown error'}`)
  }
  const warnings = r.results.flatMap((x) => x.warnings ?? [])
  if (warnings.length) lines.push(`Warnings: ${warnings.join('; ')}.`)
  // A partial failure is surfaced as an error result so the caller (agent) can self-correct.
  return text(lines.join('\n'), failures.length > 0)
}

/** A single project's full detail (read-before-write): metadata, surface, revision, and the state JSON. */
export function projectDetailResult(p: ProjectDetail): CallToolResult {
  return text(
    `Project ${p.id}: "${p.title}" (${p.kind}, surface: ${p.surface}, ${p.orientation} ${p.width}x${p.height}), revision ${p.revision}.\n` +
      `Pass this revision back as expectedRevision when you edit.\n` +
      (p.renderUrl ? `Preview: ${p.renderUrl}\n` : '') +
      `\n` +
      JSON.stringify(p.state, null, 2),
  )
}

/**
 * Live context (get_context). Returns a text summary + the discriminated context JSON, and, when a canvas
 * session provided a focused-slide snapshot, an IMAGE content block so the calling model can actually SEE what
 * the user is looking at (the vision parity with the internal assistant). The caller fetches + base64-encodes
 * the snapshot; this just assembles the result.
 */
export function liveContextResult(
  result: LiveContextResult,
  snapshot?: { data: string; mimeType: string } | null,
): CallToolResult {
  const { context, participant, participants } = result
  if (!context || !participant) {
    return text(
      'No live context: no one is currently viewing this in the open app (no session within the presence window). ' +
        'The user may not have the editor/studio/content open right now.',
    )
  }
  const others = participants.length > 1 ? ` (${participants.length} live participants; showing the most recent)` : ''
  const summary =
    `Live context on the ${String(context.surface)} surface${others}, updated ${participant.updatedAt}.\n` +
    (snapshot ? 'An image of what the user is looking at is attached below.\n' : '') +
    `\n` +
    JSON.stringify(context, null, 2)
  const content: CallToolResult['content'] = [{ type: 'text', text: summary }]
  if (snapshot) content.push({ type: 'image', data: snapshot.data, mimeType: snapshot.mimeType })
  return { content }
}

/** The project list: one line per project (id, kind, title, state flags). */
export function projectListResult(projects: ProjectSummary[]): CallToolResult {
  if (projects.length === 0) return text('No projects found.')
  const lines = projects.map((p) => {
    const flags = [p.isArchived ? 'archived' : null, p.isFavorited ? 'favorited' : null].filter(Boolean).join(', ')
    return `- ${p.id}  [${p.kind}]  "${p.title}"  ${p.orientation}${flags ? `  (${flags})` : ''}`
  })
  return text(`${projects.length} project(s):\n${lines.join('\n')}`)
}

/** A freshly created project: the id + kind to start editing against. */
export function projectCreatedResult(p: ProjectDetail): CallToolResult {
  return text(
    `Created ${p.kind} project ${p.id}: "${p.title}" (${p.orientation} ${p.width}x${p.height}), revision ${p.revision}.\n` +
      `Use this id with update_${p.surface === 'canvas' ? 'canvas' : 'timeline'} to add content.`,
  )
}

/** Confirmation of a permanent delete. */
export function projectDeletedResult(projectId: string): CallToolResult {
  return text(`Permanently deleted project ${projectId}. This cannot be undone.`)
}

/** The canvas layer-type catalog (types + editable props) as readable text + the JSON. */
export function layerTypesResult(cat: LayerTypeCatalog): CallToolResult {
  const lines = cat.layerTypes.map((t) => `- ${t.type}: ${t.description} (props: ${t.props.map((p) => p.name).join(', ')}; supports: ${t.supports.join(', ')})`)
  return text(
    `Canvas layer types (edit via update_canvas ops):\n${lines.join('\n')}\n\nShared prop groups: ${Object.keys(cat.sharedProps).join(', ')}.\n\n` +
      JSON.stringify(cat, null, 2),
  )
}

/** A completed export -> the download URL; an in-flight one -> the exportId to poll. */
export function exportJobResult(job: ExportJob): CallToolResult {
  if (job.status === 'completed') {
    return text(`Export ${job.exportId} completed.\nDownload: ${job.outputUrl}`)
  }
  if (job.status === 'failed') {
    return text(`Export ${job.exportId} failed: ${job.errorMessage ?? 'unknown error'}.`, true)
  }
  const pct = typeof job.progress === 'number' ? ` (${Math.round(job.progress * 100)}%)` : ''
  return text(
    `Export ${job.exportId} is ${job.status}${pct}. Still rendering. Poll get_export with this exportId for the download URL.`,
  )
}

/** The export-format catalog as readable text + JSON. */
export function exportFormatsResult(cat: ExportFormatCatalog): CallToolResult {
  const lines = cat.formats.map((f) => `- ${f.format} (${f.surfaces.join('/')}${f.async ? ', async' : ''}): ${f.description}`)
  return text(
    `Export formats:\n${lines.join('\n')}\n\nResolutions (mp4): ${cat.resolutions.join(', ')}. Qualities: ${cat.qualities.join(', ')}.\n\n` +
      JSON.stringify(cat, null, 2),
  )
}

/** The editor timeline clip + track-type catalog as readable text + the JSON. */
export function editorTranscriptResult(r: TranscriptResult): CallToolResult {
  if (!r.mediaTranscribed) {
    return text(r.note ?? 'No transcript available for this project yet.')
  }
  // A readable, clip-by-clip transcript in timeline order: each line is one clip, marked when it is a cut
  // (disabled) so the agent sees what is already removed. The full structured data (clipIds, source times)
  // follows as JSON for exact targeting via update_timeline.
  const lines = r.segments.map((s) => {
    const tag = s.disabled ? `[CUT${s.disabledReason ? `:${s.disabledReason}` : ''}]` : '[in]'
    const body = s.text ? s.text : '(no speech)'
    return `${tag} ${s.clipId}  ${s.sourceStartMs}-${s.sourceEndMs}ms: ${body}`
  })
  return text(
    `Transcript for ${r.projectId} (${r.segmentCount} clip segment(s), ${r.fps}fps). [CUT] = disabled/removed, [in] = kept.\n` +
      `Target a clipId with update_timeline set_disabled (to cut) or set_disabled disabled:false (to restore).\n\n` +
      `${lines.join('\n')}\n\n` +
      JSON.stringify(r, null, 2),
  )
}

export function timelineTypesResult(cat: TimelineTypeCatalog): CallToolResult {
  const clips = cat.clipTypes.map((t) => `- ${t.type}: ${t.description} (props: ${t.props.map((p) => p.name).join(', ')})`)
  const tracks = cat.trackTypes.map((t) => `- ${t.trackType}: holds ${t.holds.join(', ')}`)
  return text(
    `Editor timeline clip types (edit via update_timeline ops):\n${clips.join('\n')}\n\nTrack types:\n${tracks.join('\n')}\n\nShared prop groups: ${Object.keys(cat.sharedProps).join(', ')}.\n\n` +
      JSON.stringify(cat, null, 2),
  )
}
