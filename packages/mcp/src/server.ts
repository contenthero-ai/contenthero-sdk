/**
 * The ContentHero MCP tool surface: intent-shaped tools over the @contenthero/sdk
 * kernel.
 *
 *   generate_image    - smart-wait, image models
 *   generate_video    - smart-wait, video models
 *   generate_audio    - synchronous (ElevenLabs), no polling
 *   upscale           - smart-wait, image/video upscalers
 *   generate_lip_sync - smart-wait, talking-head lip-sync (portrait + audio/script)
 *   transcribe        - synchronous speech-to-text (audio URL -> transcript)
 *   list_avatars / get_avatar - the account's avatars (base look + default voice)
 *   list_voices  / get_voice  - the account's saved voices
 *   list_brand_kits / get_brand_kit - the account's brand kits (full brand context)
 *   list_media / get_media    - the account's studio outputs (+ per-variation ids)
 *   search_media              - semantic search of the editable media library (with scene timestamps)
 *   get_generation_status - check 1-8 outputIds; blocks until terminal by default
 *   get_balance       - credit balance + tier
 *   ... plus the content-pipeline, brand-kit-write, inspiration, brand-account,
 *   and connected-account tools.
 *
 * `registerTools(server, opts)` registers the whole surface against a backend
 * resolved PER CALL via `opts.getClient(extra)`. The stdio/npm server passes a
 * single env-configured client (identity is in the API key); the hosted OAuth
 * server passes a factory that resolves a per-user client from the validated
 * token's `extra.authInfo`. Tool schemas (incl. the per-tool model enums) are
 * fixed at registration, so the model enums are supplied via `opts.models`.
 *
 * Intent-shaped generate tools rather than one generate_media: each operation
 * (generate / upscale / lip-sync) gets a tool whose schema only carries its own
 * fields, and per-tool modelId enums prevent cross-type model misuse.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
/**
 * ⚠️⚠️ **THE CONSTANTS ONLY, NOT THE `./server` HELPERS, AND THAT IS DELIBERATE.**
 *
 * `@modelcontextprotocol/ext-apps@2` targets the SPLIT packages (`@modelcontextprotocol/server`), while this
 * server is built on the monolithic `@modelcontextprotocol/sdk@1.26`. Its `registerAppResource` therefore
 * typechecks against a different `ResourceMetadata` than ours and rejects `description`.
 *
 * ⭐ The helper is convenience over a two-line contract: a resource whose mimeType is the app profile, and a
 * tool result whose `_meta` names it. Registering through OUR `server.registerResource` keeps one server
 * abstraction instead of two, and the STRINGS still come from the package, so the part that must match the
 * spec has a single source. Migrating to the split SDK is its own piece of work, not a prerequisite for this.
 */
import { RESOURCE_MIME_TYPE, RESOURCE_URI_META_KEY } from '@modelcontextprotocol/ext-apps'
import { z } from 'zod'
import {
  ContentHero,
  GenerationTimeoutError,
  pendingOutputId,
  type GenerateRequest,
  type GenerateBoardRequest,
  type EditAudioRequest,
  type References,
  type EditorOp,
  type PostInput,
  type BrandKitSectionInput,
  type BrandKitAccountInput,
  type CardAssetInput,
  type UpdateAvatarRequest,

  type Generation,
} from '@contenthero/sdk'
import { getClient as defaultGetClient } from './client.js'

/** This module's own directory, so the widget is read from the PACKAGE rather than from the cwd. */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url))

export { GENERATION_WIDGET_URI } from './widget-uri.js'
import { GENERATION_WIDGET_URI } from './widget-uri.js'
import {
  resolveModelEnums,
  type ResolvedModelEnums,
  BOARD_TYPES,
  BOARD_TYPE_GUIDANCE,
  IMAGE_MODEL_GUIDANCE,
  VIDEO_MODEL_GUIDANCE,
  AUDIO_MODEL_GUIDANCE,
  EDIT_AUDIO_MODEL_GUIDANCE,
  UPSCALE_MODEL_GUIDANCE,
  LIP_SYNC_MODEL_GUIDANCE,
} from './models.js'
import {
  assetResult,
  audioResult,
  avatarListResult,
  avatarResult,
  avatarPendingResult,
  balanceResult,
  brandKitListResult,
  brandKitResult,
  brandKitSectionResult,
  brandKnowledgeListResult,
  brandKnowledgeDetailResult,
  brandKnowledgeSearchResult,
  brandKnowledgeItemResult,
  completedResult,
  type GeneratedAttachment,
  connectedAccountListResult,
  connectedAccountResult,
  costResult,
  postResult,
  accountDetailResult,
  inspirationContentResult,
  mediaListResult,
  mediaSearchResult,
  folderListResult,
  folderContentsResult,
  mediaBatchResult,
  mediaUploadResult,
  importedMediaResult,
  uploadedMediaResult,
  assetOrderResult,
  assetRemovedResult,
  postRemovedResult,
  tagListResult,
  tagResult,
  tagDeletedResult,
  modelListResult,
  modelResult,
  platformListResult,
  platformResult,
  elementListResult,
  elementResult,
  elementDeletedResult,
  errorResult,
  generationBatchResult,
  outlierListResult,
  enhanceClipsResult,
  pendingResult,
  stageListResult,
  stageResult,
  stageDeletedResult,
  spaceDeletedResult,
  spaceListResult,
  spaceResult,
  cardListResult,
  cardResult,
  postSummaryResult,
  publishResult,
  statusActionResult,
  editorOpsResult,
  text,
  projectDetailResult,
  liveContextResult,
  projectListResult,
  projectCreatedResult,
  projectDeletedResult,
  layerTypesResult,
  timelineTypesResult,
  editorTranscriptResult,
  exportJobResult,
  exportFormatsResult,
  trackedAccountListResult,
  transcriptResult,
  voiceListResult,
  voiceResult,
} from './format.js'

/** Platforms a card or one of its posts may target. */
const POST_PLATFORMS = [
  'youtube',
  'instagram',
  'tiktok',
  'facebook',
  'linkedin',
  'x',
  'threads',
  'general',
] as const

/**
 * How long the smart-wait tools (generate_image / generate_video / upscale /
 * generate_lip_sync) wait inline before handing back the outputId to poll.
 * Kept under the MCP SDK's default 60s client request timeout, so a slow render
 * returns the clean "still rendering, call get_generation_status" handoff rather
 * than tripping the client's timeout.
 */
const SMART_WAIT_MS = 50_000

/**
 * Tool annotations drive how MCP clients group the surface. readOnlyHint=true
 * tools list under "Read-only"; the rest list under "Interactive". publish is
 * also flagged destructive (it pushes content to public social accounts).
 */
const READ = { readOnlyHint: true } as const
const WRITE = { readOnlyHint: false } as const
const PUBLISH = { readOnlyHint: false, destructiveHint: true } as const

/**
 * Placement intent for the generative tools' optional one-call timeline placement. Mirrors the SDK
 * `PlacementIntent` union. All positional fields are in SECONDS (resolved to frames server-side via the
 * project fps). Shared across the generative tools as they gain `projectId` placement.
 */
const TRACK_SELECTOR_DESC =
  "Which track to place on: 'overlay' (a non-primary track with room, else a new track), 'primary' (the main track, media only), or a specific track id. Omit for the default track."
const TIMELINE_PLACEMENT_SCHEMA = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('append') }).describe('Land after the last clip on the best track of the clip\'s kind, or a new track.'),
  z.object({ mode: z.literal('at'), startSeconds: z.number().optional(), track: z.string().optional().describe(TRACK_SELECTOR_DESC), durationSeconds: z.number().optional().describe('For an IMAGE placed as a point, the clip length in seconds (omitted uses the default still duration). Ignored for video/audio, whose length is the asset\'s own.') }).describe('Land at an explicit time; optionally choose the track.'),
  z.object({ mode: z.literal('atPlayhead'), durationSeconds: z.number().optional().describe('For an IMAGE placed as a point, the clip length in seconds (omitted uses the default still duration). Ignored for video/audio.') }).describe('Land at the current playhead.'),
  z.object({ mode: z.literal('replace'), itemId: z.string(), duration: z.enum(['natural', 'match']).optional() }).describe('Swap in place for an existing clip; the new clip inherits its track + start.'),
  z.object({ mode: z.literal('range'), startSeconds: z.number().optional(), endSeconds: z.number().optional(), track: z.string().optional().describe(TRACK_SELECTOR_DESC), fit: z.enum(['cover', 'trim', 'overwrite']).optional() }).describe('Fill or cover a time span; optionally choose the track.'),
])

/**
 * CANVAS placement (6A A8): places the generated asset as a LAYER on a slide. Flat (no mode); the server reads it
 * only for a canvas-design project. All fields optional. Positions/sizes are design pixels; the response returns
 * the created layerId + resolvedSlideId so you can chain further ops (animate / reposition / reorder).
 */
const CANVAS_PLACEMENT_SCHEMA = z.object({
  slideId: z.string().optional().describe('The target slide. Omitted, the asset is placed on the slide the user is currently focused on (the one centered in their viewport, the same focused slide get_context reports), falling back to the first slide when no view is active.'),
  slideIndex: z.number().int().min(1).optional().describe('1-based slide number, an alternative to slideId.'),
  fit: z.enum(['contain', 'cover', 'none']).optional().describe("How the asset is sized to the slide: 'contain' (default) scales to fit inside it, 'cover' fills it edge to edge, 'none' uses a default box. Overridden by explicit width/height."),
  anchor: z.enum(['center', 'top-left', 'top', 'top-right', 'left', 'right', 'bottom-left', 'bottom', 'bottom-right']).optional().describe('A nine-point anchor positioning the layer relative to the slide (default center).'),
  x: z.number().optional().describe('Fine position offset in design pixels from the anchor (from slide center when no anchor is given).'),
  y: z.number().optional().describe('Fine position offset in design pixels from the anchor.'),
  width: z.number().optional().describe('Explicit layer width in design pixels; the precise escape hatch that overrides fit.'),
  height: z.number().optional().describe('Explicit layer height in design pixels; overrides fit.'),
  asBackground: z.boolean().optional().describe("Make the generated asset the slide's BACKGROUND rather than a free layer: placed full-bleed and promoted into the background slot once it lands. Ignores anchor / x / y / width / height (a background fills the slide)."),
}).describe('Canvas placement: place the asset as a layer on a slide (or as the slide background with asBackground).')

const PLACEMENT_SCHEMA = z.union([TIMELINE_PLACEMENT_SCHEMA, CANVAS_PLACEMENT_SCHEMA])

/** The optional one-call placement input fields, shared across the generative tools that gain projectId. */
const PLACEMENT_INPUT_FIELDS = {
  projectId: z.string().optional().describe('The project to place the result on. Omit for a standalone library output. The server interprets placement against the project\'s surface (video timeline or canvas design).'),
  placement: PLACEMENT_SCHEMA.optional().describe('Where the asset lands, interpreted against the project\'s surface. VIDEO TIMELINE: append to the end, at a time, at the playhead, replacing an existing clip, or filling a time range (omitted places it at the playhead when known, else appends). CANVAS DESIGN: a layer on a slide (slideId / slideIndex, default the focused slide; fit contain|cover|none; a nine-point anchor; and design-pixel x/y/width/height).'),
  playheadFrame: z.number().optional().describe('The current playhead frame, for playhead-relative timeline placement.'),
} as const

/**
 * Fetch a get_context snapshot signed URL and base64-encode it, so get_context can return an IMAGE content
 * block the calling model actually sees. Best-effort: any failure returns null and the tool still returns the
 * textual context. The signed URL is self-authorizing (no secret needed here).
 */
async function fetchSnapshotBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const mimeType = res.headers.get('content-type') || 'image/webp'
    const data = Buffer.from(await res.arrayBuffer()).toString('base64')
    return { data, mimeType }
  } catch {
    return null
  }
}

/**
 * The asset itself, ready to attach to a finished generation.
 *
 * ## The rule, per medium
 *
 * ⭐⭐⭐ **BYTES FOR WHAT MCP CAN CARRY, A LINK FOR WHAT IT CANNOT.** Images and audio have first-class
 * content blocks and modest sizes, so they are embedded: that is what makes them render in the chat, and it
 * is also what makes them permanent, because bytes in a transcript cannot expire. Video has no block of its
 * own and a ten-second 1080p clip would be megabytes of base64 in every future turn of the conversation, so
 * it travels as a `resource_link` pointing at a capability url.
 *
 * ⛔ **FAILING TO FETCH IS NOT AN ERROR.** A generation that succeeded must never be reported as failed
 * because we could not inline a preview of it. Every failure path returns no attachment and the text result
 * stands on its own, which is exactly what the caller got before this existed.
 *
 * ⚠️ ONLY THE FIRST OUTPUT IS EMBEDDED WHEN THERE ARE MANY. A four-image batch as four base64 payloads is a
 * large multiple of the same conversation cost, and the urls for the rest are already in the text. The cap
 * is stated here rather than left implicit, because a silent truncation reads as "that is all there was".
 */
/**
 * ⭐⭐⭐ **EVERY OUTPUT, AS A LINK, NOT THE FIRST ONE AS BYTES.**
 *
 * The first version embedded base64 for images and audio and capped at one attachment. Both halves were
 * wrong, and they were wrong together:
 *
 *   - **The cap made a four-variation batch show one variation.** Generating four and seeing one is not a
 *     smaller version of the feature, it is a broken one: the whole point of a batch is to compare them.
 *   - **Base64 is charged to the user's context on every subsequent turn.** A four-image batch embedded as
 *     bytes is a large multiple of the same cost, repeated for the rest of the conversation.
 *
 * ⭐ A `resource_link` costs a URL and renders in the host's UI, so ALL of them can come back. Verified
 * against a working implementation: the Higgsfield MCP returns `resource_link` for its media and it renders.
 *
 * ## ⛔ THE THING THIS DELIBERATELY GIVES UP, AND WHERE IT WENT INSTEAD
 *
 * An `image` block feeds the MODEL's vision; a `resource_link` gives the HOST something to render for the
 * human. Measured in this very session: when a link came back from another MCP, the model received text and
 * could not see the picture.
 *
 * So the model can no longer critique a generation it just made from this result alone. That is the correct
 * trade, because **`get_media` already exists to embed bytes for exactly that purpose** and an agent calls
 * it when it actually needs to look. Deciding on every generation that the model probably wants to look was
 * the wrong default: it spent the user's context to answer a question nobody asked.
 *
 * ⚠️ NO SSRF FETCH HAPPENS HERE ANY MORE. Nothing is downloaded, so the allowlist that guards
 * `fetchSnapshotBase64` is not on this path; the url is handed to the host to fetch under its own rules.
 */
const LINK_MIME: Record<string, string> = {
  image: 'image/png',
  video: 'video/mp4',
  audio: 'audio/mpeg',
}

/**
 * ⛔⛔⛔ **A `resource_link` DOES NOT RENDER. MEASURED IN BOTH HOSTS, IN PRODUCTION, 2026-09-19.**
 *
 * This returned `kind: 'link'` for every output, including images, and the result was the feature not
 * working at all:
 *
 *   - **ChatGPT** showed the output id and a "View the generated image" hyperlink. Clicking it opened the
 *     asset in a NEW TAB, which is the opposite of inline.
 *   - **Claude** showed NOTHING. No image, no link, no output id.
 *
 * ⚠️ **THE FORMATTER COULD ALWAYS DO THIS AND NOTHING EVER ASKED IT TO.** `completedResult` has handled a
 * `kind: 'bytes'` attachment since it was written, and its own docblock claims images get first-class
 * blocks. This function never produced one, so the branch had no caller. Same shape as the capability-url
 * no-op: a path that exists, typechecks, passes tests, and is unreachable.
 *
 * ⭐ **AN `image` BLOCK IS THE ONLY THING A HOST ACTUALLY RENDERS**, and it feeds the model's vision as
 * well, so the earlier reasoning that `get_media` covers the looking case was answering a different
 * question than the one the user asked: they wanted to SEE it.
 *
 * ## Both, not either
 *
 * Images get a block AND a link. The block is the small `.preview.webp` sibling, so inline display costs a
 * few hundred tokens rather than the megabytes a 2736x1536 original would. The link is the capability url:
 * permanent, full resolution, and the thing to click when the preview is not enough.
 *
 * ⚠️ VIDEO STAYS LINK-ONLY. MCP has no video content block, and base64 video in a transcript is not a
 * trade worth making. Audio likewise has no small derivative to send, so it stays a link too.
 */
/**
 * ⛔⛔ **THERE IS NO HOST DETECTION HERE, AND THAT IS NOT AN OVERSIGHT.**
 *
 * The obvious optimization is to skip the bytes when the host will mount the widget, since the widget loads
 * media from a URL and the blocks are only a fallback. I wrote it, and it could never work: MCP Apps
 * declares its support under `capabilities.extensions["io.modelcontextprotocol/ui"]`, and
 * **`@modelcontextprotocol/sdk@1.26` does not know the word `extensions`** (measured: zero occurrences in
 * its types). The schema strips it, so `getClientCapabilities()` returns the same answer for a host that
 * mounts widgets and one that cannot, and the check silently reduced to a constant.
 *
 * ⭐ A CHECK THAT ALWAYS ANSWERS THE SAME WAY IS WORSE THAN NO CHECK: it reads as a decision being made.
 * Deleted, and the budget below is what keeps every result under the host's ceiling on its own.
 *
 * ⏭️ The split packages (`@modelcontextprotocol/server@2`) carry the field. Migrating to them is what
 * unlocks this, and it is its own piece of work rather than a prerequisite for rendering.
 */
export async function attachmentsFor(gen: Generation): Promise<GeneratedAttachment[]> {
  /**
   * ⛔⛔⛔ **ONE BUDGET FOR THE WHOLE RESULT, BECAUSE THE HOST'S CEILING IS PER RESULT.**
   *
   * This was a PER-ITEM cap, which is the same defect one level up from the one it replaced. Four images at
   * 600 KB each pass individually (822 KB encoded, under the budget) and total 3.3 MB, so the host rejects
   * the call and the person pays for four generations they cannot reach. Today's assets are ~3.6 MB apiece
   * and fail the per-item check anyway, so the batch case was safe BY ACCIDENT rather than by design.
   *
   * ⭐ Spending a single budget makes the envelope bounded no matter the count or the resolution: four 4K
   * images, ten variations, a 60 second video. Whatever does not fit degrades to a link, and the widget
   * renders it from a URL regardless, so nothing is lost but the fallback for hosts that cannot mount apps.
   */
  let budget = MAX_INLINE_BASE64_CHARS
  const urls = (gen.outputUrls ?? []).filter((u) => typeof u === 'string' && u.length > 0)
  const mimeType = LINK_MIME[gen.contentType]
  if (!mimeType) return []

  const ext = mimeType.split('/')[1]
  const out: GeneratedAttachment[] = []
  for (const [i, uri] of urls.entries()) {
    /**
     * ⭐ AUDIO HAS A FIRST-CLASS BLOCK TOO, and it plays inline exactly as an image draws. It is fetched the
     * same best-effort way: a miss degrades this one output to a link rather than failing a generation the
     * person already paid for.
     *
     * ⚠️ NO PREVIEW DERIVATIVE EXISTS FOR AUDIO, so this is the real file and the size cap is what stops a
     * long track going into the transcript. A voiceover is small; an hour of music is not, and that one
     * degrades to a link, which the widget renders anyway.
     */
    if (gen.contentType === 'audio') {
      const bytes = await fetchAudioBytes(uri, budget)
      if (bytes) {
        budget -= bytes.data.length
        out.push({ kind: 'bytes', type: 'audio', data: bytes.data, mimeType: bytes.mimeType })
      }
    }
    if (gen.contentType === 'image') {
      // Best-effort: a miss (host not allowlisted, over the budget, network hiccup) degrades this one output
      // to a link instead of failing a generation the user already paid for.
      const bytes = await fetchMediaImageBase64(uri, budget)
      if (bytes) {
        budget -= bytes.data.length
        out.push({ kind: 'bytes', type: 'image', data: bytes.data, mimeType: bytes.mimeType })
      }
    }
    out.push({
      kind: 'link',
      uri,
      mimeType,
      // Named per output so a batch reads as four distinct things rather than four copies of one name.
      name: `${gen.outputId}${urls.length > 1 ? `-${i + 1}` : ''}.${ext}`,
    })
  }
  return out
}

/**
 * True when an image URL is safe to fetch into an image block. SSRF allowlist:
 * our storage hosts plus the finite set of generation-provider CDNs that our
 * finalize pipeline stores as video posters (fal, cloudinary). The values fed
 * here are server-produced (a resolved variation url or a DB-stored thumbnail),
 * not raw caller input (the API already allowlists raw caller urls more strictly).
 */
function isAllowedImageHost(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    if (u.username || u.password) return false
    return (
      u.host === 'cloud.contenthero.ai' ||
      // ⭐ THE MEDIA GATEWAY. Generated assets now address through it with a capability token rather than a
      // presigned R2 url, so without this every inline attachment would be silently dropped by the SSRF
      // allowlist and the agent would be back to a bare link.
      u.host === 'media.contenthero.ai' ||
      u.host === 'cdn.contenthero.ai' ||
      u.host.endsWith('.supabase.co') ||
      u.host.endsWith('.fal.media') ||
      u.host.endsWith('.cloudinary.com')
    )
  } catch {
    return false
  }
}

/**
 * The optimized `.preview.webp` sibling of a studio-outputs image object, or the
 * url unchanged. Mirrors the app's previewImageSrc convention so we can prefer
 * the light derivative when it exists (and fall back to the raw when it does not,
 * e.g. an uploaded image or a not-yet-optimized video thumbnail). Pure string rule.
 */
function optimizedImageSibling(url: string): string {
  if (!url.includes('/object/public/studio-outputs/')) return url
  if (url.includes('.preview.webp')) return url
  const qIdx = url.indexOf('?')
  const path = qIdx < 0 ? url : url.slice(0, qIdx)
  const query = qIdx < 0 ? '' : url.slice(qIdx + 1)
  const rewritten = path.replace(/\.(png|jpe?g|webp|gif|avif|tiff?)$/i, '.preview.webp')
  if (rewritten === path) return url
  return query ? `${rewritten}?${query}` : rewritten
}

/**
 * ⛔⛔⛔ **A HOST ENFORCES A 1 MB CEILING ON A WHOLE TOOL RESULT, AND THIS IS SIZED AGAINST THAT.**
 *
 * Claude Desktop rejects an oversized result outright with "Tool result is too large. Maximum size is 1MB",
 * which fails the CALL rather than degrading the picture. Measured 2026-09-19 on a real `generate_image`:
 * the generation succeeded and was charged, and the person could not retrieve it.
 *
 * ⚠️ I SET THIS CAP WRONG TWICE BEFORE GETTING HERE. 1.5 MB was too low and would have silently degraded
 * real outputs back to links; 8 MB was too high and broke the host. Both were reasoned from what the BYTES
 * cost us. The number that actually governs belongs to the host, and it bounds the ENTIRE result: text,
 * structured content, every block. So the budget is expressed in BASE64 LENGTH, which is what travels, and
 * leaves room for everything else in the envelope.
 *
 * ⭐ Over budget, the item degrades to a link and the widget still renders it, because the widget loads from
 * a url rather than from bytes.
 *
 * ⚠️ **DERIVED, NOT PICKED.** The ceiling is 1,000,000 bytes for the ENTIRE serialized result. Measured on a
 * real one: text, `structuredContent` and the links together weigh about 2 KB. 900,000 base64 characters
 * leaves roughly 100 KB of headroom, and admits a 657 KB source asset. A 613 KB PNG measured in production
 * encodes to about 840 KB, so it fits with room to spare, where the 700,000 I first wrote would have thrown
 * it away. That was the third time I set this number from reasoning instead of from a measurement.
 */
const MAX_INLINE_BASE64_CHARS = 900_000

/**
 * The audio equivalent of `fetchImageBytes`, sharing its host allowlist, its size cap and its timeout.
 *
 * ⚠️ SEPARATE RATHER THAN A `kind` PARAMETER because the content-type CHECK is the difference, and a single
 * function taking "which prefix do I accept" is the shape that eventually accepts the wrong one.
 */
async function fetchAudioBytes(url: string, budget: number): Promise<{ data: string; mimeType: string } | null> {
  if (!isAllowedImageHost(url)) return null
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const mimeType = res.headers.get('content-type') || 'audio/mpeg'
    if (!mimeType.startsWith('audio/')) return null
    // Base64 inflates by about a third, so the declared byte length is checked against the budget it will
    // BECOME rather than against itself.
    const declared = Number(res.headers.get('content-length') ?? '')
    if (Number.isFinite(declared) && declared * 1.37 > budget) return null
    const data = Buffer.from(await res.arrayBuffer()).toString('base64')
    if (data.length > budget) return null
    return { data, mimeType }
  } catch {
    return null
  }
}

async function fetchImageBytes(url: string, budget: number): Promise<{ data: string; mimeType: string } | null> {
  if (!isAllowedImageHost(url)) return null
  try {
    /**
     * ⚠️⚠️ **A BARE `fetch` HAS NO TIMEOUT, AND THIS ONE IS ON THE PATH OF EVERY GENERATION RESULT.**
     *
     * One unresponsive asset would hang the whole tool call rather than degrading that item to a link, and
     * the caller would see a dead generation they had already paid for. Found by `verify:inline` hanging on
     * its first run after the status path started attaching.
     *
     * ⭐ Failing is CHEAP here and the fallback is good: no block, keep the link. Waiting is what is
     * expensive, so the budget is deliberately short.
     */
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const mimeType = res.headers.get('content-type') || 'image/jpeg'
    if (!mimeType.startsWith('image/')) return null
    // Checked BEFORE reading the body where the server declares it, and again after, because
    // `content-length` is absent on a chunked response and a header is not a measurement.
    const declared = Number(res.headers.get('content-length') ?? '')
    if (Number.isFinite(declared) && declared * 1.37 > budget) return null
    const data = Buffer.from(await res.arrayBuffer()).toString('base64')
    if (data.length > budget) return null
    return { data, mimeType }
  } catch {
    return null
  }
}

/**
 * Fetch a still image URL for an image content block, preferring the optimized
 * `.preview.webp` sibling and falling back to the raw url if that is missing. This
 * auto-upgrades as the optimization pipeline backfills derivatives, with no code
 * change here. Best-effort: any failure returns null and the item stays text-only.
 */
async function fetchMediaImageBase64(url: string, budget: number): Promise<{ data: string; mimeType: string } | null> {
  const optimized = optimizedImageSibling(url)
  if (optimized !== url) {
    const hit = await fetchImageBytes(optimized, budget)
    if (hit) return hit
  }
  return fetchImageBytes(url, budget)
}


/**
 * ⭐⭐⭐ **THE ONE PLACE THAT DECIDES HOW MUCH OF A RESULT MAY BE BYTES.**
 *
 * Two call sites needed this and each had its own answer, which is how the same defect appeared twice at
 * different levels: `attachmentsFor` capped PER ITEM while the host's ceiling is per RESULT, and `get_media`
 * fetched up to TEN images in parallel with no cap at all (10 x 840 KB is 8 MB against a 1 MB limit).
 *
 * ⛔ SEQUENTIAL, DELIBERATELY. The budget is shared state, so a parallel fetch cannot know what the others
 * already spent and every one of them would pass a check the set as a whole fails. Most calls carry one to
 * three items, so the latency is small and the alternative is a ceiling that holds only by luck.
 *
 * Returns one entry per input, `null` where the asset did not fit or could not be read, so callers keep
 * positional alignment with what they asked for.
 */
async function inlineImagesWithinBudget(
  urls: readonly (string | null | undefined)[],
): Promise<Array<{ data: string; mimeType: string } | null>> {
  let budget = MAX_INLINE_BASE64_CHARS
  const out: Array<{ data: string; mimeType: string } | null> = []
  for (const url of urls) {
    if (!url) {
      out.push(null)
      continue
    }
    const hit = await fetchMediaImageBase64(url, budget)
    if (hit) budget -= hit.data.length
    out.push(hit)
  }
  return out
}


/**
 * ⛔⛔⛔ **THE WIDGET IS DECLARED BY THE TOOL, NOT BY THE RESULT. I HAD IT ON THE RESULT.**
 *
 * A host reads `tool._meta` at `tools/list` time to learn that a tool renders a widget. Putting the binding
 * only on the CallToolResult means the host never knows to mount anything, so the result arrives as plain
 * blocks and the widget silently never appears. Measured in Claude Desktop 2026-09-19: four URLs as text,
 * no viewer, no error anywhere.
 *
 * ⚠️ BOTH SPELLINGS, DELIBERATELY. `_meta.ui.resourceUri` is the current format and `ui/resourceUri` the
 * legacy one, and the spec's own guidance is that hosts must accept either. Emitting both costs nothing and
 * removes a whole class of "works in one client" from the table.
 *
 * ⭐ Spread into the tools whose results are MEDIA. Not onto all 87: a tool that returns a card or a folder
 * has nothing for this widget to show, and claiming otherwise would put an empty frame under every call.
 */
const RENDERS_GENERATION = {
  _meta: {
    ui: { resourceUri: GENERATION_WIDGET_URI },
    [RESOURCE_URI_META_KEY]: GENERATION_WIDGET_URI,
  },
} as const

/** Resolve a per-call client. `extra` is the MCP tool handler's call context. */
export type GetClient = (extra?: unknown) => ContentHero | Promise<ContentHero>

export interface RegisterToolsOptions {
  /** Resolve the backend client for a given call (identity bound inside it). */
  getClient: GetClient
  /** Per-tool model enums, fixed at registration (see resolveModelEnums). */
  models: ResolvedModelEnums
}

export interface BuildServerOptions {
  /** Override the SDK client (for tests). Defaults to the env-configured client. */
  getClient?: () => ContentHero
}

/** Drop undefined values so the request payload stays minimal. */
function compact<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T
}

function buildReferences(parts: References): References | undefined {
  const refs = compact(parts as Record<string, unknown>) as References
  return Object.keys(refs).length > 0 ? refs : undefined
}

/**
 * Register the full ContentHero tool surface on `server`. Synchronous: the model
 * enums are supplied pre-resolved, and the backend client is resolved per call.
 */
export function registerTools(server: McpServer, opts: RegisterToolsOptions): void {
  const { getClient, models } = opts

  /**
   * 🚨🚨 **EVERY TOOL'S INPUT IS STRICT. AN UNDECLARED PARAMETER IS A 400, NEVER A SILENT DROP.**
   *
   * Zod object schemas STRIP unknown keys by default, and the SDK builds one from each `inputSchema` shape.
   * So before this wrapper, all 85 tools accepted any parameter they did not declare, discarded it, and ran
   * on whatever survived. The failure is invisible by construction: the caller gets a success.
   *
   * ⚠️ **THE MEASURED CASE, 2026-09-08.** `update_card` does not declare `ops`. A call passing `ops` had it
   * stripped, leaving only `cardId`, and returned **"Updated: 01.3 Design Your Character"** having written
   * nothing. A second call passing the nonsense op `__probe__` did the same. An agent running a batch of
   * partial edits would collect a full set of success messages and zero writes.
   *
   * ⭐⭐ **WRAPPED HERE RATHER THAN AT 85 CALL SITES, AND THAT IS THE POINT.** A rule every registration must
   * remember is a rule that holds until someone adds the 86th tool. Same move as `withSpineRegistration`
   * wrapping the Supabase client instead of asking 73 upload sites to declare an owner.
   *
   * ⚠️ **NESTED `.passthrough()` SURVIVES, DELIBERATELY.** `update_timeline` and `update_canvas` declare
   * `ops: z.array(z.object({ op: z.string() }).passthrough())` because a timeline op carries a different
   * shape per op type. Strictness here applies to the TOP-LEVEL argument object only, so those keep taking
   * varied op payloads while still rejecting an undeclared top-level parameter.
   */
  /**
   * ⭐⭐⭐ **THE GENERATION WIDGET: THE ONLY THING THAT PUTS A PLAYING VIDEO IN A CONVERSATION.**
   *
   * MCP's content blocks are `text | image | audio | resource | resource_link`. **There is no video block**,
   * so no arrangement of them can render video, and a `resource_link` renders as a hyperlink in ChatGPT and
   * as NOTHING in Claude. Measured in production 2026-09-19.
   *
   * MCP Apps is the mechanism that works. The server publishes an HTML resource under `ui://`, the host
   * mounts it, and the widget reads the tool's `structuredContent`. It is an open standard with an official
   * SDK (`@modelcontextprotocol/ext-apps`), verified against a working implementation before adoption.
   *
   * ⚠️ **THE HTML IS READ FROM THE PACKAGE, NOT FETCHED.** It ships inside the published tarball, so a local
   * install renders the same thing the hosted server does. Fetching it from our app would make the widget
   * depend on a deploy and break every offline or self-hosted install.
   *
   * ⛔ **REGISTERING THIS COSTS NOTHING FOR HOSTS THAT DO NOT SUPPORT IT.** A client that ignores `ui://`
   * resources simply never reads it, and the image and audio BLOCKS remain the fallback. That is why the
   * blocks stay rather than being replaced: two mechanisms, and the widget is the better one where it exists.
   */
  /**
   * ⚠️⚠️ **REGISTERED UNCONDITIONALLY, AND READ LAZILY.**
   *
   * This used to read the bundle at startup and register the resource only if it was found. Two problems.
   * A missing bundle produced a server that silently had no widget, which is the failure mode hardest to
   * notice: every tool still worked and nothing rendered. And the resource then did not exist when running
   * from `src/`, so the guard that checks tools point at a real resource could not run at all.
   *
   * ⭐ The resource is part of this server's contract. Advertising it always and throwing a NAMED error at
   * read time turns "no widget, no reason" into one line that says exactly what is missing.
   */
  server.registerResource(
    'generation',
    GENERATION_WIDGET_URI,
    {
      description: 'Shows what a generation produced: every variation, playable and downloadable.',
      mimeType: RESOURCE_MIME_TYPE,
    },
    async () => {
      const path = join(MODULE_DIR, 'widget', 'generation.html')
      let text: string
      try {
        text = readFileSync(path, 'utf8')
      } catch {
        throw new Error(
          `The generation widget is missing at ${path}. It is built by \`npm run build\` ` +
            '(`node widget/build.mjs`) and ships inside the package; a server running from source has not built it.',
        )
      }
      return { contents: [{ uri: GENERATION_WIDGET_URI, mimeType: RESOURCE_MIME_TYPE, text }] }
    },
  )

  const rawRegisterTool = server.registerTool.bind(server)
  server.registerTool = ((name: string, config: Record<string, unknown>, cb: unknown) => {
    const shape = config.inputSchema
    // A tool with no inputs, or one that already passed a built schema, is left exactly as it was.
    const strict =
      shape && typeof shape === 'object' && !(shape instanceof z.ZodType)
        ? z.object(shape as z.ZodRawShape).strict()
        : shape
    return rawRegisterTool(name, { ...config, inputSchema: strict } as never, cb as never)
  }) as typeof server.registerTool

  /**
   * ⚠️ THESE SHAPES ARE DECLARED, NOT LEFT AS `z.unknown()`. An array of unknown serialises to
   * `{"type":"array","items":{}}`, which tells a client NOTHING about what may go inside it. The server
   * accepted every shape when called directly, and Claude Desktop rejected all of them before they left,
   * because a validator cannot check a value against an empty schema and a model cannot pattern an argument
   * on one either. Measured 2026-08-23: 12 fields across 4 tools were advertised that way.
   *
   * Every entry below stays permissive at the EDGES (optional fields, free-form payload objects) because the
   * server does the real validation. The point is to describe the shape, not to duplicate the rules.
   */
  const logoEntrySchema = z.object({
    url: z.string().optional().describe('A url the kit already has.'),
    outputId: z.string().optional().describe('A generation to copy in: "<id>", or "<id>-2" for variation 2.'),
    name: z.string().optional(),
    is_primary: z.boolean().optional().describe("Make this the kit's cover. Exactly one logo ends up primary."),
    layout: z.enum(['horizontal', 'stacked', 'icon', 'wordmark']).optional(),
    colorMode: z.enum(['full_color', 'light', 'dark', 'grayscale']).optional(),
  })

  const assetEntrySchema = z.object({
    url: z.string().optional().describe('A url the kit already has.'),
    outputId: z.string().optional().describe('A generation to copy in.'),
    name: z.string().optional(),
  })

  const sectionEntrySchema = z.object({
    tab: z.string().describe('The tab this section belongs to, e.g. "voice", "overview". Part of the key.'),
    sectionName: z.string().describe('The section title. Part of the key.'),
    sortOrder: z.number().int().optional(),
    fields: z.array(z.record(z.string(), z.unknown())).optional().describe('Field objects: { key, label, type, value }.'),
  })

  /** An existing tracked-account id, OR a profile to add by handle/url. */
  const accountEntrySchema = z.union([
    z.string().describe('A tracked-account id, or a full profile url.'),
    z.object({
      platform: z
        .enum(['youtube', 'instagram', 'facebook', 'tiktok', 'x', 'threads', 'linkedin'])
        .optional()
        .describe('Only needed for a bare handle; a full profile url carries its own platform.'),
      handleOrUrl: z.string().describe('A profile url, or a handle when platform is given.'),
    }),
  ])

  const cardPostSchema = z.object({
    platform: z.enum(POST_PLATFORMS).describe('The platform. This is the KEY: one post per platform.'),
    format: z.string().optional(),
    connectedAccountId: z.string().nullable().optional(),
    scheduledAt: z.string().nullable().optional().describe("Per-post override of the card's schedule."),
    platformSpecificData: z.record(z.string(), z.unknown()).optional().describe('The publish payload for this platform.'),
    status: z.string().optional(),
  })

  const postAssetSchema = z.object({
    id: z.string().optional().describe('Keep an existing asset, at this position in the order.'),
    assetUrl: z.string().optional().describe('A public url for a NEW asset.'),
    outputId: z.string().optional().describe('A generation for a NEW asset.'),
    assetType: z.string().optional().describe('Required with assetUrl; inferred from outputId.'),
    displayName: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  })

  // -- generate_image -------------------------------------------------------
  server.registerTool(
    'generate_image',
    {
      ...RENDERS_GENERATION,
      title: 'Generate Image',
      annotations: WRITE,
      description:
        'Generate one or more images from a text prompt (optionally image-to-image with reference images). Waits for the result and returns the image URLs. Optionally pass projectId to place the generated image onto that project in the same call, controlled by an optional placement: a VIDEO timeline places a clip on a track, a CANVAS design places a layer on a slide (defaulting to the slide the user is focused on). Omit projectId to save a standalone library output. The result LINKS each output so the user sees it inline; to SEE it yourself (judge a face, check legibility, pick between variations) call get_media with the outputId. SPENDS CREDITS: pass getCost to preview the price first, which runs nothing and charges nothing.',
      inputSchema: {
        modelId: z.enum(models.image).describe(IMAGE_MODEL_GUIDANCE),
        prompt: z
          .string()
          .optional()
          .describe('Describe the image to generate. Required for most models; optional for a few that can run from references alone.'),
        aspectRatio: z.string().optional().describe('e.g. 16:9, 1:1, 9:16. Validated per model.'),
        resolution: z.string().optional().describe('e.g. 1K, 2K, 4K. Model-dependent (e.g. gpt-image-2, nano-banana-2/pro, flux-2-pro, seedream).'),
        mode: z
          .string()
          .optional()
          .describe('Variant mode for models that expose one: flux-2-pro takes "pro" or "flex"; flux-1-kontext takes "pro" or "max". Affects both the variant and the price. Ignored by models without a mode.'),
        numImages: z.number().int().min(1).max(4).optional().describe('Number of variations (1-4).'),
        seed: z.number().int().optional().describe('Seed for reproducibility.'),
        referenceImages: z
          .array(z.string())
          .optional()
          .describe('References for image-to-image / editing. Each may be a URL or a previous output id (e.g. "<id>" or "<id>-2") to chain from an earlier generation.'),
        avatarId: z
          .string()
          .optional()
          .describe(
            'Optional avatar id from list_avatars. File the result onto that avatar as a new LOOK (one appearance of a reusable character: same person, different outfit, setting or framing) instead of saving a standalone library output. Combine with a referenceImage of the avatar to keep the subject on-model.',
          ),
        ...PLACEMENT_INPUT_FIELDS,
        getCost: z.boolean().optional().describe('Return the credit cost estimate instead of generating (nothing runs, nothing is charged).'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        const request = compact<GenerateRequest>({
          contentType: 'image',
          modelId: args.modelId,
          prompt: args.prompt,
          aspectRatio: args.aspectRatio,
          resolution: args.resolution,
          numImages: args.numImages,
          seed: args.seed,
          references: buildReferences({ images: args.referenceImages }),
          parameters: args.mode ? { mode: args.mode } : undefined,
          avatarId: args.avatarId,
          projectId: args.projectId,
          placement: args.placement as GenerateRequest['placement'],
          playheadFrame: args.playheadFrame,
        })
        if (args.getCost) return costResult(await client.estimateCost(request))
        const gen = await client.generateAndWait(request, { timeoutMs: SMART_WAIT_MS })
        return completedResult(gen, await attachmentsFor(gen))
      } catch (err) {
        // A SUBMITTED generation is running and charged. Whether the wait timed out or a
        // poll hit a transient error, returning the outputId lets the caller resume;
        // dropping it invites a retry that generates and charges a second time.
        const pending = pendingOutputId(err)
        if (pending) return pendingResult(pending)
        return errorResult(err)
      }
    },
  )

  // -- generate_board -------------------------------------------------------
  server.registerTool(
    'generate_board',
    {
      ...RENDERS_GENERATION,
      title: 'Generate Reference Board',
      annotations: WRITE,
      description:
        'Generate a Reference Board: a dense multi-panel reference sheet (3:4, 4K) built from a source image and/or a written description, used to keep a subject on-model across later generations (feed the board back in as a referenceImage). Provide referenceImages and/or a prompt (at least one is required). Waits up to ~50s; boards render slowly (minutes), so it usually returns an outputId to poll with get_generation_status. SPENDS CREDITS: pass getCost to preview the price first, which runs nothing and charges nothing.',
      inputSchema: {
        boardType: z.enum(BOARD_TYPES).describe(BOARD_TYPE_GUIDANCE),
        prompt: z
          .string()
          .optional()
          .describe(
            'Describe the subject or how you will use the board. Required when no referenceImages are given (text-only boards); otherwise optional context (the source image leads).',
          ),
        referenceImages: z
          .array(z.string())
          .optional()
          .describe(
            'Source images the board is built from: each a URL or a previous output id (e.g. "<id>" or "<id>-2") to chain from an earlier generation.',
          ),
        numImages: z
          .number()
          .int()
          .min(1)
          .max(4)
          .optional()
          .describe('Number of board variations (1-4). Defaults to 1.'),
        boardName: z.string().optional().describe('Optional name for the board.'),
        avatarId: z
          .string()
          .optional()
          .describe(
            'Optional avatar id from list_avatars. Associate the board with that avatar, so a character sheet built for an avatar stays filed against it.',
          ),
        getCost: z.boolean().optional().describe('Return the credit cost estimate instead of generating (nothing runs, nothing is charged).'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        const request = compact<GenerateBoardRequest>({
          boardType: args.boardType,
          prompt: args.prompt,
          referenceImages: args.referenceImages,
          numImages: args.numImages,
          boardName: args.boardName,
          avatarId: args.avatarId,
        })
        if (args.getCost) return costResult(await client.estimateBoardCost(request))
        const gen = await client.generateBoardAndWait(request, { timeoutMs: SMART_WAIT_MS })
        return completedResult(gen, await attachmentsFor(gen))
      } catch (err) {
        // A SUBMITTED generation is running and charged. Whether the wait timed out or a
        // poll hit a transient error, returning the outputId lets the caller resume;
        // dropping it invites a retry that generates and charges a second time.
        const pending = pendingOutputId(err)
        if (pending) return pendingResult(pending)
        return errorResult(err)
      }
    },
  )

  // -- generate_video -------------------------------------------------------
  server.registerTool(
    'generate_video',
    {
      ...RENDERS_GENERATION,
      title: 'Generate Video',
      annotations: WRITE,
      description:
        'Generate a video from a text prompt (optionally from a start/end frame or reference images/videos/audio). Waits up to ~50s; if the render is still running it returns an outputId to poll with get_generation_status. Seedance 2.0 has two input modes selected by which references you pass: a startFrame (and optional endFrame) runs start/end-frame mode; referenceImages / referenceVideos / referenceAudio (without a startFrame) run references mode. Optionally pass projectId to place the generated video onto that project in the same call, controlled by an optional placement: a VIDEO timeline places a clip on a track, a CANVAS design places a layer on a slide (defaulting to the slide the user is focused on). Omit projectId to save a standalone library output. The result LINKS each output so the user sees it inline; to SEE it yourself (judge a face, check legibility, pick between variations) call get_media with the outputId. SPENDS CREDITS: pass getCost to preview the price first, which runs nothing and charges nothing.',
      inputSchema: {
        modelId: z.enum(models.video).describe(VIDEO_MODEL_GUIDANCE),
        prompt: z
          .string()
          .optional()
          .describe('Describe the video to generate. Required for most models; optional for some (e.g. motion-control), where it is an auxiliary motion hint.'),
        aspectRatio: z.string().optional().describe('e.g. 16:9, 9:16. Validated per model.'),
        resolution: z.string().optional().describe('e.g. 720p, 1080p, 4K. Model-dependent.'),
        duration: z
          .number()
          .optional()
          .describe('Clip length in seconds. Model-dependent; some models lock it.'),
        audioEnabled: z
          .boolean()
          .optional()
          .describe('Generate audio (only for models that support it).'),
        numGenerations: z.number().int().min(1).max(4).optional().describe('Number of variations (1-4).'),
        negativePrompt: z.string().optional().describe('What to avoid (models that support it).'),
        seed: z.number().int().optional().describe('Seed for reproducibility.'),
        startFrame: z.string().optional().describe('First frame: an image URL or a previous output id (e.g. "<id>-2") to chain (e.g. animate an image you just generated).'),
        endFrame: z.string().optional().describe('Last frame: an image URL or a previous output id.'),
        referenceImages: z.array(z.string()).optional().describe('Reference images: each a URL or a previous output id to chain.'),
        referenceVideos: z.array(z.string()).optional().describe('Reference videos: each a URL or a previous output id to chain.'),
        referenceAudio: z
          .array(z.string())
          .optional()
          .describe('Reference audio (e.g. Seedance references mode, audio-driven video): each a URL or a previous output id. Only used by models that accept audio references.'),
        elements: z
          .array(
            z.object({
              elementId: z.string().optional().describe('Reference a saved element by id (from list_elements / create_element). Resolves to its name + images.'),
              name: z.string().optional().describe('Inline element: reference it in the prompt as @name.'),
              description: z.string().optional().describe('Inline element: what it represents.'),
              images: z.array(z.string()).optional().describe('Inline element: image URLs or previous output ids.'),
            }),
          )
          .optional()
          .describe('Named reference elements (Kling 3.0): each is a saved element ({ elementId }) or an inline group ({ name, description, images }), addressable in the prompt as @name. Requires a startFrame. See get_model promptReferences (named_tag scheme).'),
        multiShot: z
          .boolean()
          .optional()
          .describe('WAN 2.6: enable multi-shot mode (a single longer sequence with multiple shots) instead of single-shot. For Kling 3.0, pass per-shot prompts via `shots` instead, which turns on multi-shot automatically.'),
        shots: z
          .array(z.object({ prompt: z.string(), duration: z.number() }))
          .optional()
          .describe('Kling 3.0 multi-shot mode: an ordered list of shots, each with its own prompt and duration in seconds (1-12 each, total <=15). When provided, the video runs in multi-shot mode; only startFrame attaches as an image (it becomes the first frame of shot 1), all other shots are text-only. Audio is always on in multi-shot.'),
        ...PLACEMENT_INPUT_FIELDS,
        getCost: z.boolean().optional().describe('Return the credit cost estimate instead of generating (nothing runs, nothing is charged).'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        const klingMultiShot = Array.isArray(args.shots) && args.shots.length > 0
        const wantMultiShot = klingMultiShot || args.multiShot === true
        const parameters: Record<string, unknown> = {}
        if (wantMultiShot) parameters.multiShot = true
        if (klingMultiShot) parameters.shots = args.shots
        const request = compact<GenerateRequest>({
          contentType: 'video',
          modelId: args.modelId,
          prompt: klingMultiShot ? args.prompt ?? args.shots!.map((s) => s.prompt).join(' ') : args.prompt,
          aspectRatio: args.aspectRatio,
          resolution: args.resolution,
          duration: klingMultiShot ? args.shots!.reduce((sum, s) => sum + s.duration, 0) : args.duration,
          audioEnabled: args.audioEnabled,
          numGenerations: args.numGenerations,
          negativePrompt: args.negativePrompt,
          seed: args.seed,
          ...(Object.keys(parameters).length > 0 ? { parameters } : {}),
          references: buildReferences({
            startFrame: args.startFrame,
            endFrame: args.endFrame,
            images: args.referenceImages,
            videos: args.referenceVideos,
            audio: args.referenceAudio,
            elements: args.elements,
          }),
          projectId: args.projectId,
          placement: args.placement as GenerateRequest['placement'],
          playheadFrame: args.playheadFrame,
        })
        if (args.getCost) return costResult(await client.estimateCost(request))
        const gen = await client.generateAndWait(request, { timeoutMs: SMART_WAIT_MS })
        return completedResult(gen, await attachmentsFor(gen))
      } catch (err) {
        // A SUBMITTED generation is running and charged. Whether the wait timed out or a
        // poll hit a transient error, returning the outputId lets the caller resume;
        // dropping it invites a retry that generates and charges a second time.
        const pending = pendingOutputId(err)
        if (pending) return pendingResult(pending)
        return errorResult(err)
      }
    },
  )

  // -- generate_audio (synchronous) -----------------------------------------
  server.registerTool(
    'generate_audio',
    {
      title: 'Generate Audio',
      annotations: WRITE,
      description:
        'Generate audio with ElevenLabs: speech (TTS), music, or a sound effect. Returns the audio URL directly (synchronous, no polling). Optionally pass projectId to place the generated audio onto that editor project\'s timeline in the same call, controlled by an optional placement; omit projectId to save a standalone library output. The result LINKS each output so the user sees it inline; to SEE it yourself (judge a face, check legibility, pick between variations) call get_media with the outputId. SPENDS CREDITS: pass getCost to preview the price first, which runs nothing and charges nothing.',
      inputSchema: {
        modelId: z.enum(models.audio).describe(AUDIO_MODEL_GUIDANCE),
        prompt: z.string().optional().describe('For music / sfx: what to generate.'),
        text: z.string().optional().describe('For TTS (elevenlabs-tts): the words to speak.'),
        voiceId: z.string().optional().describe('For TTS: the ElevenLabs voice id.'),
        voiceName: z.string().optional().describe('For TTS: human-readable voice name (display only).'),
        durationSeconds: z.number().optional().describe('For music / sfx: length in seconds.'),
        promptInfluence: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe('For sfx: how literally to follow the prompt (0 to 1).'),
        ...PLACEMENT_INPUT_FIELDS,
        getCost: z.boolean().optional().describe('Return the credit cost estimate instead of generating (nothing runs, nothing is charged).'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        const request = compact<GenerateRequest>({
          contentType: 'audio',
          modelId: args.modelId,
          prompt: args.prompt,
          text: args.text,
          voiceId: args.voiceId,
          voiceName: args.voiceName,
          durationSeconds: args.durationSeconds,
          promptInfluence: args.promptInfluence,
          projectId: args.projectId,
          placement: args.placement as GenerateRequest['placement'],
          playheadFrame: args.playheadFrame,
        })
        if (args.getCost) return costResult(await client.estimateCost(request))
        const result = await client.generate(request)
        return audioResult(result)
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- edit_audio (existing audio -> audio) ---------------------------------
  server.registerTool(
    'edit_audio',
    {
      title: 'Edit Audio',
      annotations: WRITE,
      description:
        'Transform existing audio with an audio-processing model, in one of TWO shapes. FILE mode: pass sourceUrl to process a standalone file into a new library asset. Voice isolation removes background noise and music and returns the processed URL directly; audio enhancement levels loudness and cleans up background noise, is asynchronous, and returns an outputId to poll with get_generation_status. Optionally pass projectId to place the result onto that editor project\'s timeline in the same call, controlled by an optional placement. IN-PLACE mode: pass projectId with clipIds (or enhanceClips for the whole timeline) to enhance the audio OF EXISTING CLIPS instead of producing a new asset, which is how you clean up a recording already on a timeline. In-place returns a LIST on outputs, one job per SOURCE, because the vendor estimates a noise profile per production: one recording\'s clips are concatenated and enhanced together so the level and noise floor stay consistent across cuts, while separate recordings stay separate jobs. Poll every outputId. The enhanced audio is applied to the clips automatically when each job lands: an audio clip has its source swapped, and a video clip is muted with the enhanced audio placed on its own clip. Silenced clips are skipped. In-place mode is enhancement only and needs no sourceUrl. SPENDS CREDITS: pass getCost to preview the price first, which runs nothing and charges nothing.',
      inputSchema: {
        modelId: z.enum(models.editAudio).describe(EDIT_AUDIO_MODEL_GUIDANCE),
        sourceUrl: z
          .string()
          .optional()
          .describe('FILE mode: the audio file to process, as a URL or a previous output id. Omit in in-place mode, where the sources come from the clips.'),
        durationSeconds: z
          .number()
          .optional()
          .describe('Source audio length in seconds. Required for getCost, and for enhancement pricing when the source is not a stored ContentHero asset.'),
        projectId: z.string().optional().describe('The editor project: where to PLACE the result in file mode, or which timeline to enhance in in-place mode. Omit for a standalone library output.'),
        clipIds: z
          .array(z.string())
          .optional()
          .describe('IN-PLACE mode: enhance the audio of these clips on projectId. Omit with enhanceClips:true to enhance every audible clip on the timeline.'),
        enhanceClips: z
          .boolean()
          .optional()
          .describe('IN-PLACE mode for the whole timeline, without naming clips. Implied when clipIds is given.'),
        placement: PLACEMENT_SCHEMA.optional().describe('Where the clip lands: append to the end, at a time, at the playhead, replacing an existing clip, or filling a time range. Omitted places it at the playhead when known, else appends.'),
        playheadFrame: z.number().optional().describe('The current playhead frame, for playhead-relative placement.'),
        getCost: z.boolean().optional().describe('Return the credit cost estimate instead of running (nothing runs, nothing is charged).'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        const request = compact<EditAudioRequest>({
          modelId: args.modelId,
          sourceUrl: args.sourceUrl,
          durationSeconds: args.durationSeconds,
          projectId: args.projectId,
          placement: args.placement as EditAudioRequest['placement'],
          playheadFrame: args.playheadFrame,
          clipIds: args.clipIds,
          enhanceClips: args.enhanceClips,
        })
        if (args.getCost) return costResult(await client.estimateEditAudioCost(request))
        const result = await client.editAudio(request)
        // IN-PLACE mode returns one job per SOURCE, so the agent is handed every outputId rather than just the
        // first: polling only `outputId` would report the whole edit as done when one recording had finished.
        if (result.outputs) return enhanceClipsResult(result)
        // Enhancement is async (status 'processing'); isolation returns URLs inline.
        if (result.status === 'processing') return pendingResult(result.outputId)
        return audioResult(result)
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- upscale --------------------------------------------------------------
  server.registerTool(
    'upscale',
    {
      ...RENDERS_GENERATION,
      title: 'Upscale',
      annotations: WRITE,
      description:
        'Upscale an existing image or video to a higher resolution. Provide the source media URL and a model-supported factor. Waits for the result; if the job is still running it returns an outputId to poll with get_generation_status. SPENDS CREDITS: pass getCost to preview the price first, which runs nothing and charges nothing.',
      inputSchema: {
        modelId: z.enum(models.upscale).describe(UPSCALE_MODEL_GUIDANCE),
        sourceUrl: z.string().describe('The source image (image upscalers) or video (video upscalers): a URL or a previous output id (e.g. "<id>-1") to upscale an earlier generation.'),
        factor: z.string().describe('Upscale factor, e.g. 2x, 4x. Model-dependent; validated per model.'),
        durationSeconds: z
          .number()
          .optional()
          .describe('Required for video upscalers: the source video length in seconds (used for pricing).'),
        getCost: z.boolean().optional().describe('Return the credit cost estimate instead of upscaling (nothing runs, nothing is charged).'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        const isVideo = models.upscaleContentType[args.modelId] === 'video'
        const request = compact<GenerateRequest>({
          contentType: isVideo ? 'video' : 'image',
          modelId: args.modelId,
          upscaleFactor: args.factor,
          duration: isVideo ? args.durationSeconds : undefined,
          references: isVideo ? { videos: [args.sourceUrl] } : { images: [args.sourceUrl] },
        })
        if (args.getCost) return costResult(await client.estimateCost(request))
        const gen = await client.generateAndWait(request, { timeoutMs: SMART_WAIT_MS })
        return completedResult(gen, await attachmentsFor(gen))
      } catch (err) {
        // A SUBMITTED generation is running and charged. Whether the wait timed out or a
        // poll hit a transient error, returning the outputId lets the caller resume;
        // dropping it invites a retry that generates and charges a second time.
        const pending = pendingOutputId(err)
        if (pending) return pendingResult(pending)
        return errorResult(err)
      }
    },
  )

  // -- generate_lip_sync ----------------------------------------------------
  server.registerTool(
    'generate_lip_sync',
    {
      ...RENDERS_GENERATION,
      title: 'Generate Lip Sync',
      annotations: WRITE,
      description:
        'Animate a portrait image so the subject speaks. Provide imageUrl (the face) plus a voice source: either audioUrl (an existing speech clip) or script + voiceId (we synthesize the speech). Optional motionPrompt nudges expression/motion. Waits up to ~50s; if still rendering it returns an outputId to poll with get_generation_status. SPENDS CREDITS: pass getCost to preview the price first, which runs nothing and charges nothing.',
      inputSchema: {
        modelId: z.enum(models.lipSync).describe(LIP_SYNC_MODEL_GUIDANCE),
        imageUrl: z.string().describe('The portrait to animate (the speaking subject): an image URL or a previous output id (e.g. "<id>-1") to chain.'),
        audioUrl: z
          .string()
          .optional()
          .describe('An existing speech clip: an audio URL or a previous output id. Use this OR script + voiceId.'),
        script: z
          .string()
          .optional()
          .describe('Text for the subject to speak. Requires voiceId; synthesized to speech. Use this OR audioUrl.'),
        voiceId: z.string().optional().describe('ElevenLabs voice id to speak the script (required with script).'),
        voiceName: z.string().optional().describe('Human-readable voice name (display only).'),
        motionPrompt: z
          .string()
          .optional()
          .describe('Optional motion / expression hint for the animation.'),
        resolution: z.string().optional().describe('e.g. 480p, 720p, 1080p. Model-dependent.'),
        audioDurationSeconds: z
          .number()
          .optional()
          .describe('Length of audioUrl in seconds (audio mode only; improves cost accuracy).'),
        getCost: z.boolean().optional().describe('Return the credit cost estimate instead of generating (nothing runs, nothing is charged).'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        const request = compact<GenerateRequest>({
          contentType: 'video',
          modelId: args.modelId,
          prompt: args.motionPrompt,
          text: args.script,
          voiceId: args.voiceId,
          voiceName: args.voiceName,
          resolution: args.resolution,
          durationSeconds: args.audioDurationSeconds,
          references: buildReferences({
            images: [args.imageUrl],
            audio: args.audioUrl ? [args.audioUrl] : undefined,
          }),
        })
        if (args.getCost) return costResult(await client.estimateCost(request))
        const gen = await client.generateAndWait(request, { timeoutMs: SMART_WAIT_MS })
        return completedResult(gen, await attachmentsFor(gen))
      } catch (err) {
        // A SUBMITTED generation is running and charged. Whether the wait timed out or a
        // poll hit a transient error, returning the outputId lets the caller resume;
        // dropping it invites a retry that generates and charges a second time.
        const pending = pendingOutputId(err)
        if (pending) return pendingResult(pending)
        return errorResult(err)
      }
    },
  )

  // -- transcribe -----------------------------------------------------------
  server.registerTool(
    'transcribe',
    {
      title: 'Transcribe Audio',
      /*
        ⭐ ANNOTATED, NOT JUST ARGUED FOR. The comment below has said "NOT read-only" since this tool
        shipped, and nobody ever wrote the annotation, so the tool went out carrying NEITHER hint. Claude
        files an unannotated tool under "Other", which is how 2 of 88 ended up unclassified: a comment
        describing an enforcement nobody built reads exactly like one that was built.
      */
      annotations: WRITE,
      // NOT read-only, despite only returning text. readOnlyHint is a host's signal that a
      // tool is safe to call without asking the user, and this one is metered per minute of
      // audio: annotated READ, an agent could transcribe a two-hour file repeatedly,
      // unattended, spending real credits. Every other metered tool here is a write with a
      // getCost preflight, and a test now holds that line.
      //
      // ⚠️ This tool has NO getCost, and that is a server limitation, not an oversight:
      // POST /api/v1/studio/transcribe does not accept the flag, and pricing the call
      // means knowing the audio's duration before transcribing it. Until the route can
      // price it, the cost is only knowable after the fact, from creditsUsed on the
      // result. It is the single documented entry in METERED_WITHOUT_PREFLIGHT.
      description:
        'Transcribe an audio URL to text (speech-to-text). Returns the transcript directly (synchronous, no polling). SPENDS CREDITS, metered per minute of audio, and the cost cannot be previewed: the result reports the credits it cost after the fact. Zero only when the account runs on its own ElevenLabs key.',
      inputSchema: {
        audioUrl: z.string().describe('Public URL of the audio file to transcribe.'),
        languageCode: z
          .string()
          .optional()
          .describe('ISO language hint, e.g. "en". Auto-detected when omitted.'),
        diarize: z.boolean().optional().describe('Label each speaker (diarization).'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        const t = await client.transcribe({
          audioUrl: args.audioUrl,
          languageCode: args.languageCode,
          diarize: args.diarize,
        })
        return transcriptResult(t)
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- list_avatars ---------------------------------------------------------
  server.registerTool(
    'list_avatars',
    {
      title: 'List Avatars',
      annotations: READ,
      description:
        "List the account's avatars. Each avatar has an imageUrl (its base look) and a defaultVoiceId, which feed generate_lip_sync. Call get_avatar for full detail and the avatar's looks.",
    },
    async (extra) => {
      try {
        const client = await getClient(extra)
        return avatarListResult(await client.listAvatars())
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- get_avatar -----------------------------------------------------------
  server.registerTool(
    'get_avatar',
    {
      title: 'Get Avatar',
      annotations: READ,
      description:
        'Get one avatar by id: its base image (use as generate_lip_sync imageUrl), default voice, traits, and its looks (outfit variations).',
      inputSchema: {
        avatarId: z.string().describe('The avatar id from list_avatars.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return avatarResult(await client.getAvatar(args.avatarId))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- create_avatar --------------------------------------------------------
  server.registerTool(
    'create_avatar',
    {
      title: 'Create Avatar',
      annotations: WRITE,
      description:
        "Create a reusable character and start generating its first look. SPENDS CREDITS (pass getCost to preview the price without creating anything). Returns as soon as the record exists: the avatar is NOT usable yet, it sits at status 'processing' with no image until its first look finishes, so poll get_avatar until status is 'completed'. Supply referenceImageUrls to make the avatar a likeness of a real person from their photos; omit them to invent a character from the description and traits.",
      inputSchema: {
        name: z.string().describe('Avatar name, at least 3 characters.'),
        age: z.string().describe("Apparent age, e.g. '20s', '35', 'middle-aged'. Required: the prompt writer describes the character from these traits."),
        gender: z.string().describe('Gender presentation. Required, same reason as age.'),
        ethnicity: z.string().optional().describe('Optional ethnicity, for a more specific likeness.'),
        niche: z.array(z.string()).optional().describe('Content niches this character is for, e.g. ["fitness","nutrition"].'),
        style: z.string().optional().describe('Visual style hint for the portrait, e.g. "editorial", "cinematic". Not stored on the avatar.'),
        description: z
          .string()
          .optional()
          .describe('Free-text description of the character. The strongest single input when no reference photos are given.'),
        defaultVoiceId: z.string().optional().describe("A voiceId from list_voices, used as this avatar's default voice."),
        referenceImageUrls: z
          .array(z.string())
          .optional()
          .describe(
            'Photos of a REAL PERSON to anchor identity to: each a URL or a previous output id. Only use photos of someone who has agreed to being cloned.',
          ),
        getCost: z.boolean().optional().describe('Return the credit cost estimate instead of creating (nothing runs, nothing is charged).'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        if (args.getCost) {
          const creditsEstimate = await client.estimateAvatarCost()
          // `modelId` is the first thing `costResult` names in its sentence, and `contentType` only
          // admits image/video/audio. An avatar is none of those: the price is the fixed
          // avatar-creation fee, not the cost of the portrait model, so say that rather than pick a
          // media kind that would misdescribe it.
          return costResult({ getCost: true, creditsEstimate, modelId: 'avatar creation' })
        }
        const created = await client.createAvatar({
          name: args.name,
          age: args.age,
          gender: args.gender,
          ethnicity: args.ethnicity,
          niche: args.niche,
          style: args.style,
          description: args.description,
          defaultVoiceId: args.defaultVoiceId,
          referenceImageUrls: args.referenceImageUrls,
        })
        return avatarPendingResult(created)
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- update_avatar --------------------------------------------------------
  server.registerTool(
    'update_avatar',
    {
      title: 'Update Avatar',
      annotations: WRITE,
      description:
        "Update an avatar and/or change its looks. Fields: name, defaultLookId (also becomes the avatar's profile photo), defaultVoiceId. Looks are changed through ops, the same shape update_timeline and update_canvas use: add_look files images the account ALREADY OWNS onto the avatar, remove_look trashes one (recoverable for 30 days). Ops run before the fields, so one call can add a look and make it the default. To GENERATE a new look instead of filing an existing image, call generate_image with avatarId.",
      inputSchema: {
        avatarId: z.string().describe('The avatar id from list_avatars.'),
        name: z.string().optional().describe('New name, at least 3 characters.'),
        defaultLookId: z
          .string()
          .optional()
          .describe("A look id from get_avatar. Becomes the avatar's default look AND its profile photo."),
        defaultVoiceId: z.string().nullable().optional().describe('A voiceId from list_voices, or null to clear it.'),
        ops: z
          .array(
            z.union([
              z.object({
                op: z.literal('add_look'),
                imageUrls: z
                  .array(z.string())
                  .describe(
                    'Images the account already owns, as URLs: an upload, a creation, an editor export, or another avatar look. Anything not owned by this account is skipped rather than failing the call.',
                  ),
                name: z
                  .string()
                  .optional()
                  .describe(
                    "What to call the look. Applied to every image in this op. Omit and it stays unnamed, displaying by its source label ('from_media'), which is rarely what you want for a look you will pick from a list later.",
                  ),
              }),
              z.object({
                op: z.literal('remove_look'),
                lookId: z.string().describe('A look id from get_avatar.'),
              }),
            ]),
          )
          .optional()
          .describe('Look changes, applied in order before the field updates. NOT a transaction: a failure part-way leaves earlier ops applied.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        const { avatarId, ...request } = args
        const updated = await client.updateAvatar(avatarId, request as UpdateAvatarRequest)
        return avatarResult(updated.avatar)
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- delete_avatar --------------------------------------------------------
  server.registerTool(
    'delete_avatar',
    {
      title: 'Delete Avatar',
      annotations: WRITE,
      description:
        "Delete an avatar. Soft: the avatar stops appearing, but ITS LOOKS SURVIVE as library images and can be filed onto another avatar with update_avatar's add_look. Use this to retire a duplicate or an abandoned character, after moving any looks worth keeping.",
      inputSchema: {
        avatarId: z.string().describe('The avatar id from list_avatars.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        await client.deleteAvatar(args.avatarId)
        return text(
          `Avatar ${args.avatarId} deleted. Its looks are retained and can be filed onto another avatar with update_avatar add_look.`,
        )
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- list_voices ----------------------------------------------------------
  server.registerTool(
    'list_voices',
    {
      title: 'List Voices',
      annotations: READ,
      description:
        "List the account's saved voices (favorites first). Set favorited=true to show only favorites. Each has a voiceId for generate_lip_sync / generate_audio (TTS). Call get_voice for full detail.",
      inputSchema: {
        favorited: z.boolean().optional().describe('Only favorited voices.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return voiceListResult(await client.listVoices({ favorited: args.favorited }))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- get_voice ------------------------------------------------------------
  server.registerTool(
    'get_voice',
    {
      title: 'Get Voice',
      annotations: READ,
      description: 'Get one voice by its voiceId: provider, traits (accent/language/gender/age), description, and a preview URL.',
      inputSchema: {
        voiceId: z.string().describe('The voice id from list_voices.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return voiceResult(await client.getVoice(args.voiceId))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- list_brand_kits ------------------------------------------------------
  server.registerTool(
    'list_brand_kits',
    {
      title: 'List Brand Kits',
      annotations: READ,
      description:
        "List the account's brand kits (default first). Excludes archived kits unless archived=true; set favorited=true for only favorites. Call get_brand_kit for one kit's full brand context (voice, visual identity, audience, sections, accounts, knowledge) to write on-brand content.",
      inputSchema: {
        favorited: z.boolean().optional().describe('Only favorited brand kits.'),
        archived: z.boolean().optional().describe('Only archived brand kits (default excludes archived).'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return brandKitListResult(
          await client.listBrandKits({ favorited: args.favorited, archived: args.archived }),
        )
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- get_brand_kit --------------------------------------------------------
  server.registerTool(
    'get_brand_kit',
    {
      title: 'Get Brand Kit',
      annotations: READ,
      description:
        'Get one brand kit in full: business overview, positioning, audience, voice profile, visual identity (logos/colors/typography), curated sections, linked brand + inspiration accounts, and a knowledge-base summary. Use it to ground on-brand generation.',
      inputSchema: {
        brandKitId: z.string().describe('The brand kit id from list_brand_kits.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return brandKitResult(await client.getBrandKit(args.brandKitId))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- create_brand_kit -----------------------------------------------------
  server.registerTool(
    'create_brand_kit',
    {
      title: 'Create Brand Kit',
      annotations: WRITE,
      description:
        "Create a brand kit. THREE SOURCES, chosen by what you pass: (1) EMPTY, just a name, then fill it in with update_brand_kit; or FROM A SOCIAL PROFILE, pass its url in brandAccounts (your own) or inspirationAccounts (a creator you watch) with no name at all, and the kit is named after the handle and starts ingesting that account's posts if it is YouTube or Instagram; (2) FROM A WEBSITE, pass websiteUrl + extract:true and ContentHero scrapes that site and fills in business name, positioning, voice, colors, typography, logos and assets by itself, which is by far the fastest way to get a real kit; (3) A COPY, pass duplicateFrom with an existing kit id, which copies its sections and brand media (assets re-link rather than duplicate, so a copy costs no storage). A brand with NO WEBSITE (so nothing to extract) is built by passing its fields directly, including logos, whose entries may name outputId to bring in a generation you just made rather than a url. With extract it RETURNS IMMEDIATELY, before the kit has any content: that empty kit is the handle, and the fields fill in over the next minute or two, so poll extractionStatus with get_brand_kit rather than assuming it failed. name is OPTIONAL when websiteUrl or a social profile url is given: it defaults to the site's hostname or the @handle, a placeholder extraction or you overwrite later. Brand kits are capped by plan, so this fails with a limit error near the cap, and a duplicate counts against it like any other kit. Requires the brandkit:write scope.",
      inputSchema: {
        name: z.string().optional().describe("The kit's name. Optional when websiteUrl is given."),
        websiteUrl: z.string().optional().describe('The business website. Required to use extract.'),
        extract: z
          .boolean()
          .optional()
          .describe('Scrape websiteUrl and fill the kit in automatically. Returns at once; poll extractionStatus.'),
        duplicateFrom: z.string().optional().describe('Copy an existing brand kit id instead of starting empty.'),
        businessName: z.string().optional().describe('The business or creator name this kit represents.'),
        primaryOffer: z.string().optional().describe('What this business sells, in one line. Grounds copy in what is actually being promoted.'),
        nicheDefinition: z.string().optional().describe('The niche this brand operates in. Keeps generated angles on-topic.'),
        positioning: z.record(z.string(), z.unknown()).optional().describe('Positioning object (free-form).'),
        audience: z.record(z.string(), z.unknown()).optional().describe('Audience object (free-form).'),
        voiceProfile: z.record(z.string(), z.unknown()).optional().describe('Voice profile object (tone, style, ...).'),
        visualStyle: z.string().optional().describe("The look in words, e.g. 'warm film grain, muted earth tones'. Grounds image and video prompts."),
        designPrinciples: z.array(z.string()).optional().describe('Design rules to hold to, one per entry. REPLACES the list; [] clears it.'),
        contentStrategy: z.record(z.string(), z.unknown()).optional().describe('Content strategy object (free-form).'),
        logos: z.array(logoEntrySchema).optional().describe("The kit's logos, each { url | outputId, name?, is_primary?, layout?, colorMode? }. Use outputId to bring in a generation."),
        assets: z.array(assetEntrySchema).optional().describe("The kit's brand assets, each { url | outputId, name? }."),
        sections: z
          .array(sectionEntrySchema)
          .optional()
          .describe("The kit's curated sections, each { tab, sectionName, sortOrder?, fields? }. Array position is the default order."),
        brandAccounts: z
          .array(accountEntrySchema)
          .optional()
          .describe("The account owner's OWN profiles. A tracked-account id, or { platform?, handleOrUrl } to ADD one and start ingesting it."),
        inspirationAccounts: z
          .array(accountEntrySchema)
          .optional()
          .describe('Competitor/creator profiles they watch. Same entry shape as brandAccounts.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        const seedsFromAccount = [...(args.brandAccounts ?? []), ...(args.inspirationAccounts ?? [])].length > 0
        if (!args.name && !args.websiteUrl && !args.duplicateFrom && !seedsFromAccount) {
          return errorResult(
            new Error('create_brand_kit needs a name, a websiteUrl, a social profile url, or duplicateFrom.'),
          )
        }
        if (args.extract && !args.websiteUrl) {
          return errorResult(new Error('create_brand_kit: extract requires a websiteUrl to scrape.'))
        }
        const { logos, assets, sections, brandAccounts, inspirationAccounts, ...rest } = args
        const { brandKit, extraction } = await client.createBrandKit({
          ...rest,
          ...(logos !== undefined ? { logos } : {}),
          ...(assets !== undefined ? { assets } : {}),
          ...(sections !== undefined ? { sections: sections as BrandKitSectionInput[] } : {}),
          ...(brandAccounts !== undefined ? { brandAccounts: brandAccounts as BrandKitAccountInput[] } : {}),
          ...(inspirationAccounts !== undefined ? { inspirationAccounts: inspirationAccounts as BrandKitAccountInput[] } : {}),
        })
        return brandKitResult(brandKit, extraction)
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- update_brand_kit -----------------------------------------------------
  server.registerTool(
    'update_brand_kit',
    {
      title: 'Update Brand Kit',
      annotations: WRITE,
      description:
        "Update a brand kit: identity fields (business name, positioning, audience, voice profile, visual style, content strategy), its brand media, which kit is the DEFAULT, and which tracked accounts it is LINKED to. Only the fields you pass change. Get the current kit first with get_brand_kit. Requires the brandkit:write scope. THREE MODES, chosen by what you pass: (1) pass brandKitId to patch one kit; (2) pass orderedIds ALONE to reorder the whole set, which is collection-level because ordering is a property of the set and a per-kit position would let two kits claim one slot, so pass every id in the order you want; (3) pass brandKitId + extract:true to RE-RUN website extraction, which returns immediately and fills the kit in the background from its websiteUrl (poll extractionStatus via get_brand_kit). logos/assets/sections/brandAccounts/inspirationAccounts are DECLARATIVE: a patch REPLACES the whole list, so pass the full set and use [] to clear. THIS IS ALSO HOW YOU ADD NEW MEDIA TO A KIT: a logo or asset entry names either a url it already has, or outputId to bring in a generation that is not in the kit yet ('<id>', or '<id>-2' for variation 2 of a batch), whose bytes get COPIED into the kit so trashing that generation later cannot empty it. To add a logo, read the kit, append one entry, and send the whole list back; sending an outputId twice adds it twice. brandAccounts are the account owner's OWN profiles (performance), inspirationAccounts are competitors and creators they watch; they are separate lists because they mean opposite things. AN ENTRY IS EITHER a tracked-account id you already have, OR { platform?, handleOrUrl } to ADD a profile that is not tracked yet, which is what STARTS ingesting its posts (a full profile url carries its own platform, so platform is only needed for a bare handle). isDefault only accepts true (passing false would leave the account with no default at all, so to move the default, name the kit that should hold it).",
      inputSchema: {
        brandKitId: z.string().optional().describe('The brand kit id. Omit ONLY when reordering with orderedIds.'),
        orderedIds: z
          .array(z.string())
          .optional()
          .describe('Reorder mode: every brand kit id, in the order you want them. Pass this alone.'),
        extract: z
          .boolean()
          .optional()
          .describe('Re-run website extraction for this kit. Returns immediately; poll extractionStatus.'),
        logos: z.array(logoEntrySchema).optional().describe('The kit\'s logos, each { url | outputId, name?, is_primary?, layout?: horizontal|stacked|icon|wordmark, colorMode?: full_color|light|dark|grayscale }. REPLACES the list; [] clears it. Exactly one ends up primary (the kit\'s cover); name none and the first wins.'),
        assets: z.array(assetEntrySchema).optional().describe('The kit\'s brand assets, each { url | outputId, name? }. REPLACES the list; [] clears it.'),
        sections: z
          .array(sectionEntrySchema)
          .optional()
          .describe("The kit's curated sections, each { tab, sectionName, sortOrder?, fields? }. REPLACES the set, keyed by (tab, sectionName); a section left out is ARCHIVED, never deleted. Array position is the default order."),
        isDefault: z.literal(true).optional().describe('Make this the default kit, un-defaulting every other.'),
        brandAccounts: z
          .array(accountEntrySchema)
          .optional()
          .describe("The account owner's OWN profiles. Each entry is a tracked-account id, or { platform?, handleOrUrl } to ADD one and start ingesting it. REPLACES the list; [] clears it."),
        inspirationAccounts: z
          .array(accountEntrySchema)
          .optional()
          .describe('Competitor/creator profiles they watch. Same entry shape as brandAccounts. REPLACES the list; [] clears it.'),
        name: z.string().optional().describe('Rename the kit. This is the label in the UI, not the business name.'),
        businessName: z.string().optional().describe('The business or creator name this kit represents.'),
        websiteUrl: z.string().optional().describe('The business website. Stored as a reference; it does not re-extract on its own.'),
        primaryOffer: z.string().optional().describe('What this business sells, in one line. Grounds copy in what is actually being promoted.'),
        nicheDefinition: z.string().optional().describe('The niche this brand operates in. Keeps generated angles on-topic.'),
        positioning: z.record(z.string(), z.unknown()).optional().describe('Positioning object (free-form).'),
        audience: z.record(z.string(), z.unknown()).optional().describe('Audience object (free-form).'),
        voiceProfile: z.record(z.string(), z.unknown()).optional().describe('Voice profile object (tone, style, ...).'),
        visualStyle: z.string().optional().describe("The look in words, e.g. 'warm film grain, muted earth tones'. Grounds image and video prompts."),
        designPrinciples: z.array(z.string()).optional().describe('Design rules to hold to, one per entry. REPLACES the list; [] clears it.'),
        contentStrategy: z.record(z.string(), z.unknown()).optional().describe('Content strategy object (free-form).'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        const { brandKitId, orderedIds, extract, logos, assets, sections, brandAccounts, inspirationAccounts, ...rest } = args
        // The declarative arrays are `unknown[]` in the schema (their entries are free-form objects the
        // server validates), so they are cast at this one boundary rather than restating the shape in zod.
        const input = {
          ...rest,
          ...(logos !== undefined ? { logos } : {}),
          ...(assets !== undefined ? { assets } : {}),
          ...(sections !== undefined ? { sections: sections as BrandKitSectionInput[] } : {}),
          // ⚠️ THESE TWO WERE DESTRUCTURED OUT OF `args` AND NEVER PUT BACK, so a patch that named only
          // accounts arrived here empty and the handler answered "nothing to change". Anything pulled out of
          // `args` by name has to be re-added by name; `...rest` cannot cover it.
          ...(brandAccounts !== undefined ? { brandAccounts: brandAccounts as BrandKitAccountInput[] } : {}),
          ...(inspirationAccounts !== undefined ? { inspirationAccounts: inspirationAccounts as BrandKitAccountInput[] } : {}),
        }

        // Reorder is the collection-level mode and takes no kit id at all.
        if (orderedIds && !brandKitId) {
          return brandKitListResult(await client.reorderBrandKits(orderedIds as string[]))
        }
        if (!brandKitId) {
          return errorResult(new Error('update_brand_kit needs either brandKitId, or orderedIds to reorder.'))
        }

        // A patch and an extract compose: correct the url and re-extract in one call. The patch lands first so
        // the extraction reads the url the caller just set, not the one it replaced.
        const patched =
          Object.keys(input).length > 0
            ? await client.updateBrandKit(brandKitId as string, input)
            : null
        if (extract) {
          const extraction = await client.extractBrandKit(brandKitId as string)
          return brandKitResult(patched ?? (await client.getBrandKit(brandKitId as string)), extraction)
        }
        if (!patched) {
          return errorResult(new Error('update_brand_kit: nothing to change. Pass a field, extract, or orderedIds.'))
        }
        return brandKitResult(patched)
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- add_brand_kit_section ------------------------------------------------
  // -- update_brand_kit_section ---------------------------------------------
  // -- search_brand_knowledge -----------------------------------------------
  server.registerTool(
    'search_brand_knowledge',
    {
      title: 'Search Brand Knowledge',
      annotations: READ,
      description:
        "Semantic search over a brand kit's knowledge base (everything the owner has uploaded: notes, docs, articles, video transcripts). Returns the most relevant passages, ranked. This is the deep-grounding read: use it to pull what the brand has said about a topic before drafting or deciding. Requires the brandkit:read scope.",
      inputSchema: {
        brandKitId: z.string().describe('The brand kit id (from list_brand_kits / get_brand_kit).'),
        query: z.string().describe('What to search for, in natural language.'),
        limit: z.number().int().min(1).max(50).optional().describe('Max matches (default 8).'),
        threshold: z.number().min(0).max(1).optional().describe('Minimum similarity 0-1 (default 0.45).'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return brandKnowledgeSearchResult(
          await client.searchBrandKnowledge(args.brandKitId, args.query, {
            limit: args.limit,
            threshold: args.threshold,
          }),
        )
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- list_brand_knowledge -------------------------------------------------
  server.registerTool(
    'list_brand_knowledge',
    {
      title: 'List Brand Knowledge',
      annotations: READ,
      description:
        "The complete, paginated index of a brand kit's knowledge items (titles and metadata, no bodies). Use it to browse what exists, or to find an item's id before get_brand_knowledge or remove_brand_knowledge. For relevance retrieval, use search_brand_knowledge instead. Requires the brandkit:read scope.",
      inputSchema: {
        brandKitId: z.string().describe('The brand kit id.'),
        limit: z.number().int().min(1).max(200).optional().describe('How many to return (default 50).'),
        offset: z.number().int().min(0).optional().describe('Pagination offset.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return brandKnowledgeListResult(
          await client.listBrandKnowledge(args.brandKitId, { limit: args.limit, offset: args.offset }),
        )
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- get_brand_knowledge --------------------------------------------------
  server.registerTool(
    'get_brand_knowledge',
    {
      title: 'Get Brand Knowledge',
      annotations: READ,
      description:
        "Get one knowledge item's stored body by id (the capped anchor text; the full document is embedded for search, not stored verbatim). Use search_brand_knowledge for the deep content. Requires the brandkit:read scope.",
      inputSchema: {
        brandKitId: z.string().describe('The brand kit id.'),
        knowledgeId: z.string().describe('The knowledge item id (from list_brand_knowledge or search_brand_knowledge).'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return brandKnowledgeDetailResult(await client.getBrandKnowledge(args.brandKitId, args.knowledgeId))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- add_brand_knowledge --------------------------------------------------
  server.registerTool(
    'add_brand_knowledge',
    {
      title: 'Add Brand Knowledge',
      annotations: WRITE,
      description:
        "Add an item to a brand kit's knowledge base so it can be searched later. This is how the brand's knowledge grows over time: capture a lesson learned, a brand decision, an asset description, an article, or a video. Source can be text (a note), url (a page to scrape), youtube (a video transcript), or file. For a file, pass either fileData (base64, best for small documents and images) or fileUrl (a hosted URL the server fetches, needed for large files and video/audio). Requires the brandkit:write scope.",
      inputSchema: {
        brandKitId: z.string().describe('The brand kit id.'),
        sourceType: z.enum(['text', 'url', 'youtube', 'file']).describe('How the content is provided.'),
        text: z.string().optional().describe('For sourceType "text": the note body.'),
        url: z.string().optional().describe('For sourceType "url" or "youtube": the link.'),
        fileData: z.string().optional().describe('For sourceType "file": base64-encoded file bytes (small documents and images).'),
        fileUrl: z.string().optional().describe('For sourceType "file": a hosted URL the server fetches (large files, video, audio).'),
        fileExt: z.string().optional().describe('For sourceType "file": the extension without a dot, e.g. "pdf". Inferred from fileUrl when omitted.'),
        title: z.string().optional().describe('Optional title (otherwise derived from the content).'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return brandKnowledgeItemResult(
          await client.addBrandKnowledge(args.brandKitId, {
            sourceType: args.sourceType,
            text: args.text,
            url: args.url,
            fileData: args.fileData,
            fileUrl: args.fileUrl,
            fileExt: args.fileExt,
            title: args.title,
          }),
        )
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- remove_brand_knowledge -----------------------------------------------
  server.registerTool(
    'remove_brand_knowledge',
    {
      title: 'Remove Brand Knowledge',
      annotations: WRITE,
      description:
        "Remove a knowledge item and its embedding chunks from a brand kit's knowledge base. Requires the brandkit:write scope.",
      inputSchema: {
        brandKitId: z.string().describe('The brand kit id.'),
        knowledgeId: z.string().describe('The knowledge item id to remove.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        const res = await client.removeBrandKnowledge(args.brandKitId, args.knowledgeId)
        return brandKnowledgeItemResult(
          { id: res.id, title: null, sourceType: null, sourceUrl: null, createdAt: null, updatedAt: null },
          'Removed',
        )
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- list_media -----------------------------------------------------------
  server.registerTool(
    'list_media',
    {
      title: 'List Media',
      annotations: READ,
      description:
        "List the account's media, newest first. `source` selects which library: 'creations' (default) is studio generations, each an output with one or more variations (images, video, or audio); 'uploads' is the editor Uploads tab, the raw video, image, and audio files the user uploaded to edit with; 'stock' is stock media the user has already used in a project (cached and reusable); 'all' returns every library merged across sources, each item self-describing via its `source`. Filter with contentType and page with limit/offset. For creations you can also filter by kind ('board'/'creation'/'look') or favorited/archived. Each item shows its id and, for a single-file item like an upload, its file name, duration, and resolved URL inline, so you can reference it directly (for example, add an upload to a timeline with update_timeline). Call get_media to SEE an item (image blocks / video keyframes).",
      inputSchema: {
        source: z
          .enum(['creations', 'uploads', 'stock', 'all'])
          .optional()
          .describe("Which library to read: 'creations' (default, studio generations), 'uploads' (the editor Uploads tab), 'stock' (used stock media), or 'all' (every library merged newest-first)."),
        contentType: z
          .enum(['image', 'video', 'audio', 'transcript'])
          .optional()
          .describe('Filter to one media type.'),
        kind: z
          .enum(['creation', 'board', 'look'])
          .optional()
          .describe("Creations only. Filter by asset class: 'creation' (normal generations), 'board' (reference boards), or 'look'. Omit to list all."),
        status: z.string().optional().describe("Status filter; defaults to 'completed'."),
        favorited: z.boolean().optional().describe('Creations only. Only outputs that have a favorited variation.'),
        archived: z.boolean().optional().describe('Creations only. Only outputs that have an archived variation.'),
        limit: z.number().int().min(1).max(100).optional().describe('How many to return (default 20).'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return mediaListResult(
          await client.listMedia({
            source: args.source,
            contentType: args.contentType,
            kind: args.kind,
            status: args.status,
            favorited: args.favorited,
            archived: args.archived,
            limit: args.limit,
          }),
        )
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- search_media ---------------------------------------------------------
  server.registerTool(
    'search_media',
    {
      title: 'Search Media',
      annotations: READ,
      description:
        "Semantically search the account's editable media library (their generated creations, uploads, licensed stock, and brand assets) by describing the content in natural language. Returns matching assets ranked by relevance, each with its media kind, a description, tags, and, for videos, the timestamps of the specific scenes that matched, so a precise moment can be located. Use this to find existing material to place, reference, or build with, rather than generating new media, whenever the user refers to footage, images, audio, or clips they already have. Optionally restrict results to specific media kinds. This searches only the account's own usable library, never inspiration, published posts, or knowledge. Call get_media to SEE a match (image blocks / video keyframes).",
      inputSchema: {
        query: z
          .string()
          .describe('A natural-language description of the media to find, describing its visible or audible content.'),
        kinds: z
          .array(z.enum(['image', 'video', 'audio']))
          .optional()
          .describe('Restrict results to these media kinds. Omit to search all kinds.'),
        limit: z.number().int().min(1).max(50).optional().describe('Maximum number of assets to return (default 12, max 50).'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return mediaSearchResult(
          await client.searchMedia(args.query, { kinds: args.kinds, limit: args.limit }),
        )
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- library folder tools (Phase D) ---------------------------------------
  const smartQuerySchema = z
    .object({
      text: z.string().optional().describe('Natural-language description to match semantically.'),
      kinds: z.array(z.enum(['image', 'video', 'audio'])).optional(),
      sources: z.array(z.enum(['creations', 'uploads', 'stock'])).optional(),
      tags: z.array(z.string()).optional().describe('Require all of these tags.'),
      favoritedOnly: z.boolean().optional(),
      sort: z.enum(['relevance', 'recent', 'name']).optional(),
    })
    .optional()
    .describe('For a smart folder: the live query that defines its membership (the same filters as the library search bar).')

  server.registerTool(
    'list_folders',
    {
      title: 'List Folders',
      annotations: READ,
      description:
        "List the account's library folders (their own manual and smart folders, as a flat list with parent links for nesting) together with the built-in derived folders (recents, favorites, edits, canvas, cards). Use this to see how the library is organized before browsing or filing items.",
      inputSchema: {},
    },
    async (_args, extra) => {
      try { return folderListResult(await (await getClient(extra)).listFolders()) } catch (err) { return errorResult(err) }
    },
  )

  server.registerTool(
    'get_folder',
    {
      title: 'Get Folder',
      annotations: READ,
      description:
        "Return the contents of one folder. The folder id is either one of the account's own folder ids or a built-in derived-folder key. A manual folder returns exactly the items filed in it; a smart folder computes its members live from its saved query; a derived folder returns its built-in set. Items are media (with kind and a description) and, in manual folders, entities such as projects or posts.",
      inputSchema: {
        folderId: z.string().describe('A folder id, or a derived-folder key (recents, favorites, edits, canvas, cards).'),
      },
    },
    async (args, extra) => {
      try { const r = await (await getClient(extra)).getFolder(args.folderId); return folderContentsResult(r.folder, r.items) } catch (err) { return errorResult(err) }
    },
  )

  server.registerTool(
    'create_folder',
    {
      title: 'Create Folder',
      annotations: WRITE,
      description:
        'Create a new library folder. A manual folder is an initially-empty collection you then file items into. A smart folder saves a query and stays live, always showing whatever currently matches. Optionally nest it under a parent folder. Create a folder only when the user wants to organize or save a view, not to hold a single transient result.',
      inputSchema: {
        name: z.string().describe('The folder name.'),
        type: z.enum(['manual', 'smart']).optional().describe("'manual' (a collection you file items into) or 'smart' (a saved live query). Defaults to manual."),
        query: smartQuerySchema,
        parentId: z.string().optional().describe('Nest the new folder under this parent folder id.'),
      },
    },
    async (args, extra) => {
      try {
        const f = await (await getClient(extra)).createFolder({ name: args.name, type: args.type, query: args.query, parentId: args.parentId })
        return text(`Created ${f.type} folder "${f.name}" (id ${f.id}).`)
      } catch (err) { return errorResult(err) }
    },
  )

  /**
   * One item's universal identity. NO folderId: the folder is named by the tool's own folderId /
   * folderIds now, which is what lets one call file many items into many folders.
   */
  const itemRefBodySchema = z.object({
    sourceTable: z.string().describe("The item's source table (e.g. as returned by list_media / get_media)."),
    sourceRecordId: z.string().describe("The item's source record id."),
    variant: z.number().int().optional().describe('The variation index (default 0 for single-asset items).'),
  })

  server.registerTool(
    'update_folder',
    {
      title: 'Update Folder',
      annotations: WRITE,
      description:
        "Update the account's own folders: rename one, MOVE folders under a different parent (or to the top level with a null parent), change a smart folder's saved query, and FILE or UNFILE items. addItems/removeItems are DELTAS of { sourceTable, sourceRecordId, variant? }, not a list to replace, because an item can sit in several folders at once and a replace would silently unfile it from the others. Filing never moves or copies anything: it adds a pointer, and only manual folders accept items (a smart folder computes its own membership). Pass folderIds to patch several folders at once, which crossed with addItems files the same items into all of them; renaming and re-querying still need exactly one folder. NOTE the asymmetry: nesting a FOLDER via parentId is a MOVE (a folder has one parent), while filing an ITEM is a pointer that leaves its other folders alone.",
      inputSchema: {
        folderId: z.string().describe('The folder id to update.'),
        folderIds: z
          .array(z.string())
          .optional()
          .describe('Patch several folders at once. Attribute fields (name, query) still need exactly one.'),
        name: z.string().optional().describe('A new name.'),
        parentId: z.string().nullable().optional().describe('A new parent folder id, or null to move to the top level. MOVES the folder.'),
        query: smartQuerySchema,
        addItems: z
          .array(itemRefBodySchema)
          .optional()
          .describe('File these items into the folder(s). A delta: their other folders are untouched.'),
        removeItems: z
          .array(itemRefBodySchema)
          .optional()
          .describe('Unfile these items. Only the pointer goes; the asset is never deleted.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        const patch = {
          name: args.name,
          parentId: args.parentId,
          query: args.query,
          addItems: args.addItems,
          removeItems: args.removeItems,
        }
        const targets: string[] = args.folderIds?.length ? args.folderIds : [args.folderId]
        const folders = targets.length > 1
          ? await client.updateFolders(targets, patch)
          : [await client.updateFolder(targets[0]!, patch)]

        const filed = args.addItems?.length ?? 0
        const unfiled = args.removeItems?.length ?? 0
        const what = [
          filed ? `filed ${filed} item(s)` : null,
          unfiled ? `unfiled ${unfiled} item(s)` : null,
        ].filter(Boolean).join(', ')
        const names = folders.map((f) => `"${f.name}" (id ${f.id})`).join(', ')
        return text(`Updated ${folders.length === 1 ? 'folder' : `${folders.length} folders`} ${names}${what ? `: ${what}` : '.'}`)
      } catch (err) { return errorResult(err) }
    },
  )

  server.registerTool(
    'delete_folder',
    {
      title: 'Delete Folder',
      annotations: WRITE,
      description:
        "Delete one of the account's own folders and everything nested under it. This removes the folder structure only; the media and entities inside are pointers, so the underlying assets are never deleted. Confirm intent before deleting a folder that contains items.",
      inputSchema: { folderId: z.string().describe('The folder id to delete.') },
    },
    async (args, extra) => {
      try { await (await getClient(extra)).deleteFolder(args.folderId); return text(`Deleted folder ${args.folderId}.`) } catch (err) { return errorResult(err) }
    },
  )


  // -- get_media ------------------------------------------------------------
  server.registerTool(
    'get_media',
    {
      title: 'Get Media',
      annotations: READ,
      description:
        'SEE specific media. Pass a batch of items (up to 10) to view them at once: each item is either a { url } (e.g. a URL threaded from get_context, a layer/asset URL from get_project / get_card, or an upload URL from list_media source=uploads) or an { mediaId, variation? } (a studio output id, full or first-8; omit variation to get the primary one). Returns light metadata per item plus an IMAGE block for each image so you can actually see it. For a VIDEO, set frames (and optionally fromSec/toSec) on the item to get low-res KEYFRAMES across that source-time window, so you can watch the raw footage (judge B-roll relevance, take quality) without editing it; audio still returns metadata + the url. An mediaId without a variation returns ONLY the primary variation and lists the others; request a specific variation to see it. Use this to inspect the actual pixels, not just URLs.',
      inputSchema: {
        items: z
          .array(
            z.union([
              z.object({
                url: z.string().describe('A media URL on our storage (from get_context / get_project / get_card).'),
                fromSec: z.number().min(0).optional().describe('Video keyframes: start of the source-time window (seconds). Omit for the whole clip.'),
                toSec: z.number().min(0).optional().describe('Video keyframes: end of the source-time window (seconds).'),
                frames: z.number().int().min(1).optional().describe('Video keyframes: how many to return across the window. Set this (or fromSec/toSec) to watch the raw footage.'),
              }),
              z.object({
                mediaId: z.string().describe('A studio output id (full or first-8 characters).'),
                variation: z
                  .number()
                  .int()
                  .positive()
                  .optional()
                  .describe('1-based variation to view; omit for the primary variation only.'),
                fromSec: z.number().min(0).optional().describe('Video keyframes: start of the source-time window (seconds). Omit for the whole clip.'),
                toSec: z.number().min(0).optional().describe('Video keyframes: end of the source-time window (seconds).'),
                frames: z.number().int().min(1).optional().describe('Video keyframes: how many to return across the window. Set this (or fromSec/toSec) to watch the raw footage.'),
              }),
            ]),
          )
          .min(1)
          .max(10)
          .describe('The media to view, up to 10 items per call. Paginate with another call for more.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        const result = await client.getMediaBatch(args.items)
        // Image blocks are an MCP-layer concern: fetch the resolver-chosen still
        // (imageUrl) for each item that has one (images + video posters). audio /
        // transcript / posterless items stay text-only. See get-context §9.5.
        // ⚠️ Ten items at 840 KB each is 8 MB against a 1 MB ceiling, and this used to fetch them all in
        // parallel with no bound. One shared budget, spent in order.
        const images = await inlineImagesWithinBudget(
          result.items.map((it) => (it.ok ? it.imageUrl : null)),
        )
        return mediaBatchResult(result, images)
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- create_media_upload --------------------------------------------------
  server.registerTool(
    'create_media_upload',
    {
      title: 'Create Media Upload',
      annotations: WRITE,
      description:
        'Upload a local file as first-class media (phase 1 of 2). Returns a signed uploadUrl and the exact headers to send; PUT the file bytes to that URL with those headers unchanged, then call complete_media_upload with the returned outputId. The finished media is referenceable by outputId in generate_* and as an asset on a card via update_card. For a file already on a public URL, use import_media instead. Requires the assets:write scope.',
      inputSchema: {
        fileName: z.string().describe('The file name (used for its extension), e.g. "cover.png".'),
        contentType: z.string().describe('The file MIME type, e.g. "image/png" or "video/mp4".'),
        sizeBytes: z.number().optional().describe('Optional file size in bytes.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return mediaUploadResult(
          await client.createMediaUpload({
            fileName: args.fileName,
            contentType: args.contentType,
            sizeBytes: args.sizeBytes,
          }),
        )
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- complete_media_upload ------------------------------------------------
  server.registerTool(
    'complete_media_upload',
    {
      title: 'Complete Media Upload',
      annotations: WRITE,
      description:
        'Finalize a media upload (phase 2 of 2) after the file bytes were PUT to the signed uploadUrl from create_media_upload. Publishes the media and returns its outputId + public URL. Requires the assets:write scope.',
      inputSchema: {
        outputId: z.string().describe('The outputId returned by create_media_upload.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return uploadedMediaResult(await client.completeMediaUpload(args.outputId))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- import_media ---------------------------------------------------------
  server.registerTool(
    'import_media',
    {
      title: 'Import Media',
      annotations: WRITE,
      description:
        'Import a remote URL as first-class media: the server fetches and re-hosts it, returning its outputId + public URL (referenceable by outputId in generate_* and as an asset on a card via update_card). Use this for a file already on a public URL, or from a hosted client that cannot read local files. Requires the assets:write scope.',
      inputSchema: {
        url: z.string().describe('A public http(s) URL to fetch and re-host.'),
        contentType: z.string().optional().describe('Optional MIME override (else taken from the response).'),
        fileName: z.string().optional().describe('Optional file name (used for its extension).'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return importedMediaResult(
          await client.importMedia({
            url: args.url,
            contentType: args.contentType,
            fileName: args.fileName,
          }),
        )
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- list_models ----------------------------------------------------------
  server.registerTool(
    'list_models',
    {
      title: 'List Models',
      annotations: READ,
      description:
        "List the generation models available to this account (the discovery catalog): which models exist, their content type and operation, and a compact capability summary. Use this to pick a model, then call get_model for its full request shape before generating. Source of truth for valid model ids; do not hardcode them.",
      inputSchema: {
        contentType: z
          .enum(['image', 'video', 'audio'])
          .optional()
          .describe('Filter to one content type.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return modelListResult(await client.listModels({ contentType: args.contentType }))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- get_model ------------------------------------------------------------
  server.registerTool(
    'get_model',
    {
      title: 'Get Model',
      annotations: READ,
      description:
        "Get one model's full request shape by id: the exact parameters it accepts (input types, prompt mode and char cap, duration range, resolutions, aspect ratios, max references, generation count, audio, features). Ground a generation against this instead of guessing the parameters, then preview cost with the matching generate tool's getCost option before running it.",
      inputSchema: {
        modelId: z.string().describe('The model id, e.g. from list_models (such as "veo-3.1-fast").'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return modelResult(await client.getModel(args.modelId))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- list_platforms -------------------------------------------------------
  server.registerTool(
    'list_platforms',
    {
      title: 'List Platforms',
      annotations: READ,
      description:
        "List the platforms this account can publish to (the discovery catalog): each platform's formats and whether a connected account exists for it. Use this to pick a platform and format, then call get_platform for the exact fields a post requires. Source of truth for valid platforms/formats; do not hardcode them.",
      inputSchema: {},
    },
    async (extra) => {
      try {
        const client = await getClient(extra)
        return platformListResult(await client.listPlatforms())
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- get_platform ---------------------------------------------------------
  server.registerTool(
    'get_platform',
    {
      title: 'Get Platform',
      annotations: READ,
      description:
        "Get one platform's full publishing shape: the fields, options (enums), and character limits a post requires per format (post, reel, short, story, thread). Ground a post's platformSettings against this instead of guessing the fields. Optionally pass a format to narrow the result.",
      inputSchema: {
        platform: z
          .enum(POST_PLATFORMS)
          .describe('The platform id, e.g. from list_platforms (such as "instagram").'),
        format: z
          .string()
          .optional()
          .describe('Optional format to narrow to (e.g. "reel", "short", "story", "thread").'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return platformResult(await client.getPlatform(args.platform, { format: args.format }))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- list_elements --------------------------------------------------------
  server.registerTool(
    'list_elements',
    {
      title: 'List Elements',
      annotations: READ,
      description:
        "List the account's saved reference elements: reusable named groups of images (a character, prop, location) addressable in a Kling prompt as @name. Reference one in a generation by elementId.",
      inputSchema: {},
    },
    async (_args, extra) => {
      try {
        const client = await getClient(extra)
        return elementListResult(await client.listElements())
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- get_element ----------------------------------------------------------
  server.registerTool(
    'get_element',
    {
      title: 'Get Element',
      annotations: READ,
      description: "Get one saved reference element by id: its name, category, description, and images.",
      inputSchema: { elementId: z.string().describe('The element id.') },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return elementResult(await client.getElement(args.elementId))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- create_element -------------------------------------------------------
  server.registerTool(
    'create_element',
    {
      title: 'Create Element',
      annotations: WRITE,
      description:
        "Create a reusable reference element from 2-4 images (or 1 video) of one entity (a character, prop, location). Images may be URLs or output-id tokens, so you can generate the angle shots first and assemble an element from them. Reference it later in a Kling 3.0 generation via references.elements [{ elementId }] and @name in the prompt.",
      inputSchema: {
        name: z.string().describe('Referenced in the prompt as @name.'),
        description: z.string().describe('What the element represents (required).'),
        category: z.enum(['auto', 'character', 'location', 'prop']).optional().describe("Kind of entity (default 'auto')."),
        images: z.array(z.string()).optional().describe('2-4 image URLs or output-id tokens.'),
        video: z.string().optional().describe('A single video URL or output-id token (alternative to images).'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return elementResult(
          await client.createElement({
            name: args.name,
            description: args.description,
            category: args.category,
            images: args.images,
            video: args.video,
          }),
          'Created',
        )
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- update_element -------------------------------------------------------
  server.registerTool(
    'update_element',
    {
      title: 'Update Element',
      annotations: WRITE,
      description: "Update a saved element's name, description, or category.",
      inputSchema: {
        elementId: z.string().describe('The element id.'),
        name: z.string().optional().describe('Rename the element.'),
        description: z.string().optional().describe('What this element is, in words. This is what makes it findable later.'),
        category: z.enum(['auto', 'character', 'location', 'prop']).optional().describe("What kind of element this is. 'auto' lets the server classify it from the image."),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return elementResult(
          await client.updateElement(args.elementId, { name: args.name, description: args.description, category: args.category }),
          'Updated',
        )
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- delete_element -------------------------------------------------------
  server.registerTool(
    'delete_element',
    {
      title: 'Delete Element',
      annotations: WRITE,
      description: 'Delete a saved reference element.',
      inputSchema: { elementId: z.string().describe('The element id.') },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        await client.deleteElement(args.elementId)
        return elementDeletedResult(args.elementId)
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- get_generation_status ------------------------------------------------
  server.registerTool(
    'get_generation_status',
    {
      ...RENDERS_GENERATION,
      title: 'Get Generation Status',
      annotations: READ,
      description:
        "Check one or more in-progress generations (outputIds from generate_image / generate_video / upscale / generate_lip_sync / generate_board) and get their final URLs. BY DEFAULT THIS BLOCKS until they finish, up to ~50s per call, because that is almost always what you want after starting a render; if one is still running it comes back with the current status and a poll_after_seconds hint, so call again. Pass wait:false for an instant snapshot with no blocking. Accepts 1-8 outputIds in one call.",
      inputSchema: {
        outputIds: z
          .array(z.string())
          .min(1)
          .max(8)
          .describe('1-8 outputIds to check (each from a prior generate_* call).'),
        wait: z
          .boolean()
          .optional()
          .describe('Block until terminal (up to ~50s), the default. false = an instant snapshot.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        const blocking = args.wait !== false
        const gens = await Promise.all(
          args.outputIds.map(async (id) => {
            if (!blocking) return client.getGeneration(id)
            try {
              return await client.waitForGeneration(id, { timeoutMs: SMART_WAIT_MS })
            } catch (err) {
              // Timeout is expected for a slow render. A transient poll error is not, but
              // it must not fail the whole BATCH either: fall back to a status snapshot so
              // the other ids still report, and only surface the error if even that fails.
              if (err instanceof GenerationTimeoutError) return client.getGeneration(id)
              try {
                return await client.getGeneration(id)
              } catch {
                throw err
              }
            }
          }),
        )
        // ⭐ Only the single-generation case is attached: a batch of ten would embed ten sets of bytes into
        // one result. Polling ONE generation is the case a person is watching, and the one worth rendering.
        const attachments =
          gens.length === 1 && gens[0]
            ? { [gens[0].outputId]: await attachmentsFor(gens[0]) }
            : {}
        return generationBatchResult(gens, attachments)
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- list_cards -----------------------------------------------------------
  server.registerTool(
    'list_cards',
    {
      title: 'List Cards',
      annotations: READ,
      description:
        "List one SPACE's cards (newest-updated first). ⚠️ SCOPED, NOT COMPLETE: without spaceId this lists the account's DEFAULT space only, and cards on any other board are absent with nothing in the response saying so (search misses them too). Call list_spaces FIRST and pass spaceId unless you specifically mean the default board. Filter by status, platform, stage (id/slug/name), favorite, or a title search. Call get_card for one card's full detail (posts + assets).",
      inputSchema: {
        spaceId: z
          .string()
          .optional()
          .describe(
            "Which space's board to list, from list_spaces. Omit ONLY when you mean the account's default space; omitting it does not search every board.",
          ),
        archived: z
          .boolean()
          .optional()
          .describe('Only ARCHIVED cards. Archived cards are excluded by default, matching the board.'),
        platform: z.enum(POST_PLATFORMS).optional().describe('Filter by the post platform.'),
        stage: z.string().optional().describe('Filter by a stage id, slug, or name. Resolved within the chosen space.'),
        search: z.string().optional().describe('Case-insensitive title search, scoped to the chosen space.'),
        limit: z.number().int().min(1).max(100).optional().describe('How many to return (default 50).'),
        offset: z.number().int().min(0).optional().describe('Pagination offset.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return cardListResult(
          await client.listCards({
            spaceId: args.spaceId,
            archived: args.archived,
            platform: args.platform,
            stage: args.stage,
            search: args.search,
            limit: args.limit,
            offset: args.offset,
          }),
        )
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- get_card -------------------------------------------------------------
  server.registerTool(
    'get_card',
    {
      title: 'Get Card',
      annotations: READ,
      description:
        'Get one CARD in full: its fields (title, description, script, notes, status, stage, schedule), plus its posts (one per platform, which is how it publishes) and its attached assets in carousel order.',
      inputSchema: {
        cardId: z.string().describe('The card id from list_cards.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return cardResult(await client.getCard(args.cardId))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- list_spaces ----------------------------------------------------------
  server.registerTool(
    'list_spaces',
    {
      title: 'List Spaces',
      annotations: READ,
      description:
        "List the account's SPACES. A space is the planner's top-level container: Space > Stage > Card > Post. Each space has its own stages, so two spaces can both hold a stage called 'Published'. Call this FIRST to discover which board to work in, then pass a space id to list_stages, list_cards or create_card. Archived spaces are excluded unless includeArchived is set.",
      inputSchema: {
        includeArchived: z
          .boolean()
          .optional()
          .describe('Include archived spaces. Default false, matching the grid in the app.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return spaceListResult(await client.listSpaces({ includeArchived: args.includeArchived }))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- get_space ------------------------------------------------------------
  server.registerTool(
    'get_space',
    {
      title: 'Get Space',
      annotations: READ,
      description:
        'Return one space with its live card count. Use list_spaces to discover ids. The count excludes archived cards, and is the same number list_spaces reports for that space.',
      inputSchema: { spaceId: z.string().describe('The space id.') },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return spaceResult(await client.getSpace(args.spaceId))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- create_space ---------------------------------------------------------
  server.registerTool(
    'create_space',
    {
      title: 'Create Space',
      annotations: WRITE,
      description:
        "Create a space: a new planner board with its own stages. duplicateFrom copies another space's STAGES, never its cards, so the new board arrives with the columns and none of the work. Requires the planner:write scope.",
      inputSchema: {
        name: z.string().describe('The space name.'),
        coverUrl: z.string().optional().describe('A cover image URL for the space tile.'),
        duplicateFrom: z
          .string()
          .optional()
          .describe("Copy this space's stages into the new one. Cards are never copied."),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return spaceResult(
          await client.createSpace({
            name: args.name,
            coverUrl: args.coverUrl,
            duplicateFrom: args.duplicateFrom,
          }),
        )
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- update_space ---------------------------------------------------------
  server.registerTool(
    'update_space',
    {
      title: 'Update Space',
      annotations: WRITE,
      description:
        "Rename a space or change its cover. This is a PATCH: a field you omit is left alone, so renaming does not disturb the cover. Pass coverUrl as an empty string to REMOVE the cover. To favorite or archive a space, use the `favorite` and `archive` tools with assetType 'space' instead. Requires the planner:write scope.",
      inputSchema: {
        spaceId: z.string().describe('The space id to update.'),
        name: z.string().optional().describe('A new name.'),
        coverUrl: z
          .string()
          .optional()
          .describe('A new cover image URL. Pass an empty string to remove the cover entirely.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        // An empty string is how a tool caller says "remove it": JSON Schema has no way to
        // distinguish an omitted string from an explicit null in a plain string field.
        const coverUrl = args.coverUrl === undefined ? undefined : args.coverUrl === '' ? null : args.coverUrl
        return spaceResult(await client.updateSpace(args.spaceId, { name: args.name, coverUrl }))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- delete_space ---------------------------------------------------------
  server.registerTool(
    'delete_space',
    {
      title: 'Delete Space',
      annotations: WRITE,
      description:
        'Delete a space. The server REFUSES a space that still holds cards and names the count, because the delete cascades to every card in it along with their covers, captions, posts and schedules. Archive the space instead if you want it out of the way. Requires the planner:write scope.',
      inputSchema: { spaceId: z.string().describe('The space id to delete.') },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        await client.deleteSpace(args.spaceId)
        return spaceDeletedResult(args.spaceId)
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- list_stages -------------------------------------------------
  server.registerTool(
    'list_stages',
    {
      title: 'List Pipeline Stages',
      annotations: READ,
      description:
        "List one SPACE's stages, in order. ⚠️ STAGES ARE PER-SPACE: without spaceId this is the account's DEFAULT space, and two spaces can each hold a stage named 'Published' with different ids, so a stage name resolved against the wrong space is a different column. Stages are user-customizable (renamed, reordered, added, removed), so call this to discover the real stages before placing a card; pass a stage's id (most stable), slug, or name to create_card / update_card.",
      inputSchema: {
        spaceId: z
          .string()
          .optional()
          .describe("Which space's stages, from list_spaces. Omit only when you mean the account's default space."),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return stageListResult(await client.listStages({ spaceId: args.spaceId }))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- create_stage ---------------------------------------------------------
  server.registerTool(
    'create_stage',
    {
      title: 'Create Stage',
      annotations: WRITE,
      description:
        "Create a stage (a column on one board). ⚠️ STAGES ARE PER-SPACE: without spaceId this creates on the account's DEFAULT board, which is rarely what you want once more than one space exists, so call list_spaces first. The slug is DERIVED from the name and is not settable; a board cannot hold two columns whose names produce the same slug and the server refuses the second rather than renaming it for you. Place the column with afterId/beforeId, or omit both to put it at the end. Requires the planner:write scope.",
      inputSchema: {
        name: z.string().describe('The column name, for example "In Review". Must contain a letter or number.'),
        spaceId: z
          .string()
          .optional()
          .describe("Which board, from list_spaces. Omit only when you mean the account's default space."),
        color: z.string().optional().describe('A hex color such as "#3B82F6".'),
        afterId: z.string().optional().describe('Put the new column immediately after this stage id.'),
        beforeId: z.string().optional().describe('Put the new column immediately before this stage id.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return stageResult(
          await client.createStage({
            name: args.name,
            spaceId: args.spaceId,
            color: args.color,
            afterId: args.afterId,
            beforeId: args.beforeId,
          }),
        )
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- update_stage ---------------------------------------------------------
  server.registerTool(
    'update_stage',
    {
      title: 'Update Stage',
      annotations: WRITE,
      description:
        "Rename, recolor or move one stage. This is a PATCH: a field you omit is left alone. ⚠️ spaceId is REQUIRED, because a stage id alone does not tell the server which board you mean and guessing the wrong one silently changes nothing. Renaming re-derives the slug, so renaming a column away from 'Published' also stops publishing auto-moving cards into it; a rename that collides with another column on the same board is refused. Moving names NEIGHBORS, not a position: pass afterId or beforeId. Requires the planner:write scope.",
      inputSchema: {
        stageId: z.string().describe('The stage id to update, from list_stages.'),
        spaceId: z.string().describe('The board this stage is on, from list_stages or list_spaces.'),
        name: z.string().optional().describe('A new name. The slug follows it automatically.'),
        color: z.string().optional().describe('A new hex color such as "#3B82F6".'),
        afterId: z
          .string()
          .optional()
          .describe('Move it immediately after this stage id. Use the empty string to move it to the far left.'),
        beforeId: z
          .string()
          .optional()
          .describe('Move it immediately before this stage id. Use the empty string to move it to the far right.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        /*
          An empty string is how a tool caller says "the edge": JSON Schema cannot distinguish an
          omitted string from an explicit null in a plain string field, and the two mean opposite
          things here. Omitted means "do not move it"; null means "move it to the end of the board".
          `update_space` resolves the same ambiguity the same way for coverUrl.
        */
        const edge = (v: string | undefined) => (v === undefined ? undefined : v === '' ? null : v)
        const { stage, respaced } = await client.updateStage(args.stageId, {
          spaceId: args.spaceId,
          name: args.name,
          color: args.color,
          afterId: edge(args.afterId),
          beforeId: edge(args.beforeId),
        })
        return stageResult(stage, respaced)
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- delete_stage ---------------------------------------------------------
  server.registerTool(
    'delete_stage',
    {
      title: 'Delete Stage',
      annotations: WRITE,
      description:
        'Delete a stage and move its cards to another column. The server REFUSES a column that still holds cards when you name no targetStageId, and tells you how many there are: cards are never destroyed by deleting a column, and the delete and the reassignment happen in one transaction. Returns the board that is left. Requires the planner:write scope.',
      inputSchema: {
        stageId: z.string().describe('The stage id to delete, from list_stages.'),
        spaceId: z.string().describe('The board this stage is on.'),
        targetStageId: z
          .string()
          .optional()
          .describe('Where this column\'s cards should go. Required unless the column is empty.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        const result = await client.deleteStage(args.stageId, {
          spaceId: args.spaceId,
          targetStageId: args.targetStageId ?? null,
        })
        return stageDeletedResult(result.id, result.movedCards, result.stages)
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- create_card ----------------------------------------------------------
  server.registerTool(
    'create_card',
    {
      title: 'Create Card',
      annotations: WRITE,
      description:
        "Create a card, the container in the content pipeline. A card holds the work (title, notes, cover) and the posts that publish it. Attach posts and media by passing `posts` and `assets` to update_card, then publish with publish_post. ⚠️ WITHOUT spaceId THIS LANDS ON THE ACCOUNT'S DEFAULT BOARD, which is rarely what you want once more than one space exists, so call list_spaces first. `stage` accepts a stage id/slug/name and DECIDES the space when it is an id; a spaceId that disagrees with it is rejected rather than guessed. Requires a key with the planner:write scope.",
      inputSchema: {
        title: z.string().describe('Post title (required).'),
        platform: z.enum(POST_PLATFORMS).describe('Primary platform for the post.'),
        spaceId: z
          .string()
          .optional()
          .describe(
            "Which board to create the card on, from list_spaces. Omit only when you mean the account's default space.",
          ),
        stage: z.string().optional().describe('Pipeline stage id, slug, or name. Defaults to the first stage.'),
        coverUrl: z.string().optional().describe('Public URL for the post cover (the card thumbnail).'),
        coverOutputId: z
          .string()
          .optional()
          .describe('A media token (output id, first-8, or "-N") for the cover, resolved to its URL. Use this or coverUrl.'),
        tags: z
          .array(z.string())
          .optional()
          .describe('Tag names to set on the post (must already exist; see list_tags / create_tag). Replaces the set.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return postSummaryResult(
          await client.createCard({
            title: args.title,
            platform: args.platform,
            spaceId: args.spaceId,
            stage: args.stage,
            coverUrl: args.coverUrl,
            coverOutputId: args.coverOutputId,
            tags: args.tags,
          }),
          'Created',
        )
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- update_card ----------------------------------------------------------
  server.registerTool(
    'update_card',
    {
      title: 'Update Card',
      annotations: WRITE,
      description:
        "Update a card: its fields (title, notes, platform, cover, stage), its POSTS (one per platform, which is how it publishes), its ASSETS (the media on it, in order), and its SCHEDULE. posts and assets are DECLARATIVE: pass the WHOLE set, because anything you leave out is removed. Posts key on platform. Assets key on id, and THE ARRAY ORDER IS THE carousel ORDER, so reordering is just sending the same ids in a different order; keep an existing asset by id, add a new one by assetUrl or outputId. scheduledAt sets the time on the card AND every post (pass null to clear); give a post its own scheduledAt to override it for that platform. To publish NOW, use publish_post. Pass spaceId to MOVE the card to another space; without a stage it lands in the target space's stage whose slug matches its current one, or that space's first stage. Pass cardIds to update several cards at once, which crossed with spaceId is how a selection moves in one call; fields that describe ONE card (title, notes, cover) still need exactly one. WRITING notes REQUIRES expectedRevision: read the card first and pass the revision it reported, or the call is refused. Requires the planner:write scope.",
      inputSchema: {
        cardId: z.string().describe('The card id.'),
        title: z.string().optional().describe('Rename the card. Keep it short: a long title wraps and makes the column unreadable.'),
        platform: z.enum(POST_PLATFORMS).optional().describe("The card's primary platform. This is a label on the card; what actually publishes is its posts."),
        stage: z.string().optional().describe('Move the card to this stage (id, slug, or name).'),
        spaceId: z
          .string()
          .optional()
          .describe(
            "Move the card to a different space (id or slug). Without a stage, it lands in that space's stage whose slug matches its current one, or that space's first stage.",
          ),
        cardIds: z
          .array(z.string())
          .optional()
          .describe(
            'Update several cards at once. Fields that describe ONE card (title, notes, cover) still require exactly one.',
          ),
        expectedRevision: z
          .number()
          .int()
          .optional()
          .describe(
            'REQUIRED when writing notes: the revision get_card reported for this card. A card\'s notes have four '
            + 'independent writers, each reading the whole document and writing it back, so without this the last '
            + 'writer silently erases the others and still gets a success. If the card changed since you read it, '
            + 'the call fails with a conflict carrying the current notes and revision: merge onto those and retry '
            + 'with the revision they came with. Never guess it or add one to it, because it only advances when '
            + 'notes actually change.',
          ),
        notes: z.string().optional().describe('Working notes on the card. Plain text or markdown; tables render here. No emojis.'),
        coverUrl: z.string().optional().describe('Public URL for the post cover.'),
        coverOutputId: z
          .string()
          .optional()
          .describe('A media token (output id, first-8, or "-N") for the cover, resolved to its URL.'),
        tags: z
          .array(z.string())
          .optional()
          .describe('Tag names to set on the post (must already exist; replaces the set). Omit to leave tags unchanged.'),
        scheduledAt: z
          .string()
          .nullable()
          .optional()
          .describe('ISO time to publish. Sets the card AND every post. null clears the schedule.'),
        posts: z
          .array(cardPostSchema)
          .optional()
          .describe("The card's posts, each { platform, format?, connectedAccountId?, platformSpecificData?, scheduledAt?, status? }. REPLACES the set, keyed by platform; [] detaches all."),
        assets: z
          .array(postAssetSchema)
          .optional()
          .describe("The post's assets IN ORDER, each { id } to keep an existing one or { assetUrl | outputId, assetType?, displayName? } to add. REPLACES the list; [] clears it."),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        const { cardId, cardIds, posts, assets, ...input } = args
        // The two declarative arrays are `unknown[]` in the schema (their entries are free-form objects the
        // server validates), so they are cast at this one boundary rather than duplicating the shape in zod.
        const patch = {
          ...input,
          ...(posts !== undefined ? { posts: posts as PostInput[] } : {}),
          ...(assets !== undefined ? { assets: assets as CardAssetInput[] } : {}),
        }
        // `cardIds` widens the path id, matching update_folder's folderId / folderIds. One card still
        // goes through updateCard so the single-card response shape is unchanged for every caller.
        const targets = cardIds?.length ? cardIds : [cardId]
        if (targets.length > 1) {
          const cards = await client.updateCards(targets, patch)
          return text(`Updated ${cards.length} cards.`)
        }
        return postSummaryResult(await client.updateCard(targets[0]!, patch), 'Updated')
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- list_tags ------------------------------------------------------------
  server.registerTool(
    'list_tags',
    {
      title: 'List Tags',
      annotations: READ,
      description:
        "List the account's tags (the organizational tag library). Set a post's tags with the `tags` field on create_card / update_card. A tag is just a lowercase name.",
      inputSchema: {},
    },
    async (extra) => {
      try {
        const client = await getClient(extra)
        return tagListResult(await client.listTags())
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- create_tag -----------------------------------------------------------
  server.registerTool(
    'create_tag',
    {
      title: 'Create Tag',
      annotations: WRITE,
      description:
        "Create a tag in the account's tag library (the name is lowercased). Tags organize posts; apply them with the `tags` field on create_card / update_card. Requires the planner:write scope.",
      inputSchema: {
        name: z.string().describe('The tag name (lowercased on save).'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return tagResult(await client.createTag(args.name), 'Created')
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- update_tag -----------------------------------------------------------
  server.registerTool(
    'update_tag',
    {
      title: 'Update Tag',
      annotations: WRITE,
      description:
        'Rename a tag (preserves its assignments on all posts). To detach a tag from one post, set that post\'s `tags` without it via update_card. Requires the planner:write scope.',
      inputSchema: {
        tagId: z.string().describe('The tag id (from list_tags).'),
        name: z.string().describe('The new tag name (lowercased on save).'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return tagResult(await client.updateTag(args.tagId, args.name), 'Renamed')
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- delete_tag -----------------------------------------------------------
  server.registerTool(
    'delete_tag',
    {
      title: 'Delete Tag',
      annotations: WRITE,
      description:
        "Delete a tag from the account's library. This DESTROYS the tag and removes it from every post it was on. To just detach a tag from one post, set that post's `tags` without it via update_card instead. Requires the planner:write scope.",
      inputSchema: {
        tagId: z.string().describe('The tag id (from list_tags).'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return tagDeletedResult(await client.deleteTag(args.tagId))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- publish_post ---------------------------------------------------------
  server.registerTool(
    'publish_post',
    {
      title: 'Publish Post',
      annotations: PUBLISH,
      description:
        "Publish a card's posts NOW: every post on the card, or only the named platform's post when `platform` is given. Each post must have a connected account. Requires a key with the publish:write scope; holding that scope is the account owner's consent to autonomous publishing. Returns one result per post.",
      inputSchema: {
        cardId: z.string().describe('The card id to publish.'),
        platform: z.enum(POST_PLATFORMS).optional().describe('Publish only this platform. Omit to publish all posts.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return publishResult(await client.publishPost(args.cardId, { platform: args.platform }))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- list_accounts --------------------------------------------------------
  server.registerTool(
    'list_accounts',
    {
      title: 'List Tracked Accounts',
      annotations: READ,
      description:
        "List the social accounts this ContentHero account tracks. TWO KINDS, in one list: accountType 'inspiration' is the creators and competitors they watch for research, 'brand' is their OWN profiles (distinct from list_brand_kits, which are the brand identity documents). Every row reports its own accountType, so omit the filter to see both. Call get_account for one account's performance, or list_content for the posts. Pass brandKitId to scope to the accounts linked to a specific brand kit.",
      inputSchema: {
        accountType: z
          .enum(['inspiration', 'brand'])
          .optional()
          .describe("Narrow to one kind. Omitted, both come back."),
        brandKitId: z.string().optional().describe('Scope to the accounts linked to this brand kit (from get_brand_kit).'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return trackedAccountListResult(await client.listAccounts(args))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- get_account ----------------------------------------------------------
  server.registerTool(
    'get_account',
    {
      title: 'Get Tracked Account',
      annotations: READ,
      description:
        "Get one tracked account with how its content actually performs: post count, total and average views/likes/comments, average engagement and outlier score, plus its top posts by outlier score and its most recent ones. Works for either kind of account: use it on one of the owner's OWN accounts to ground decisions in their real numbers, or on a creator they watch to study what works for that creator.",
      inputSchema: {
        accountId: z.string().describe('The account id from list_accounts.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        const detail = await client.getAccount(args.accountId)
        return accountDetailResult(detail)
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- list_content ---------------------------------------------------------
  server.registerTool(
    'list_content',
    {
      title: 'List Tracked Content',
      annotations: READ,
      description:
        "The core research read: social posts this account tracks, ranked by OUTLIER SCORE (how far a post overperformed its own creator's baseline, so a small account's hit still surfaces). SPANS BOTH the creators they watch and their OWN posts by default; set scope to narrow, and every row carries isOwn either way. This is how you answer both \"what is working for the people I watch\" and \"how did my own posts do\" without picking a subsystem first. Filter by platform, content type, a published window (publicationDate like 'week' or 'month', or exact publishedAfter/publishedBefore), and ranges over score, views, duration and follower count. Call get_content for one post in full, including its transcript.",
      inputSchema: {
        scope: z
          .enum(['all', 'inspiration', 'brand'])
          .optional()
          .describe("'inspiration' = creators they watch, 'brand' = their own accounts, 'all' = both (default)."),
        platform: z.enum(['youtube', 'instagram']).optional().describe('Filter to one platform.'),
        contentType: z.string().optional().describe("Filter by content type, e.g. 'video', 'short', 'reel'."),
        outlierScoreMin: z.number().optional().describe('Only content at or above this outlier score.'),
        outlierScoreMax: z.number().optional().describe('Only content at or below this outlier score.'),
        viewsMin: z.number().optional().describe('Only content at or above this view count.'),
        viewsMax: z.number().optional().describe('Only content at or below this view count.'),
        durationMin: z.number().optional().describe('Minimum duration in seconds.'),
        durationMax: z.number().optional().describe('Maximum duration in seconds.'),
        subscribersMin: z.number().optional().describe("Minimum follower count of the post's account."),
        subscribersMax: z.number().optional().describe("Maximum follower count of the post's account."),
        publicationDate: z
          .enum(['week', 'month', '3months', '6months', 'year', '2years'])
          .optional()
          .describe('Published within this window. Use publishedAfter for an exact date instead.'),
        publishedAfter: z.string().optional().describe('ISO timestamp. Wins over publicationDate.'),
        publishedBefore: z.string().optional().describe('ISO timestamp.'),
        search: z.string().optional().describe('Text search across title, creator, handle, and description.'),
        sortBy: z.enum(['score', 'date', 'views', 'engagement']).optional().describe("Sort field (default 'score')."),
        sortOrder: z.enum(['asc', 'desc']).optional().describe("Sort direction (default 'desc')."),
        accountIds: z.array(z.string()).optional().describe('Limit to these tracked account ids (from list_accounts).'),
        addedByYou: z.boolean().optional().describe('Only the one-off posts the owner saved by url.'),
        brandKitId: z.string().optional().describe('Scope to the accounts linked to this brand kit.'),
        favorited: z.boolean().optional().describe('Only content the account has favorited.'),
        limit: z.number().int().min(1).max(100).optional().describe('How many to return (default 20).'),
        offset: z.number().int().min(0).optional().describe('Pagination offset.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return outlierListResult(await client.listContent(args))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- get_content ----------------------------------------------------------
  server.registerTool(
    'get_content',
    {
      title: 'Get Tracked Content',
      annotations: READ,
      description:
        "Get one tracked post in full: engagement stats, outlier score, hashtags, keywords, mentions and audio info. Works for a creator's post and for the owner's own. THE TRANSCRIPT IS OPT-IN because a long video is a large document: pass transcript='text' for the whole thing, or transcript='segments' for timed slices, and then narrow with startMs/endMs or transcriptSearch to pull only the part that matters. The transcript reports a status: 'complete', 'not_applicable' (there is nothing to transcribe), 'failed' (it will be retried), 'processing', or 'absent' (never attempted), so an empty result is never ambiguous.",
      inputSchema: {
        contentId: z.string().describe('The content id from list_content or get_account.'),
        transcript: z
          .enum(['none', 'text', 'segments'])
          .optional()
          .describe("How much transcript to include. Default 'none'."),
        startMs: z.number().optional().describe('Window start, ms from the start of the media. Implies segments.'),
        endMs: z.number().optional().describe('Window end, ms from the start of the media. Implies segments.'),
        transcriptSearch: z
          .string()
          .optional()
          .describe('Return only the segments containing this phrase. Implies segments.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        const { contentId, ...options } = args
        return inspirationContentResult(await client.getContent(contentId, options))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- list_connected_accounts ----------------------------------------------
  server.registerTool(
    'list_connected_accounts',
    {
      title: 'List Connected Accounts',
      annotations: READ,
      description:
        "List the social accounts the owner has connected (the publish targets), default first. Use an account's id as connectedAccountId on a post in update_card, then publish_post. Read-only: connecting an account is done in the ContentHero app.",
    },
    async (extra) => {
      try {
        const client = await getClient(extra)
        return connectedAccountListResult(await client.listConnectedAccounts())
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- get_connected_account ------------------------------------------------
  server.registerTool(
    'get_connected_account',
    {
      title: 'Get Connected Account',
      annotations: READ,
      description:
        "Get one connected account's detail: platform, status, and capabilities. Use it to confirm a target can publish before attaching it to a post.",
      inputSchema: {
        accountId: z.string().describe('The connected account id from list_connected_accounts.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return connectedAccountResult(await client.getConnectedAccount(args.accountId))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- get_balance ----------------------------------------------------------
  server.registerTool(
    'get_balance',
    {
      title: 'Get Balance',
      annotations: READ,
      description: 'Get the current ContentHero credit balance, subscription tier, and auto-top-up state.',
    },
    async (extra) => {
      try {
        const client = await getClient(extra)
        return balanceResult(await client.getBalance())
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // ===========================================================================
  // Favorites & archive (one universal pair each, across asset types)
  // ===========================================================================

  // -- favorite -------------------------------------------------------------
  server.registerTool(
    'favorite',
    {
      title: 'Favorite',
      annotations: WRITE,
      description:
        "Favorite or UNfavorite an asset: pass favorited:false to clear it (default true). For a top-level asset, pass assetType + id (card, voice, brand_kit, project, inspiration_content, gallery, transition, space). To favorite a single studio media variation (one image/video/audio slot from list_media / get_media), pass the output id + variationIndex (1-based) and omit assetType. Requires the favorites:write scope. Idempotent in both directions.",
      inputSchema: {
        assetType: z
          .enum(['card', 'voice', 'brand_kit', 'project', 'inspiration_content', 'gallery', 'transition', 'space'])
          .optional()
          .describe('The kind of asset. Required unless targeting a media variation via variationIndex.'),
        id: z.string().describe('The asset id (or studio output id when using variationIndex).'),
        variationIndex: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('1-based studio media variation slot. When set, id is a studio output id and assetType is ignored.'),
        favorited: z.boolean().optional().describe('Default true. Pass false to UNfavorite.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        const favorited = args.favorited ?? true
        await client.favorite({ assetType: args.assetType, id: args.id, variationIndex: args.variationIndex, favorited })
        return statusActionResult(favorited ? 'Favorited' : 'Unfavorited', args)
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- unfavorite -----------------------------------------------------------
  // -- archive --------------------------------------------------------------
  server.registerTool(
    'archive',
    {
      title: 'Archive',
      annotations: WRITE,
      description:
        "Archive or UNarchive an asset: pass archived:false to restore it (default true). ContentHero never hard-deletes, so this is always reversible. For a top-level asset, pass assetType + id (card, brand_kit, brand_kit_section, project, space). To archive a single studio media variation, pass the output id + variationIndex (1-based) and omit assetType. Archiving is a timestamp and nothing else is touched, so a scheduled card restores as scheduled. Requires the favorites:write scope. Idempotent in both directions.",
      inputSchema: {
        assetType: z
          .enum(['card', 'brand_kit', 'brand_kit_section', 'project', 'space'])
          .optional()
          .describe('The kind of asset. Required unless targeting a media variation via variationIndex.'),
        id: z.string().describe('The asset id (or studio output id when using variationIndex).'),
        variationIndex: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('1-based studio media variation slot. When set, id is a studio output id and assetType is ignored.'),
        archived: z.boolean().optional().describe('Default true. Pass false to RESTORE (unarchive).'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        const archived = args.archived ?? true
        await client.archive({ assetType: args.assetType, id: args.id, variationIndex: args.variationIndex, archived })
        return statusActionResult(archived ? 'Archived' : 'Unarchived', args)
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- unarchive ------------------------------------------------------------
  server.registerTool(
    'list_projects',
    {
      title: 'List Projects',
      annotations: READ,
      description:
        "List the account's editor (video timeline) and canvas (slides/layers) projects. Filter by state (archived / favorited), by surface (editor / canvas), or by a title search. Returns lightweight summaries; call get_project for a single project's full composition. Requires the editor:read scope.",
      inputSchema: {
        filter: z.enum(['archived', 'favorited']).optional().describe('archived -> only archived; favorited -> favorited and not archived; omitted -> active (not archived).'),
        surface: z.enum(['editor', 'canvas']).optional().describe('Restrict to one surface; omitted returns both.'),
        kind: z.enum(['editor', 'canvas']).optional().describe('Deprecated alias for `surface`. Prefer `surface`; this is accepted for one release window.'),
        search: z.string().optional().describe('Case-insensitive title search.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return projectListResult(await client.listProjects(args))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  server.registerTool(
    'get_project',
    {
      title: 'Get Project',
      annotations: READ,
      description:
        "Read a project's composition + revision. By DEFAULT returns a SUMMARY: metadata + revision + a lightweight per-clip view, dropping heavy payloads (media URLs, transcripts, graphic code, caption words) so a structural read stays small. For a TIMELINE the summary is each clip's { id, type, from, durationInFrames, speed, trackId, disabled, sourceId }, where `sourceId` identifies the SOURCE FILE the clip was cut from: clips sharing a sourceId came from one recording, and a clip id never tells you this (ids are minted per edit, so a shared prefix means a shared operation, not a shared file). Use it to tell a rough cut of one recording apart from a timeline of separate files, which decides how much work a source-wide job is: an audio enhancement runs one vendor production per source. Absent when the clip's media is not one of our stored objects (an external stock url); for a CANVAS it is each slide with its layers' { id, type, text }, where a text layer's `text` is truncated to 80 chars and is what lets you tell one slide (or one of two text layers) from another without a full read. Pass detail:'full' for the complete composition (every prop, for a faithful round-trip or a deep edit). Scope a timeline read to a window with fromFrame/toFrame (and optionally trackId) to get just the clips overlapping that range, the same convention as get_transcript's startMs/endMs; scope a CANVAS read to one slide with slideId, which applies to detail:'full' too, so asking for a single slide's detail does not pay for the whole deck. Pass the returned revision back as expectedRevision for a concurrency-safe edit. Editing does NOT require this call: update_timeline/update_canvas' expectedRevision is optional, and get_transcript already returns the revision. Requires the editor:read scope.",
      inputSchema: {
        projectId: z.string().describe('The project id to read.'),
        detail: z.enum(['summary', 'full']).optional().describe("'summary' (default) returns the lightweight per-clip/per-layer structure; 'full' returns the complete composition with every property."),
        fromFrame: z.number().int().min(0).optional().describe('Timeline only: start of a frame window; returns clips overlapping [fromFrame, toFrame].'),
        toFrame: z.number().int().min(0).optional().describe('Timeline only: end of the frame window (see fromFrame).'),
        trackId: z.string().optional().describe('Timeline only: scope the read to a single track by id.'),
        slideId: z.string().optional().describe('Canvas only: scope the read to a single slide by id. Applies to detail:\'full\' as well. An id matching no slide returns every slide rather than nothing.'),
        includeRenderUrl: z.boolean().optional().describe('Also return a preview still URL of the current composition (renders one only if it changed).'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return projectDetailResult(await client.getProject(args.projectId, {
          includeRenderUrl: args.includeRenderUrl,
          detail: args.detail,
          fromFrame: args.fromFrame,
          toFrame: args.toFrame,
          trackId: args.trackId,
          slideId: args.slideId,
        }))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  server.registerTool(
    'get_context',
    {
      title: 'Get Live Context',
      annotations: READ,
      description:
        "Read the live context of what the user is currently viewing in the open app: the active surface, the focused element, the playhead, and the current selection, so you act on what the user is looking at rather than guessing. Read this first. It is fast, structured, and does not disturb the live page, and structured context alone is enough whenever the task does not depend on the exact pixels; it returns no image by default. Acquire vision only when the task genuinely requires seeing, and pick the path by what you need to see. Set render=true to see the composed output itself: the actual rendered editor frame or canvas slide, reconstructed from saved data, so you can visually verify your own edits while iterating. Pass frame (editor) or slideId/slideIndex (canvas) to inspect a specific point, or render=true alone for the point the user is viewing. The render returns inline as an image, is ephemeral, leaves nothing in the user's storage, and does not need a live tab. Set capture=true instead only when you need the user's actual screen as shown right now, including transient interface state and unsaved edits; capturing renders the current screen on demand, so its latency and brief page interruption grow with how visually heavy that screen is. Do not use export_project to check your work: exports are permanent deliverables that count against the user's storage; use render for previews. Returns the most-recent-active session and the live participant set, or nothing when no one is viewing (render still works with an explicit projectId). Optionally scope to one project. Requires the context:read scope.",
      inputSchema: {
        projectId: z.string().optional().describe('Scope to a specific project (editor/canvas). Omit for the user\'s most-recent-active surface anywhere. Required for render when no session is live.'),
        capture: z.boolean().optional().describe("Also return a screenshot of the user's live viewport (their SCREEN), captured at read time. Default false returns structured context only. Request it only when the task depends on seeing the live, as-shown state including unsaved UI. To see the composed OUTPUT rather than the screen, use render instead."),
        render: z.boolean().optional().describe('Also render your work so you can visually verify edits. Ephemeral, stored nowhere, counts against no quota, works without a live tab. render=true alone renders the current focus point as one image; add count with fromFrame/toFrame for several across a range; mode=video returns a short playable clip of that range. Use this to check your work, not export_project, which produces a file the user KEEPS. To watch a RAW source clip instead of your composition, use get_media with a video item.'),
        mode: z.enum(['image', 'video']).optional().describe("What MEDIUM to render (default 'image'). 'image' returns composed frames INLINE: one by default, or several across a range when you pass count with fromFrame/toFrame, to judge motion, flow and cut placement. 'video' returns the range actually playing, as a short low-res composed clip, for timing a cut or a beat that separate frames cannot show; it is a JOB, returning a renderId to poll with get_preview, because it has to be rendered."),
        frame: z.number().int().min(0).optional().describe("mode='image' (editor): which single timeline frame to render. Omit to render the current playhead frame."),
        slideId: z.string().optional().describe("mode='image' (canvas): the id of the slide to render. Omit to render the focused slide."),
        slideIndex: z.number().int().min(1).optional().describe("mode='image' (canvas): the 1-based slide index to render (alternative to slideId)."),
        fromFrame: z.number().int().min(0).optional().describe('Start timeline frame of the range, for several frames or a video. Omit to start at the beginning.'),
        toFrame: z.number().int().min(0).optional().describe('End timeline frame of the range. Omit to run to the end.'),
        count: z.number().int().min(1).optional().describe("mode='image': how many frames to return across the range. Omit for one frame at the focus point, or a proportional default when a range is given."),
        width: z.number().int().min(48).max(1440).optional().describe("mode='image': render at an explicit DISPLAY width in pixels, to judge legibility at the size the output will actually be seen (a course tile, a thumbnail, a feed card) rather than at full resolution, where small type always looks fine. Height follows the composition aspect ratio and is not settable. Clamped; the size produced is reported back on rendered."),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        /*
          ⭐⭐⭐ **`video` IS THE THIRD RUNG OF THIS LADDER, NOT A SEPARATE TOOL.** It used to be
          `create_preview`, and the split was drawn on HOW the render is delivered (a job, not inline)
          rather than on WHAT the caller is asking for. Both answers to "let me look at my own work,
          ephemerally, without producing a deliverable" now live behind one question.

          ⛔ THE EVIDENCE THE OLD BOUNDARY WAS WRONG WAS IN THE DESCRIPTIONS. `get_context` ended with
          "for a composed VIDEO of a range use create_preview" and `create_preview` ended with "to see a
          single frame or a few frames use get_context render". Two tools each telling the agent when to
          use the other is routing work the schema should be doing. The CLI had already reached this
          conclusion: it exposes `context preview`, a sibling of `context`, while export lives under
          `project`.

          ⚠️ THE TRANSPORT IS UNCHANGED. This is a facade over the same client call the old tool made, so
          nothing moved server-side and the SDK needed no new field.
        */
        if (args.mode === 'video') {
          const job = await client.createPreview({
            projectId: args.projectId ?? '',
            fromFrame: args.fromFrame,
            toFrame: args.toFrame,
          })
          return text(
            `Preview render started (frames ${job.fromFrame}-${job.toFrame}, ~${job.durationSeconds}s).\n` +
              `Poll get_preview with renderId="${job.renderId}" and bucketName="${job.bucketName}" until status is "done", then fetch the returned url.`,
          )
        }
        const result = await client.getContext({
          projectId: args.projectId,
          capture: args.capture,
          render: args.render,
          mode: args.mode,
          frame: args.frame,
          slideId: args.slideId,
          slideIndex: args.slideIndex,
          fromFrame: args.fromFrame,
          toFrame: args.toFrame,
          count: args.count,
          width: args.width,
        })
        const snapshotUrl = typeof result.context?.snapshotUrl === 'string' ? result.context.snapshotUrl : null
        const snapshot = snapshotUrl ? await fetchSnapshotBase64(snapshotUrl) : null
        return liveContextResult(result, snapshot)
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  server.registerTool(
    'get_preview',
    {
      title: 'Get Preview',
      annotations: READ,
      description:
        'Poll a preview started by get_context with mode="video". While rendering, returns the progress; when done, returns a short-lived url to the ephemeral preview output (plus the estimated cost). Requires the context:read scope.',
      inputSchema: {
        renderId: z.string().describe('The renderId returned by get_context with mode="video".'),
        bucketName: z.string().describe('The bucketName returned by get_context with mode="video".'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        const s = await client.getPreview({ renderId: args.renderId, bucketName: args.bucketName })
        if (s.status === 'done') {
          return text(`Preview ready. url: ${s.url}${typeof s.estimatedCostUsd === 'number' ? ` (est. cost $${s.estimatedCostUsd.toFixed(4)})` : ''}`)
        }
        if (s.status === 'failed') return text(`Preview render failed: ${s.error ?? 'unknown error'}.`, true)
        return text(`Preview still rendering${typeof s.progress === 'number' ? ` (${Math.round(s.progress * 100)}%)` : ''}. Poll again in a few seconds.`)
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  server.registerTool(
    'get_layer_types',
    {
      title: 'Get Layer Types',
      annotations: READ,
      description:
        'List the CANVAS layer types (image, text, solid/shape, video, graphic) and their editable props, so you know what update_canvas ops can create and set. Also returns shared prop groups (transform, decoration, adjust). Requires the editor:read scope.',
      inputSchema: {},
    },
    async (_args, extra) => {
      try {
        const client = await getClient(extra)
        return layerTypesResult(await client.getLayerTypes())
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  server.registerTool(
    'get_timeline_types',
    {
      title: 'Get Timeline Types',
      annotations: READ,
      description:
        'List the EDITOR timeline clip types (video, image, text, solid, audio, graphic) with their editable props, plus the track types (media, audio, text) and what each holds. Each clip type also carries a copy-pasteable `example` clip skeleton, and the catalog carries a `creation` section documenting the CREATE ops (create_clip, insert_track, insert_prebuilt_track) - so this one call tells you both what you can create (and the exact clip shape to pass) and what you can set. Read this before building any clip with update_timeline. Requires the editor:read scope.',
      inputSchema: {},
    },
    async (_args, extra) => {
      try {
        const client = await getClient(extra)
        return timelineTypesResult(await client.getTimelineTypes())
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  server.registerTool(
    'get_transcript',
    {
      title: 'Get Transcript',
      annotations: READ,
      description:
        "Read an EDITOR project's transcript mapped to its timeline clips, so you can do content-aware editing. Returns one segment per transcribable clip in timeline order, each carrying the words spoken within it plus its current state ([disabled] = cut/excluded from the render, [enabled] = kept) and its exact clipId. Use this to read what is said, see which parts are already disabled, then target the exact clipId(s) or source-time ranges with update_timeline (disable_ranges to non-destructively cut, set_disabled to toggle a whole clip). Pass `granularity: 'word'` to also get, per segment: word-level timing with ABSOLUTE timeline frames (so split / range ops are exact), per-word confidence + speaker, the derived silence gaps (for dead-air removal; already inset to the cuttable region so cutting them keeps breathing room), and the non-speech audio events (e.g. \"[chuckles]\"); plus the distinct speaker set at the top level. Word mode can be large, so scope it with `search` (a phrase to find) or `startMs`/`endMs` (a source-media window, which also clips the returned words) to page a long clip. Also returns the project's current `revision` so you can edit right away without a separate get_project: pass it as update_timeline's expectedRevision for a concurrency-safe edit, or omit expectedRevision to just apply to the current state. Returns mediaTranscribed:false when the media has not been transcribed yet. Requires the editor:read scope.",
      inputSchema: {
        projectId: z.string().describe('The editor project id.'),
        search: z.string().optional().describe('Case-insensitive substring; returns only clip segments whose text contains it.'),
        startMs: z.number().int().min(0).optional().describe('Source-media start time in ms; with endMs, returns only segments overlapping this window (and, in word mode, clips the returned words to it).'),
        endMs: z.number().int().min(0).optional().describe('Source-media end time in ms; companion to startMs.'),
        granularity: z.enum(['clip', 'word']).optional().describe("'clip' (default) returns text per clip; 'word' adds word timing + absolute timeline frames + confidence + speaker, derived silences, and audio events."),
        paceThresholdMs: z.number().int().min(0).optional().describe('Word mode: minimum pause (ms) to report as a silence / dead-air region ("Pace"). Defaults to the project\'s saved pace, else 500.'),
        paddingStartMs: z.number().int().optional().describe('Word mode: breathing room (ms) kept after speech at a silence start edge (negative tightens). Defaults to the saved padding, else 200.'),
        paddingEndMs: z.number().int().optional().describe('Word mode: breathing room (ms) kept before speech at a silence end edge (negative tightens). Defaults to the saved padding, else 200.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        const { projectId, ...options } = args
        return editorTranscriptResult(await client.getTranscript(projectId, options))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  server.registerTool(
    'create_project',
    {
      title: 'Create Project',
      annotations: WRITE,
      description:
        "Create a new project. `surface` picks where it lives: 'editor' (video timeline) or 'canvas' (slides/layers). All fields are optional; defaults match the in-app new-project flow (16:9 landscape, editor surface). A new canvas starts with one empty slide already, so add content to it with update_canvas create_layer (use create_slide only to add MORE slides); a new editor starts with an empty timeline. Returns the new project id + revision. Requires the editor:write scope.",
      inputSchema: {
        surface: z.enum(['editor', 'canvas']).optional().describe("The surface. Defaults to 'editor'."),
        kind: z.enum(['editor', 'canvas']).optional().describe("Deprecated alias for `surface`. Prefer `surface`; accepted for one release window."),
        title: z.string().optional().describe("Project title. Defaults to 'Untitled'."),
        orientation: z.string().optional().describe("Aspect ratio, e.g. '16:9', '9:16', '1:1'. Defaults to '16:9'."),
        width: z.number().optional().describe('Pixel width. Defaults from the orientation.'),
        height: z.number().optional().describe('Pixel height. Defaults from the orientation.'),
        brandKitId: z.string().optional().describe('Optional brand kit to associate.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return projectCreatedResult(await client.createProject(args))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  server.registerTool(
    'import_project',
    {
      title: 'Import Project',
      annotations: WRITE,
      description:
        "Import a PowerPoint / Google Slides file (by URL) or a Canva design (by id) into a NEW canvas project with editable layers. Set sourceType to 'pptx' and pass fileUrl (a URL to a .pptx / slides file), or set sourceType to 'canva' and pass designId (uses the account's Canva connection; fails with canva_not_connected if not linked). Returns the new project id + revision. Requires the editor:write scope.",
      inputSchema: {
        sourceType: z.enum(['pptx', 'canva']).describe("'pptx' for a file URL, 'canva' for a Canva design id."),
        fileUrl: z.string().optional().describe("Required when sourceType is 'pptx': a URL to the .pptx / slides file."),
        designId: z.string().optional().describe("Required when sourceType is 'canva': the Canva design id."),
        title: z.string().optional().describe("Title for the created project. Defaults to 'Imported deck'."),
      },
    },
    async (args, extra) => {
      try {
        if (args.sourceType === 'pptx' && !args.fileUrl) return errorResult(new Error("fileUrl is required when sourceType is 'pptx'."))
        if (args.sourceType === 'canva' && !args.designId) return errorResult(new Error("designId is required when sourceType is 'canva'."))
        const source =
          args.sourceType === 'pptx'
            ? ({ type: 'pptx', fileUrl: args.fileUrl as string } as const)
            : ({ type: 'canva', designId: args.designId as string } as const)
        const client = await getClient(extra)
        return projectCreatedResult(await client.importProject({ source, title: args.title }))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  server.registerTool(
    'export_project',
    {
      title: 'Export Project',
      annotations: WRITE,
      description:
        "Export (render) a project's saved composition to a downloadable file the user KEEPS: a permanent deliverable that counts against the user's storage. To preview or verify a frame or slide while editing, do NOT export; use get_context with render (ephemeral, stored nowhere). format 'mp4' works for both editor and canvas (a video render; may take a while). 'png' / 'jpg' work for both surfaces too: a canvas project renders one image per slide (multiple slides come back as a zip), while an editor project renders a single composited frame of the timeline (pick which frame with `frame`; defaults to frame 0). Canvas projects additionally support 'pdf' and 'pptx'. Resolution and watermark apply to EVERY format, not just mp4: a free account never exports above 720p and never removes the watermark, on any format or surface. `quality` is mp4 only. Returns the download URL when the render finishes in time, otherwise an exportId to poll with get_export. Requires the editor:write scope.",
      inputSchema: {
        projectId: z.string().describe('The project to export.'),
        format: z.enum(['mp4', 'png', 'jpg', 'pdf', 'pptx']).optional().describe("Output format. Defaults to 'mp4'. mp4/png/jpg work for both surfaces (png/jpg on an editor project render one timeline frame); pdf/pptx are canvas-only."),
        resolution: z.enum(['480p', '720p', '1080p', '2k', '4k']).optional().describe("Output resolution, for EVERY format including stills. Defaults '720p' for an editor mp4 and the project's NATIVE size for a still or canvas mp4, in both cases clamped to your plan. 1080p and above are plan-gated: NAMING one above your plan is a 403, omitting one clamps instead."),
        quality: z.enum(['low', 'recommended', 'high']).optional().describe('mp4 ONLY: video bitrate. Meaningless for a still, which has no duration to spread bits over. Defaults recommended.'),
        watermark: z.boolean().optional().describe('Keep the watermark. Defaults true; removing it is plan-gated.'),
        frame: z.number().int().min(0).optional().describe('Editor still (png/jpg) only: which timeline frame to render. Clamped to the composition length. Defaults 0. Use the playhead frame from get_context to render exactly the frame the user is viewing.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        const { projectId, ...input } = args
        const job = await client.exportProjectAndWait(projectId, input, { timeoutMs: SMART_WAIT_MS })
        return exportJobResult(job)
      } catch (err) {
        if (err instanceof GenerationTimeoutError) {
          return exportJobResult({ exportId: err.outputId, status: 'rendering' })
        }
        return errorResult(err)
      }
    },
  )

  server.registerTool(
    'get_export',
    {
      title: 'Get Export',
      annotations: READ,
      description:
        'Poll an export job started by export_project. Returns its status and, when done, the download URL. Requires the editor:read scope.',
      inputSchema: {
        exportId: z.string().describe('The export id returned by export_project.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return exportJobResult(await client.getExport(args.exportId))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  server.registerTool(
    'get_export_formats',
    {
      title: 'Get Export Formats',
      annotations: READ,
      description:
        'List the export formats (and their options) available per project surface, so you know what export_project accepts. Requires the editor:read scope.',
      inputSchema: {},
    },
    async (_args, extra) => {
      try {
        const client = await getClient(extra)
        return exportFormatsResult(await client.getExportFormats())
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  server.registerTool(
    'delete_project',
    {
      title: 'Delete Project',
      annotations: WRITE,
      description:
        "PERMANENTLY delete a project. This is irreversible: the project, its edit history, and its render exports are destroyed (uploaded media stays in the library). To reversibly hide a project instead, use archive. You must pass confirm: true to proceed. Requires the editor:write scope.",
      inputSchema: {
        projectId: z.string().describe('The project id to permanently delete.'),
        confirm: z.literal(true).describe('Must be true to confirm the irreversible permanent delete.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        await client.deleteProject(args.projectId)
        return projectDeletedResult(args.projectId)
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  server.registerTool(
    'update_timeline',
    {
      title: 'Update Timeline',
      annotations: WRITE,
      description:
        "Apply a batch of ops to an EDITOR (video timeline) project. update_timeline both CREATES and EDITS. EDIT ops act on existing clips: disable_ranges, delete_ranges, merge_clips, move_clip, trim_clip, split, delete_clip, duplicate, set_disabled, set_hidden, set_locked, group, ungroup, update_group, update_clip. CREATE ops add new clips/tracks: create_clip ({ op: 'create_clip', trackId, clip }) appends a clip to a track; insert_track ({ op: 'insert_track', referenceTrackId, position: 'above'|'below', trackType }) adds an empty track; insert_prebuilt_track ({ op: 'insert_prebuilt_track', index, track: { id, name, items: [item], trackType } }) inserts a whole track WITH its clips in one op (index 0 = top overlay) - the one-shot way to drop a graphic/text/shape onto a project without an existing empty track. TRANSITIONS: add_transition ({ op: 'add_transition', trackId, leftClipId, rightClipId, preset, durationFrames?, timing? }) adds a transition at the CUT between two TOUCHING adjacent clips (leftClipId's out-point meets rightClipId's in-point); preset is fade | crossfade | slide-left|right|up|down | wipe-left|right|up|down | flip | iris | clock-wipe; durationFrames defaults to 1s; one transition per cut (re-creating on the same pair replaces it); the result carries createdTransitionId. update_transition ({ op: 'update_transition', transitionId, patch: { preset?, durationFrames?, timing? } }) and remove_transition ({ op: 'remove_transition', transitionId }) edit or remove one (transition ids are on each track.transitions[] in get_project). ANIMATIONS: add_animation ({ op: 'add_animation', clipId, edge: 'in'|'out', preset, durationFrames?, timing? }) gives a single clip an ENTRANCE (edge 'in') or EXIT (edge 'out') animation, the clip animating against emptiness on that edge; preset is fade | slide-left|right|up|down | wipe-left|right|up|down | flip | iris | clock-wipe (single-clip presets, NOT crossfade which blends two clips); durationFrames defaults to 15 (0.5s at 30fps), timing 'linear' (default) or 'spring'; idempotent, a per-clip field keyed by clipId + edge so it creates or updates that edge's animation. remove_animation ({ op: 'remove_animation', clipId, edge: 'in'|'out' }) clears it. Choose add_animation when the motion belongs to ONE clip against emptiness; choose add_transition for a blend BETWEEN two adjacent clips. BACKGROUND REMOVAL: remove_background ({ op: 'remove_background', clipId }) cuts out the background of an IMAGE or VIDEO clip, replacing it with transparency, as an ASYNC job: the result carries a generatingOutputId to poll with get_generation_status, and the clip's media swaps to the transparent cutout when it completes (the original is kept, so it stays restorable). Image removal is FREE; video removal is a PREMIUM metered feature (Champion+, charged per second, 60s cap) and returns an error if the plan or credits are insufficient. Only image/video clips have a background; other clip types return an error. MASKS: to add a CapCut-style shape mask to an IMAGE or VIDEO clip, set its `masks` array via update_clip (or update_clips) - each entry is a ClipMask cutout (shape, normalized position/size, rotation, feather, invert) that keeps only the pixels inside its shape, multiple masks union, and invert:true subtracts; masks are a clip PROPERTY, not an op, so patch them like any other field (a patch REPLACES the whole array; set [] to clear), and read get_timeline_types for the exact ClipMask shape. CAPTIONS: add_captions ({ op: 'add_captions', style?, clipIds? }) generates word-timed captions from the project's transcript, one block per spoken clip on a dedicated caption track - whole-timeline by default, or pass clipIds to scope; `style` is a caption template key (omit for the default); clips without a ready transcript are skipped and reported in the result warnings (media is normally transcribed on ingest); re-running refreshes + restyles existing caption blocks. update_captions ({ op: 'update_captions', style?, patch?, clipIds? }) restyles EXISTING captions - `style` re-resolves a template, `patch` sets caption overlay props directly (e.g. { textColor: '#FFDD00', fontSize: 32 }); pass one or both; it never creates captions where none exist (that is add_captions). remove_captions ({ op: 'remove_captions', clipIds? }) removes captions (all, or a clipIds subset) and drops the caption track if empty. Build the `clip` from get_timeline_types, which returns a copy-pasteable `example` skeleton per clip type plus the `creation` op shapes; mint your own string ids and put overlays on a NON-primary media track so they do not ripple the primary. Each op is an object with an `op` name plus its fields (e.g. { op: 'delete_clip', clipIds: ['clip-id'] } or { op: 'move_clip', clipId: 'clip-id', toFrame: 90, toTrackIndex: 0 }). CONTENT-AWARE EDITING: to cut sections you found in get_transcript, DEFAULT to disable_ranges: { op: 'disable_ranges', clipId, ranges: [{ startMs, endMs }], note? } - it takes SOURCE-media time ranges, splits the clip and marks those ranges disabled (non-destructively excluded from the render but still on the timeline, so the user can review via skip-disabled playback and toggle any back on). Prefer the SILENCE edges get_transcript reports as your cut boundaries (they already include breathing room, so cuts do not clip words or feel abrupt) rather than exact word starts. Pass all of a clip's ranges in ONE disable_ranges op. The optional `note` is shown to the USER, so keep it concise and human and use mm:ss for any times (never raw ms). delete_ranges has the same shape but HARD-deletes (ripple-closes the gap, irreversible) - use it ONLY after the user explicitly approves a permanent delete; otherwise always prefer disable_ranges. set_disabled toggles a WHOLE clip by id. RE-TIMING: a time-based clip's timeline length is DERIVED from its source media and its playback speed, so you never set its `durationInFrames` directly. To retime a clip, set the duration-affecting property in the `update_clip` (or `update_clips`) patch (today that property is `speed`) and the reducer recomputes the clip's length for you: the clip keeps covering the same span of its source, so its timeline length scales inversely with the speed change (2x speed halves its length, 0.5x doubles it). Re-timing then honors each track's positioning in the SAME op: on the magnetic primary track the following clips ripple so that no gap opens and none is left behind, while clips on other (free) tracks, and every clip while the magnetic track is off, keep their absolute positions. So a speed change, whether on one clip or a bulk `update_clips`, lands gap-free in a single call with no per-clip length math on your side. Any `durationInFrames` you pass for such a clip is ignored in favor of the derived value. update_clips ({ op: 'update_clips', clipIds?, groupId?, patch }) applies one patch to a SET of clips at once, the bulk form of update_clip; target an explicit clipIds array OR a whole group via groupId (resolves to its members; clipIds wins if both). Every listed clip takes the same patch, but a duration-affecting property re-times each clip from ITS OWN values (a `speed` change recomputes each clip's length from its own source and speed, per the RE-TIMING rule above), and the magnetic primary track ripples so the whole batch lands gap-free in one op. Use it for a bulk property change (speed, volume, opacity, and so on) instead of many update_clip ops. GROUPS: group ({ op: 'group', clipIds, name? }) links 2+ clips under one shared groupId, stamping a stable 'Group N' ordinal that never renumbers (the result carries groupId + groupOrdinal); optional name labels it. ungroup ({ op: 'ungroup', clipIds }) clears the group. update_group ({ op: 'update_group', groupId, patch: { name } }) renames a group. List groups with their ids / ordinals / names / member clips via get_project's top-level `groups`, then target a whole group with update_group or update_clips { groupId }. merge_clips ({ op: 'merge_clips', clipIds }) rejoins adjacent, same-source, contiguous clips into one (the inverse of split; use it to clean up fragments a range edit leaves behind, or to reverse a cut after re-enabling the disabled pieces). ONE-SHOT CLEANUPS (prefer these over hand-rolling ranges for the common cases): remove_silence ({ op: 'remove_silence', paceThresholdMs?, paddingStartMs?, paddingEndMs? }) detects and disables dead-air pauses across the WHOLE timeline (paceThresholdMs = min pause length to cut, default 500; paddingStartMs/paddingEndMs = breathing room, default 200) - idempotent + re-adjustable, so re-running re-cuts at the new settings; remove_filler_words ({ op: 'remove_filler_words' }) disables high-confidence disfluencies (um/uh/er) across the whole timeline; extract_audio ({ op: 'extract_audio', clipIds? }) splits each video clip's audio onto its own track (whole-timeline, or a clipIds subset). remove_silence + remove_filler_words need a ready transcript; each reports a warning + changes nothing when there is nothing to do (no transcript / no gaps / no fillers / no video). They expand to the same disable_ranges / create_clip primitives, so reach for get_transcript + disable_ranges only for CONTEXTUAL or selective cuts the macros cannot express. expectedRevision is OPTIONAL: omit it to apply to the project's current revision (last-write-wins, fine for single-editor and id-targeted ops), or pass the revision from a prior get_project/get_transcript to fail loudly on a concurrent change instead of clobbering it. You do NOT need to fetch the project just to get the revision. Each successful edit returns the new revision for chaining further edits. Requires the editor:write scope.",
      inputSchema: {
        projectId: z.string().describe('The editor project id.'),
        ops: z.array(z.object({ op: z.string() }).passthrough()).describe('The timeline ops to apply, in order.'),
        userIntent: z.string().describe('A short description of what this edit does (for attribution).'),
        expectedRevision: z
          .number()
          .int()
          .optional()
          .describe('The revision from get_project; rejects with a conflict if a concurrent edit landed.'),
        includeRenderUrl: z.boolean().optional().describe('Also return a preview still URL of the resulting composition.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return editorOpsResult(
          await client.applyEditorOps({
            projectId: args.projectId,
            ops: args.ops as EditorOp[],
            userIntent: args.userIntent,
            expectedRevision: args.expectedRevision,
            includeRenderUrl: args.includeRenderUrl,
          }),
        )
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  server.registerTool(
    'update_canvas',
    {
      title: 'Update Canvas',
      annotations: WRITE,
      description:
        "Apply a batch of ops to a CANVAS (slides/layers) project. Ops act on layers + slides: create_layer, update_layer, delete_layer, reorder_layer, duplicate_layers, set_layer_hidden, set_layer_locked, group_layers, ungroup_layers, set_layer_as_background, create_slide, update_slide, delete_slide, duplicate_slides, reorder_slides, set_background, and more. BACKGROUND REMOVAL: remove_background ({ op: 'remove_background', layerId }) cuts out the background of an IMAGE or VIDEO layer, replacing it with transparency, as an ASYNC job (the result carries a generatingOutputId to poll with get_generation_status; the layer's media swaps to the transparent cutout when done, the original kept). Image removal is FREE; video removal is PREMIUM + metered (Champion+, per second, 60s cap). Other layer types return an error. Each op is an object with an `op` name plus its fields. expectedRevision is OPTIONAL: omit it to apply to the project's current revision (last-write-wins, fine for a single editor), or pass the revision from a prior get_project to fail loudly on a concurrent change instead of clobbering it. You do NOT need to fetch the project just to get the revision. Each successful edit returns the new revision for chaining further edits. Requires the editor:write scope.",
      inputSchema: {
        projectId: z.string().describe('The canvas project id.'),
        ops: z.array(z.object({ op: z.string() }).passthrough()).describe('The canvas ops to apply, in order.'),
        userIntent: z.string().describe('A short description of what this edit does (for attribution).'),
        expectedRevision: z
          .number()
          .int()
          .optional()
          .describe('The revision from get_project; rejects with a conflict if a concurrent edit landed.'),
        includeRenderUrl: z.boolean().optional().describe('Also return a preview still URL of the resulting composition.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return editorOpsResult(
          await client.applyEditorOps({
            projectId: args.projectId,
            ops: args.ops as EditorOp[],
            userIntent: args.userIntent,
            expectedRevision: args.expectedRevision,
            includeRenderUrl: args.includeRenderUrl,
          }),
        )
      } catch (err) {
        return errorResult(err)
      }
    },
  )
}

/** Read our own version from package.json (kept in lockstep with sdk). */
function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
      version?: string
    }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/**
 * Build a stdio-style server bound to a single env-configured client. The model
 * enums are resolved live from the discovery catalog (the client has a key).
 */
export async function buildServer(options: BuildServerOptions = {}): Promise<McpServer> {
  const getClient = options.getClient ?? defaultGetClient
  const models = await resolveModelEnums(getClient)
  const server = new McpServer({ name: 'contenthero', version: readVersion() })
  registerTools(server, { getClient: () => getClient(), models })
  return server
}
