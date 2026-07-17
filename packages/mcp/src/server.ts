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
 *   get_generation_status - poll an image/video outputId to its final URLs
 *   wait_for_generation - block until one or more outputIds finish (batch)
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
import { z } from 'zod'
import {
  ContentHero,
  GenerationTimeoutError,
  type GenerateRequest,
  type GenerateBoardRequest,
  type References,
  type EditorOp,
} from '@contenthero/sdk'
import { getClient as defaultGetClient } from './client.js'
import {
  resolveModelEnums,
  type ResolvedModelEnums,
  BOARD_TYPES,
  BOARD_TYPE_GUIDANCE,
  IMAGE_MODEL_GUIDANCE,
  VIDEO_MODEL_GUIDANCE,
  AUDIO_MODEL_GUIDANCE,
  UPSCALE_MODEL_GUIDANCE,
  LIP_SYNC_MODEL_GUIDANCE,
} from './models.js'
import {
  assetResult,
  audioResult,
  avatarListResult,
  avatarResult,
  balanceResult,
  brandKitListResult,
  brandKitResult,
  brandKitSectionResult,
  brandKnowledgeListResult,
  brandKnowledgeDetailResult,
  brandKnowledgeSearchResult,
  brandKnowledgeItemResult,
  brandPerformanceResult,
  completedResult,
  connectedAccountListResult,
  connectedAccountResult,
  costResult,
  destinationResult,
  inspirationAccountResult,
  inspirationContentResult,
  mediaListResult,
  mediaBatchResult,
  mediaUploadResult,
  uploadedMediaResult,
  assetOrderResult,
  assetRemovedResult,
  destinationRemovedResult,
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
  generationStatusResult,
  outlierListResult,
  pendingResult,
  pipelineStageListResult,
  postListResult,
  postResult,
  postSummaryResult,
  publishResult,
  statusActionResult,
  editorOpsResult,
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

/** Platforms a post or destination may target. */
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

async function fetchImageBytes(url: string): Promise<{ data: string; mimeType: string } | null> {
  if (!isAllowedImageHost(url)) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const mimeType = res.headers.get('content-type') || 'image/jpeg'
    if (!mimeType.startsWith('image/')) return null
    const data = Buffer.from(await res.arrayBuffer()).toString('base64')
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
async function fetchMediaImageBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  const optimized = optimizedImageSibling(url)
  if (optimized !== url) {
    const hit = await fetchImageBytes(optimized)
    if (hit) return hit
  }
  return fetchImageBytes(url)
}

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

  // -- generate_image -------------------------------------------------------
  server.registerTool(
    'generate_image',
    {
      title: 'Generate Image',
      annotations: WRITE,
      description:
        'Generate one or more images from a text prompt (optionally image-to-image with reference images). Waits for the result and returns the image URLs.',
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
        })
        if (args.getCost) return costResult(await client.estimateCost(request))
        const gen = await client.generateAndWait(request, { timeoutMs: SMART_WAIT_MS })
        return completedResult(gen)
      } catch (err) {
        if (err instanceof GenerationTimeoutError) return pendingResult(err.outputId)
        return errorResult(err)
      }
    },
  )

  // -- generate_board -------------------------------------------------------
  server.registerTool(
    'generate_board',
    {
      title: 'Generate Reference Board',
      annotations: WRITE,
      description:
        'Generate a Reference Board: a dense multi-panel reference sheet (3:4, 4K) built from a source image and/or a written description, used to keep a subject on-model across later generations (feed the board back in as a referenceImage). Provide referenceImages and/or a prompt (at least one is required). Waits up to ~50s; boards render slowly (minutes), so it usually returns an outputId to poll with get_generation_status.',
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
        })
        if (args.getCost) return costResult(await client.estimateBoardCost(request))
        const gen = await client.generateBoardAndWait(request, { timeoutMs: SMART_WAIT_MS })
        return completedResult(gen)
      } catch (err) {
        if (err instanceof GenerationTimeoutError) return pendingResult(err.outputId)
        return errorResult(err)
      }
    },
  )

  // -- generate_video -------------------------------------------------------
  server.registerTool(
    'generate_video',
    {
      title: 'Generate Video',
      annotations: WRITE,
      description:
        'Generate a video from a text prompt (optionally from a start/end frame or reference images/videos/audio). Waits up to ~50s; if the render is still running it returns an outputId to poll with get_generation_status. Seedance 2.0 has two input modes selected by which references you pass: a startFrame (and optional endFrame) runs start/end-frame mode; referenceImages / referenceVideos / referenceAudio (without a startFrame) run references mode.',
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
        })
        if (args.getCost) return costResult(await client.estimateCost(request))
        const gen = await client.generateAndWait(request, { timeoutMs: SMART_WAIT_MS })
        return completedResult(gen)
      } catch (err) {
        if (err instanceof GenerationTimeoutError) return pendingResult(err.outputId)
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
        'Generate audio with ElevenLabs: speech (TTS), music, or a sound effect. Returns the audio URL directly (synchronous, no polling).',
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
        })
        if (args.getCost) return costResult(await client.estimateCost(request))
        const result = await client.generate(request)
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
      title: 'Upscale',
      annotations: WRITE,
      description:
        'Upscale an existing image or video to a higher resolution. Provide the source media URL and a model-supported factor. Waits for the result; if the job is still running it returns an outputId to poll with get_generation_status.',
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
        return completedResult(gen)
      } catch (err) {
        if (err instanceof GenerationTimeoutError) return pendingResult(err.outputId)
        return errorResult(err)
      }
    },
  )

  // -- generate_lip_sync ----------------------------------------------------
  server.registerTool(
    'generate_lip_sync',
    {
      title: 'Generate Lip Sync',
      annotations: WRITE,
      description:
        'Animate a portrait image so the subject speaks. Provide imageUrl (the face) plus a voice source: either audioUrl (an existing speech clip) or script + voiceId (we synthesize the speech). Optional motionPrompt nudges expression/motion. Waits up to ~50s; if still rendering it returns an outputId to poll with get_generation_status.',
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
        return completedResult(gen)
      } catch (err) {
        if (err instanceof GenerationTimeoutError) return pendingResult(err.outputId)
        return errorResult(err)
      }
    },
  )

  // -- transcribe -----------------------------------------------------------
  server.registerTool(
    'transcribe',
    {
      title: 'Transcribe Audio',
      annotations: READ,
      description:
        'Transcribe an audio URL to text (speech-to-text). Returns the transcript directly (synchronous, free, no polling).',
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

  // -- update_brand_kit -----------------------------------------------------
  server.registerTool(
    'update_brand_kit',
    {
      title: 'Update Brand Kit',
      annotations: WRITE,
      description:
        "Update a brand kit's identity fields: business name, positioning, audience, voice profile, visual style, content strategy, etc. Only the fields you pass change. Requires a key with the brandkit:write scope. Get the current kit first with get_brand_kit.",
      inputSchema: {
        brandKitId: z.string().describe('The brand kit id.'),
        name: z.string().optional(),
        businessName: z.string().optional(),
        websiteUrl: z.string().optional(),
        primaryOffer: z.string().optional(),
        nicheDefinition: z.string().optional(),
        positioning: z.record(z.string(), z.unknown()).optional().describe('Positioning object (free-form).'),
        audience: z.record(z.string(), z.unknown()).optional().describe('Audience object (free-form).'),
        voiceProfile: z.record(z.string(), z.unknown()).optional().describe('Voice profile object (tone, style, ...).'),
        visualStyle: z.string().optional(),
        designPrinciples: z.array(z.string()).optional(),
        contentStrategy: z.record(z.string(), z.unknown()).optional().describe('Content strategy object (free-form).'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        const { brandKitId, ...input } = args
        return brandKitResult(await client.updateBrandKit(brandKitId, input))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- add_brand_kit_section ------------------------------------------------
  server.registerTool(
    'add_brand_kit_section',
    {
      title: 'Add Brand Kit Section',
      annotations: WRITE,
      description:
        "Add a curated section to a brand kit (a tab + name + a list of fields). Fields are objects like { key, label, type, value }. Requires the brandkit:write scope.",
      inputSchema: {
        brandKitId: z.string().describe('The brand kit id.'),
        tab: z.string().describe('The tab the section belongs to (e.g. "voice", "overview").'),
        sectionName: z.string().describe('The section title.'),
        sortOrder: z.number().int().optional().describe('Order within the tab (default 99 = end).'),
        fields: z.array(z.record(z.string(), z.unknown())).optional().describe('Field objects: { key, label, type, value }.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return brandKitSectionResult(
          await client.addBrandKitSection(args.brandKitId, {
            tab: args.tab,
            sectionName: args.sectionName,
            sortOrder: args.sortOrder,
            fields: args.fields,
          }),
          'Added section',
        )
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- update_brand_kit_section ---------------------------------------------
  server.registerTool(
    'update_brand_kit_section',
    {
      title: 'Update Brand Kit Section',
      annotations: WRITE,
      description:
        "Update a brand-kit section's name, order, or fields. Pass the full fields array to replace it. Requires the brandkit:write scope.",
      inputSchema: {
        brandKitId: z.string().describe('The brand kit id.'),
        sectionId: z.string().describe('The section id (from get_brand_kit).'),
        sectionName: z.string().optional(),
        sortOrder: z.number().int().optional(),
        fields: z.array(z.record(z.string(), z.unknown())).optional().describe('Replacement field objects.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return brandKitSectionResult(
          await client.updateBrandKitSection(args.brandKitId, args.sectionId, {
            sectionName: args.sectionName,
            sortOrder: args.sortOrder,
            fields: args.fields,
          }),
          'Updated section',
        )
      } catch (err) {
        return errorResult(err)
      }
    },
  )

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
        "List the account's recent studio outputs (generated images, videos, audio, transcripts), newest first. Reference boards are included too; filter with kind='board' (or 'creation'/'look'). Set favorited=true to show only outputs with a favorited variation, or archived=true for outputs with an archived variation. Each item has an id and its variation URLs. Call get_media for one output's full detail and individual variations (incl. per-variation favorite/archive state).",
      inputSchema: {
        contentType: z
          .enum(['image', 'video', 'audio', 'transcript'])
          .optional()
          .describe('Filter to one media type.'),
        kind: z
          .enum(['creation', 'board', 'look'])
          .optional()
          .describe("Filter by asset class: 'creation' (normal generations), 'board' (reference boards), or 'look'. Omit to list all."),
        status: z.string().optional().describe("Status filter; defaults to 'completed'."),
        favorited: z.boolean().optional().describe('Only outputs that have a favorited variation.'),
        archived: z.boolean().optional().describe('Only outputs that have an archived variation.'),
        limit: z.number().int().min(1).max(100).optional().describe('How many to return (default 20).'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return mediaListResult(
          await client.listMedia({
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

  // -- get_media ------------------------------------------------------------
  server.registerTool(
    'get_media',
    {
      title: 'Get Media',
      annotations: READ,
      description:
        'SEE specific media. Pass a batch of items (up to 10) to view them at once: each item is either a { url } (e.g. a URL threaded from get_context, or a layer/asset URL from get_project / get_post) or an { mediaId, variation? } (a studio output id, full or first-8; omit variation to get the primary one). Returns light metadata per item plus an IMAGE block for each image so you can actually see it (video/audio return metadata + the url, no frame yet). An mediaId without a variation returns ONLY the primary variation and lists the others; request a specific variation to see it. Use this to inspect the actual pixels, not just URLs.',
      inputSchema: {
        items: z
          .array(
            z.union([
              z.object({
                url: z.string().describe('A media URL on our storage (from get_context / get_project / get_post).'),
              }),
              z.object({
                mediaId: z.string().describe('A studio output id (full or first-8 characters).'),
                variation: z
                  .number()
                  .int()
                  .positive()
                  .optional()
                  .describe('1-based variation to view; omit for the primary variation only.'),
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
        const images = await Promise.all(
          result.items.map((it) =>
            it.ok && it.imageUrl ? fetchMediaImageBase64(it.imageUrl) : Promise.resolve(null),
          ),
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
        "Upload a local file as first-class media (phase 1 of 2). Returns a signed uploadUrl; PUT the file bytes to it with the file's Content-Type, then call complete_media_upload with the returned outputId. The finished media is referenceable by outputId in generate_* and add_post_asset. For a file already on a public URL, use import_media instead. Requires the assets:write scope.",
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
        'Import a remote URL as first-class media: the server fetches and re-hosts it, returning its outputId + public URL (referenceable by outputId in generate_* and add_post_asset). Use this for a file already on a public URL, or from a hosted client that cannot read local files. Requires the assets:write scope.',
      inputSchema: {
        url: z.string().describe('A public http(s) URL to fetch and re-host.'),
        contentType: z.string().optional().describe('Optional MIME override (else taken from the response).'),
        fileName: z.string().optional().describe('Optional file name (used for its extension).'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return uploadedMediaResult(
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
        "Get one platform's full publishing shape: the fields, options (enums), and character limits a post requires per format (post, reel, short, story, thread). Ground a destination's platformSettings against this instead of guessing the fields. Optionally pass a format to narrow the result.",
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
      inputSchema: { id: z.string().describe('The element id.') },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return elementResult(await client.getElement(args.id))
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
        id: z.string().describe('The element id.'),
        name: z.string().optional(),
        description: z.string().optional(),
        category: z.enum(['auto', 'character', 'location', 'prop']).optional(),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return elementResult(
          await client.updateElement(args.id, { name: args.name, description: args.description, category: args.category }),
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
      inputSchema: { id: z.string().describe('The element id.') },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        await client.deleteElement(args.id)
        return elementDeletedResult(args.id)
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- get_generation_status ------------------------------------------------
  server.registerTool(
    'get_generation_status',
    {
      title: 'Get Generation Status',
      annotations: READ,
      description:
        'Get the current status of an image or video generation by its outputId (returned by generate_image / generate_video when a render is still in progress). Returns the final URLs once complete, otherwise the current status plus a poll_after_seconds hint. For a blocking wait on one or more outputIds, use wait_for_generation.',
      inputSchema: {
        outputId: z.string().describe('The outputId from generate_image or generate_video.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        const gen = await client.getGeneration(args.outputId)
        return generationStatusResult(gen)
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- wait_for_generation --------------------------------------------------
  server.registerTool(
    'wait_for_generation',
    {
      title: 'Wait For Generation',
      annotations: READ,
      description:
        'Wait for one or more in-progress generations (outputIds from generate_image / generate_video / upscale / generate_lip_sync / generate_board) to finish, and return their final URLs. Blocks up to ~50s per call; if a render is still running it returns the current status with a poll_after_seconds hint to call again. Pass wait=false for an instant status snapshot instead of blocking.',
      inputSchema: {
        outputIds: z
          .array(z.string())
          .min(1)
          .max(8)
          .describe('1-8 outputIds to wait on (each from a prior generate_* call).'),
        wait: z
          .boolean()
          .optional()
          .describe('Block until terminal (up to ~50s) when true (the default). false = an instant snapshot, no blocking.'),
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
              if (err instanceof GenerationTimeoutError) return client.getGeneration(id)
              throw err
            }
          }),
        )
        return generationBatchResult(gens)
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- list_posts -----------------------------------------------------------
  server.registerTool(
    'list_posts',
    {
      title: 'List Posts',
      annotations: READ,
      description:
        "List the account's content-pipeline posts (newest-updated first). Filter by status, platform, pipeline_stage (id/slug/name), folder, favorite, or a title search. Call get_post for one post's full detail (destinations + assets).",
      inputSchema: {
        status: z.enum(['draft', 'active', 'completed', 'archived']).optional().describe('Filter by lifecycle status.'),
        platform: z.enum(POST_PLATFORMS).optional().describe('Filter by the post platform.'),
        pipelineStage: z.string().optional().describe('Filter by a pipeline stage id, slug, or name.'),
        search: z.string().optional().describe('Case-insensitive title search.'),
        limit: z.number().int().min(1).max(100).optional().describe('How many to return (default 50).'),
        offset: z.number().int().min(0).optional().describe('Pagination offset.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return postListResult(
          await client.listPosts({
            status: args.status,
            platform: args.platform,
            pipelineStage: args.pipelineStage,
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

  // -- get_post -------------------------------------------------------------
  server.registerTool(
    'get_post',
    {
      title: 'Get Post',
      annotations: READ,
      description:
        "Get one post in full: its fields (title, description, script, notes, status, stage, schedule), plus its publish destinations and attached assets.",
      inputSchema: {
        postId: z.string().describe('The post id from list_posts.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return postResult(await client.getPost(args.postId))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- list_pipeline_stages -------------------------------------------------
  server.registerTool(
    'list_pipeline_stages',
    {
      title: 'List Pipeline Stages',
      annotations: READ,
      description:
        "List the account's pipeline stages, in order. Stages are user-customizable (renamed, reordered, added, removed), so call this to discover the real stages before placing a post; pass a stage's id (most stable), slug, or name to create_post / update_post.",
    },
    async (extra) => {
      try {
        const client = await getClient(extra)
        return pipelineStageListResult(await client.listPipelineStages())
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- create_post ----------------------------------------------------------
  server.registerTool(
    'create_post',
    {
      title: 'Create Post',
      annotations: WRITE,
      description:
        "Create a content-pipeline post. The post is the container; attach platforms with add_post_destination and media with add_post_asset, then schedule_post or publish_post. `stage` accepts a stage id/slug/name (defaults to the first stage). Requires a key with the pipeline:write scope.",
      inputSchema: {
        title: z.string().describe('Post title (required).'),
        platform: z.enum(POST_PLATFORMS).describe('Primary platform for the post.'),
        description: z.string().optional().describe('Optional description / caption draft.'),
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
          await client.createPost({
            title: args.title,
            platform: args.platform,
            description: args.description,
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

  // -- update_post ----------------------------------------------------------
  server.registerTool(
    'update_post',
    {
      title: 'Update Post',
      annotations: WRITE,
      description:
        "Update a post's fields: title, description, script, notes, status, platform, cover (coverUrl/coverOutputId), or pipeline stage (move it through the pipeline by passing `stage`). Requires the pipeline:write scope.",
      inputSchema: {
        postId: z.string().describe('The post id.'),
        title: z.string().optional(),
        description: z.string().optional(),
        platform: z.enum(POST_PLATFORMS).optional(),
        status: z.enum(['draft', 'active', 'completed', 'archived']).optional(),
        stage: z.string().optional().describe('Move the post to this stage (id, slug, or name).'),
        script: z.string().optional(),
        notes: z.string().optional(),
        coverUrl: z.string().optional().describe('Public URL for the post cover.'),
        coverOutputId: z
          .string()
          .optional()
          .describe('A media token (output id, first-8, or "-N") for the cover, resolved to its URL.'),
        tags: z
          .array(z.string())
          .optional()
          .describe('Tag names to set on the post (must already exist; replaces the set). Omit to leave tags unchanged.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        const { postId, ...input } = args
        return postSummaryResult(await client.updatePost(postId, input), 'Updated')
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- add_post_destination -------------------------------------------------
  server.registerTool(
    'add_post_destination',
    {
      title: 'Add Post Destination',
      annotations: WRITE,
      description:
        "Attach a publish destination (one platform) to a post, or replace the existing one for that platform. Set connectedAccountId (an id from list_connected_accounts) to make it publishable. Pass platformSettings (the publish payload: media, caption, thumbnail, privacy) shaped to the platform + format; call get_platform first for the exact fields. In platformSettings, media URL fields (mediaItems, videoUrl, thumbnailUrl, ...) also accept an outputId of generated/uploaded media, resolved server-side. Requires the pipeline:write scope.",
      inputSchema: {
        postId: z.string().describe('The post id.'),
        platform: z.enum(POST_PLATFORMS).describe('Destination platform.'),
        format: z.string().optional().describe("Platform format, e.g. 'post', 'reel', 'story', 'short', 'thread'."),
        connectedAccountId: z.string().optional().describe('The connected account to publish through.'),
        scheduledAt: z.string().optional().describe('ISO-8601 scheduled time for this destination.'),
        platformSettings: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Per-platform/per-format publish config (mediaItems, caption, thumbnails, privacy, etc.). Get the exact field shape for this platform + format from get_platform.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return destinationResult(
          await client.addPostDestination(args.postId, {
            platform: args.platform,
            format: args.format,
            connectedAccountId: args.connectedAccountId,
            scheduledAt: args.scheduledAt,
            platformSettings: args.platformSettings,
          }),
        )
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- update_post_destination ----------------------------------------------
  server.registerTool(
    'update_post_destination',
    {
      title: 'Update Post Destination',
      annotations: WRITE,
      description:
        "Update one of a post's destinations (format, connected account, scheduled time, status, or platformSettings). Pass platformSettings (the publish payload: media, caption, thumbnail, privacy) shaped to the platform + format; call get_platform for the exact fields. It replaces the destination's settings, so include the full object. Requires the pipeline:write scope.",
      inputSchema: {
        postId: z.string().describe('The post id.'),
        destinationId: z.string().describe('The destination id (from get_post).'),
        format: z.string().optional(),
        connectedAccountId: z.string().optional(),
        scheduledAt: z.string().optional().describe('ISO-8601 scheduled time, or empty to clear.'),
        status: z.string().optional(),
        platformSettings: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Per-platform/per-format publish config (mediaItems, caption, thumbnails, privacy, etc.); replaces the existing settings. Get the field shape from get_platform.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return destinationResult(
          await client.updatePostDestination(args.postId, args.destinationId, {
            format: args.format,
            connectedAccountId: args.connectedAccountId,
            scheduledAt: args.scheduledAt,
            status: args.status,
            platformSettings: args.platformSettings,
          }),
        )
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- add_post_asset -------------------------------------------------------
  server.registerTool(
    'add_post_asset',
    {
      title: 'Add Post Asset',
      annotations: WRITE,
      description:
        "Attach an asset to a post, by outputId (generated or uploaded media, resolved to its URL) or by a public assetUrl. With outputId the assetType is inferred. Sets the post cover from the first image. Requires the assets:write scope.",
      inputSchema: {
        postId: z.string().describe('The post id.'),
        outputId: z
          .string()
          .optional()
          .describe('A media token (output id, first-8, or "-N") of generated/uploaded media. Provide this or assetUrl.'),
        assetUrl: z.string().optional().describe('Public URL of the asset. Provide this or outputId.'),
        assetType: z
          .enum(['image', 'video', 'audio', 'document', 'link'])
          .optional()
          .describe('The kind of asset. Required with assetUrl; inferred when using outputId.'),
        displayName: z.string().optional().describe('Optional display name.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return assetResult(
          await client.addPostAsset(args.postId, {
            outputId: args.outputId,
            assetType: args.assetType,
            assetUrl: args.assetUrl,
            displayName: args.displayName,
          }),
        )
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- reorder_post_assets --------------------------------------------------
  server.registerTool(
    'reorder_post_assets',
    {
      title: 'Reorder Post Assets',
      annotations: WRITE,
      description:
        "Set a post's asset order (e.g. the carousel slide order; the first image is the cover). Pass assetIds as ALL of the post's asset ids (from get_post) in the desired order. Requires the assets:write scope.",
      inputSchema: {
        postId: z.string().describe('The post id.'),
        assetIds: z
          .array(z.string())
          .describe("All of the post's asset ids (from get_post), in the desired order."),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return assetOrderResult(await client.reorderPostAssets(args.postId, args.assetIds))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- remove_post_asset ----------------------------------------------------
  server.registerTool(
    'remove_post_asset',
    {
      title: 'Remove Post Asset',
      annotations: WRITE,
      description:
        'Detach an asset from a post by its asset id (from get_post). Requires the assets:write scope.',
      inputSchema: {
        postId: z.string().describe('The post id.'),
        assetId: z.string().describe('The asset id (from get_post).'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return assetRemovedResult(await client.removePostAsset(args.postId, args.assetId))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- remove_post_destination ----------------------------------------------
  server.registerTool(
    'remove_post_destination',
    {
      title: 'Remove Post Destination',
      annotations: WRITE,
      description:
        'Detach a publish destination from a post by its destination id (from get_post). Requires the pipeline:write scope.',
      inputSchema: {
        postId: z.string().describe('The post id.'),
        destinationId: z.string().describe('The destination id (from get_post).'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return destinationRemovedResult(
          await client.removePostDestination(args.postId, args.destinationId),
        )
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
        "List the account's tags (the organizational tag library). Set a post's tags with the `tags` field on create_post / update_post. A tag is just a lowercase name.",
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
        "Create a tag in the account's tag library (the name is lowercased). Tags organize posts; apply them with the `tags` field on create_post / update_post. Requires the pipeline:write scope.",
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
        'Rename a tag (preserves its assignments on all posts). To detach a tag from one post, set that post\'s `tags` without it via update_post. Requires the pipeline:write scope.',
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
        "Delete a tag from the account's library. This DESTROYS the tag and removes it from every post it was on. To just detach a tag from one post, set that post's `tags` without it via update_post instead. Requires the pipeline:write scope.",
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

  // -- schedule_post --------------------------------------------------------
  server.registerTool(
    'schedule_post',
    {
      title: 'Schedule Post',
      annotations: WRITE,
      description:
        'Queue a post for future publishing: set the scheduled time on the post and all its destinations (pass scheduledAt=null to clear). This only queues; use publish_post to publish now. Requires the pipeline:write scope.',
      inputSchema: {
        postId: z.string().describe('The post id.'),
        scheduledAt: z
          .string()
          .nullable()
          .describe('ISO-8601 timestamp to schedule, or null to clear the schedule.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return postSummaryResult(await client.schedulePost(args.postId, args.scheduledAt), 'Scheduled')
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
        "Publish a post NOW to its destinations (a single platform when `platform` is given, otherwise all). Each destination must have a connected account. Requires a key with the publish:write scope; holding that scope is the account owner's consent to autonomous publishing. Returns per-destination results.",
      inputSchema: {
        postId: z.string().describe('The post id to publish.'),
        platform: z.enum(POST_PLATFORMS).optional().describe('Publish only this platform. Omit to publish all destinations.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return publishResult(await client.publishPost(args.postId, { platform: args.platform }))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- list_inspiration_accounts --------------------------------------------
  server.registerTool(
    'list_inspiration_accounts',
    {
      title: 'List Inspiration Accounts',
      annotations: READ,
      description:
        "List the creators/competitors the account tracks for inspiration. Use these as grounding for research; call list_outliers for their top content or get_inspiration_account for one account's detail. Pass brandKitId to scope to the inspiration accounts linked to a specific brand kit.",
      inputSchema: {
        brandKitId: z.string().optional().describe('Scope to the inspiration accounts linked to this brand kit (from get_brand_kit).'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return trackedAccountListResult(
          await client.listInspirationAccounts({ brandKitId: args.brandKitId }),
          'inspiration account(s)',
        )
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- get_inspiration_account ----------------------------------------------
  server.registerTool(
    'get_inspiration_account',
    {
      title: 'Get Inspiration Account',
      annotations: READ,
      description:
        "Get one tracked inspiration account with its content count and a few top outliers (by score). Use it to study a specific creator.",
      inputSchema: {
        accountId: z.string().describe('The account id from list_inspiration_accounts.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return inspirationAccountResult(await client.getInspirationAccount(args.accountId))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- list_outliers --------------------------------------------------------
  server.registerTool(
    'list_outliers',
    {
      title: 'List Outliers',
      annotations: READ,
      description:
        "List top-performing content (outliers) from the creators the account tracks, ranked by outlier score (how far a post overperformed its creator's baseline). Filter by platform, content type, minimum score, or a text search. Set favorited=true to show only content the account has favorited. Call get_inspiration_content for one item's full detail incl. transcript. This is the core research read for finding what's working.",
      inputSchema: {
        platform: z.enum(['youtube', 'instagram']).optional().describe('Filter to one platform.'),
        contentType: z.string().optional().describe("Filter by content type, e.g. 'video', 'short', 'reel'."),
        minOutlierScore: z.number().optional().describe('Only content at or above this outlier score.'),
        search: z.string().optional().describe('Text search across title, creator, handle, and description.'),
        sortBy: z.enum(['score', 'date', 'views']).optional().describe("Sort order (default 'score')."),
        brandKitId: z.string().optional().describe('Scope to the inspiration accounts linked to this brand kit (from get_brand_kit).'),
        favorited: z.boolean().optional().describe('Only content the account has favorited.'),
        limit: z.number().int().min(1).max(100).optional().describe('How many to return (default 20).'),
        offset: z.number().int().min(0).optional().describe('Pagination offset.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return outlierListResult(
          await client.listOutliers({
            platform: args.platform,
            contentType: args.contentType,
            minOutlierScore: args.minOutlierScore,
            search: args.search,
            sortBy: args.sortBy,
            brandKitId: args.brandKitId,
            favorited: args.favorited,
            limit: args.limit,
            offset: args.offset,
          }),
        )
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- get_inspiration_content ----------------------------------------------
  server.registerTool(
    'get_inspiration_content',
    {
      title: 'Get Inspiration Content',
      annotations: READ,
      description:
        "Get one tracked-content item in full: engagement stats, outlier score, hashtags, and the transcript when available. Use it to study exactly what a high-performing post says and does.",
      inputSchema: {
        contentId: z.string().describe('The content id from list_outliers or get_inspiration_account.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return inspirationContentResult(await client.getInspirationContent(args.contentId))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- list_brand_accounts --------------------------------------------------
  server.registerTool(
    'list_brand_accounts',
    {
      title: 'List Brand Accounts',
      annotations: READ,
      description:
        "List the account owner's OWN connected social accounts that ContentHero tracks for performance (distinct from list_brand_kits, which are the brand identity documents). Call get_brand_account_performance for one account's stats. Pass brandKitId to scope to the brand accounts linked to a specific brand kit.",
      inputSchema: {
        brandKitId: z.string().optional().describe('Scope to the brand accounts linked to this brand kit (from get_brand_kit).'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return trackedAccountListResult(
          await client.listBrandAccounts({ brandKitId: args.brandKitId }),
          'brand account(s)',
        )
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- get_brand_account_performance ----------------------------------------
  server.registerTool(
    'get_brand_account_performance',
    {
      title: 'Get Brand Account Performance',
      annotations: READ,
      description:
        "Get the performance summary for one of the owner's brand accounts: content count, total and average views/likes/comments, average engagement and outlier score, plus top and recent content. Use it to ground decisions in how the owner's own content actually performs.",
      inputSchema: {
        accountId: z.string().describe('The account id from list_brand_accounts.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return brandPerformanceResult(await client.getBrandAccountPerformance(args.accountId))
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
        "List the social accounts the owner has connected (the publish targets), default first. Use an account's id as connectedAccountId on add_post_destination, then publish_post. Read-only: connecting an account is done in the ContentHero app.",
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
        "Mark an asset as a favorite. For a top-level asset, pass assetType + id (post, voice, brand_kit, project, inspiration_content, gallery). To favorite a single studio media variation (one image/video/audio slot from list_media / get_media), pass the output id + variationIndex (1-based) and omit assetType. Requires the favorites:write scope. Idempotent.",
      inputSchema: {
        assetType: z
          .enum(['post', 'voice', 'brand_kit', 'project', 'inspiration_content', 'gallery'])
          .optional()
          .describe('The kind of asset. Required unless targeting a media variation via variationIndex.'),
        id: z.string().describe('The asset id (or studio output id when using variationIndex).'),
        variationIndex: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('1-based studio media variation slot. When set, id is a studio output id and assetType is ignored.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        await client.favorite({ assetType: args.assetType, id: args.id, variationIndex: args.variationIndex })
        return statusActionResult('Favorited', args)
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- unfavorite -----------------------------------------------------------
  server.registerTool(
    'unfavorite',
    {
      title: 'Unfavorite',
      annotations: WRITE,
      description:
        'Remove the favorite flag from an asset. Same target shape as favorite: assetType + id for a top-level asset, or output id + variationIndex (1-based) for a studio media variation. Requires the favorites:write scope. Idempotent.',
      inputSchema: {
        assetType: z
          .enum(['post', 'voice', 'brand_kit', 'project', 'inspiration_content', 'gallery'])
          .optional()
          .describe('The kind of asset. Required unless targeting a media variation via variationIndex.'),
        id: z.string().describe('The asset id (or studio output id when using variationIndex).'),
        variationIndex: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('1-based studio media variation slot. When set, id is a studio output id and assetType is ignored.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        await client.unfavorite({ assetType: args.assetType, id: args.id, variationIndex: args.variationIndex })
        return statusActionResult('Unfavorited', args)
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- archive --------------------------------------------------------------
  server.registerTool(
    'archive',
    {
      title: 'Archive',
      annotations: WRITE,
      description:
        "Archive an asset (reversible; ContentHero never hard-deletes). For a top-level asset, pass assetType + id (post, brand_kit, brand_kit_section, project). To archive a single studio media variation, pass the output id + variationIndex (1-based) and omit assetType. Archiving a post sets its status to 'archived'. Requires the favorites:write scope. Idempotent.",
      inputSchema: {
        assetType: z
          .enum(['post', 'brand_kit', 'brand_kit_section', 'project'])
          .optional()
          .describe('The kind of asset. Required unless targeting a media variation via variationIndex.'),
        id: z.string().describe('The asset id (or studio output id when using variationIndex).'),
        variationIndex: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('1-based studio media variation slot. When set, id is a studio output id and assetType is ignored.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        await client.archive({ assetType: args.assetType, id: args.id, variationIndex: args.variationIndex })
        return statusActionResult('Archived', args)
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- unarchive ------------------------------------------------------------
  server.registerTool(
    'unarchive',
    {
      title: 'Unarchive',
      annotations: WRITE,
      description:
        "Unarchive an asset (restore it). For a top-level asset, pass assetType + id (post, brand_kit, brand_kit_section, project). To unarchive a single studio media variation, pass the output id + variationIndex (1-based) and omit assetType. Unarchiving a post restores it to 'draft'. Requires the favorites:write scope. Idempotent.",
      inputSchema: {
        assetType: z
          .enum(['post', 'brand_kit', 'brand_kit_section', 'project'])
          .optional()
          .describe('The kind of asset. Required unless targeting a media variation via variationIndex.'),
        id: z.string().describe('The asset id (or studio output id when using variationIndex).'),
        variationIndex: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('1-based studio media variation slot. When set, id is a studio output id and assetType is ignored.'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        await client.unarchive({ assetType: args.assetType, id: args.id, variationIndex: args.variationIndex })
        return statusActionResult('Unarchived', args)
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // ===========================================================================
  // Editor / canvas ops (programmatic parity with the manual UI + in-app agent)
  // ===========================================================================

  server.registerTool(
    'list_projects',
    {
      title: 'List Projects',
      annotations: READ,
      description:
        "List the account's editor (video timeline) and canvas (slides/layers) projects. Filter by state (archived / favorited), by kind (editor / canvas), or by a title search. Returns lightweight summaries; call get_project for a single project's full composition. Requires the editor:read scope.",
      inputSchema: {
        filter: z.enum(['archived', 'favorited']).optional().describe('archived -> only archived; favorited -> favorited and not archived; omitted -> active (not archived).'),
        kind: z.enum(['editor', 'canvas']).optional().describe('Restrict to one surface; omitted returns both.'),
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
        "Read a single project's full detail: its metadata plus the current composition (canvas slides or editor timeline) and revision. Read this before editing when you need to see the full current composition; you can then pass its revision back as expectedRevision for a concurrency-safe edit. Note editing does NOT require this call: update_timeline/update_canvas' expectedRevision is optional (omit to apply to the current revision), and for content-aware editor edits get_transcript already returns the revision. Requires the editor:read scope.",
      inputSchema: {
        projectId: z.string().describe('The project id to read.'),
        includeRenderUrl: z.boolean().optional().describe('Also return a preview still URL of the current composition (renders one only if it changed).'),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        return projectDetailResult(await client.getProject(args.projectId, { includeRenderUrl: args.includeRenderUrl }))
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
        "Read the live context of what the user is currently viewing in the open app: the active surface, the focused element, the playhead, and the current selection, so you act on what the user is looking at rather than guessing. Read this first. It is fast, structured, and does not disturb the live page, and structured context alone is enough whenever the task does not depend on the exact pixels; it returns no image by default. Acquire vision only when the task genuinely requires seeing, and pick the path by what you need to see. Set capture=true to screenshot the live viewport when you need the screen as the user sees it right now, including transient interface state and unsaved edits; capturing renders the current screen on demand, so its latency and its brief interruption of the page grow with how visually heavy that screen is, so request it deliberately. On the two surfaces backed by a saved composition, the canvas and the editor, you have a second and usually better option for seeing the work itself: call export_project with the focus from this read to reconstruct that exact canvas slide or editor frame deterministically from saved data, without touching the live page and regardless of its visual weight, at the cost of showing saved rather than unsaved state. On any other surface, capture is the only way to see. Returns the most-recent-active session and the live participant set, or nothing when no one is viewing. Optionally scope to one project. Requires the context:read scope.",
      inputSchema: {
        projectId: z.string().optional().describe('Scope to a specific project (editor/canvas). Omit for the user\'s most-recent-active surface anywhere.'),
        capture: z.boolean().optional().describe("Also return a screenshot of the user's live viewport, captured at read time. Default false returns structured context only, which is fast, leaves the page undisturbed, and is enough for most reads. Capturing renders the current screen on demand, so its latency and its brief interruption of the page grow with the visual weight of what is displayed; request it only when the task depends on seeing the live, as-shown state. On the canvas and editor surfaces, when you need to see the saved composition itself (a slide or a frame) rather than the live screen, prefer export_project, which reconstructs it deterministically from saved data."),
      },
    },
    async (args, extra) => {
      try {
        const client = await getClient(extra)
        const result = await client.getContext({ projectId: args.projectId, capture: args.capture })
        const snapshotUrl = typeof result.context?.snapshotUrl === 'string' ? result.context.snapshotUrl : null
        const snapshot = snapshotUrl ? await fetchSnapshotBase64(snapshotUrl) : null
        return liveContextResult(result, snapshot)
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
        'List the EDITOR timeline clip types (video, image, text, solid, audio, graphic) with their editable props, plus the track types (media, audio, text) and what each holds, so you know what update_timeline ops can create and set. Requires the editor:read scope.',
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
        "Create a new project. `kind` picks the surface: 'editor' (video timeline) or 'canvas' (slides/layers). All fields are optional; defaults match the in-app new-project flow (16:9 landscape, editor kind). A new canvas starts with one empty slide already, so add content to it with update_canvas create_layer (use create_slide only to add MORE slides); a new editor starts with an empty timeline. Returns the new project id + revision. Requires the editor:write scope.",
      inputSchema: {
        kind: z.enum(['editor', 'canvas']).optional().describe("The surface. Defaults to 'editor'."),
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
        "Export (render) a project's saved composition to a downloadable file. format 'mp4' works for both editor and canvas (a video render; may take a while). 'png' / 'jpg' work for both surfaces too: a canvas project renders one image per slide (multiple slides come back as a zip), while an editor project renders a single composited frame of the timeline (pick which frame with `frame`; defaults to frame 0). Canvas projects additionally support 'pdf' and 'pptx'. For mp4, resolution ('720p' default; 1080p/2k/4k are plan-gated) and watermark (default on; removing it is plan-gated) apply. Returns the download URL when the render finishes in time, otherwise an exportId to poll with get_export. Requires the editor:write scope.",
      inputSchema: {
        projectId: z.string().describe('The project to export.'),
        format: z.enum(['mp4', 'png', 'jpg', 'pdf', 'pptx']).optional().describe("Output format. Defaults to 'mp4'. mp4/png/jpg work for both surfaces (png/jpg on an editor project render one timeline frame); pdf/pptx are canvas-only."),
        resolution: z.enum(['480p', '720p', '1080p', '2k', '4k']).optional().describe("mp4 video resolution. Defaults '720p'. 1080p+ is plan-gated."),
        quality: z.enum(['low', 'recommended', 'high']).optional().describe('mp4 video quality. Defaults recommended.'),
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
        "Apply a batch of ops to an EDITOR (video timeline) project. Ops act on clips: disable_ranges, delete_ranges, merge_clips, move_item, trim_item, split, ripple_delete, duplicate, set_disabled, set_hidden, set_locked, group, ungroup, update_item. Each op is an object with an `op` name plus its fields (e.g. { op: 'ripple_delete', itemIds: ['clip-id'] } or { op: 'move_item', itemId: 'clip-id', toFrame: 90, toTrackIndex: 0 }). CONTENT-AWARE EDITING: to cut sections you found in get_transcript, DEFAULT to disable_ranges: { op: 'disable_ranges', clipId, ranges: [{ startMs, endMs }], note? } - it takes SOURCE-media time ranges, splits the clip and marks those ranges disabled (non-destructively excluded from the render but still on the timeline, so the user can review via skip-disabled playback and toggle any back on). Prefer the SILENCE edges get_transcript reports as your cut boundaries (they already include breathing room, so cuts do not clip words or feel abrupt) rather than exact word starts. Pass all of a clip's ranges in ONE disable_ranges op. The optional `note` is shown to the USER, so keep it concise and human and use mm:ss for any times (never raw ms). delete_ranges has the same shape but HARD-deletes (ripple-closes the gap, irreversible) - use it ONLY after the user explicitly approves a permanent delete; otherwise always prefer disable_ranges. set_disabled toggles a WHOLE clip by id. merge_clips ({ op: 'merge_clips', itemIds }) rejoins adjacent, same-source, contiguous clips into one (the inverse of split; use it to clean up fragments a range edit leaves behind, or to reverse a cut after re-enabling the disabled pieces). expectedRevision is OPTIONAL: omit it to apply to the project's current revision (last-write-wins, fine for single-editor and id-targeted ops), or pass the revision from a prior get_project/get_transcript to fail loudly on a concurrent change instead of clobbering it. You do NOT need to fetch the project just to get the revision. Each successful edit returns the new revision for chaining further edits. Requires the editor:write scope.",
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
        "Apply a batch of ops to a CANVAS (slides/layers) project. Ops act on layers + slides: create_layer, update_layer, delete_layer, reorder_layer, duplicate_layers, set_layer_hidden, set_layer_locked, group_layers, ungroup_layers, set_layer_as_background, create_slide, update_slide, delete_slide, duplicate_slides, reorder_slides, set_background, and more. Each op is an object with an `op` name plus its fields. expectedRevision is OPTIONAL: omit it to apply to the project's current revision (last-write-wins, fine for a single editor), or pass the revision from a prior get_project to fail loudly on a concurrent change instead of clobbering it. You do NOT need to fetch the project just to get the revision. Each successful edit returns the new revision for chaining further edits. Requires the editor:write scope.",
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
