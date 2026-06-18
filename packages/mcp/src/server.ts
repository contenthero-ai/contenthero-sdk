/**
 * The ContentHero MCP server: intent-shaped tools over the @contenthero/sdk kernel.
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
 *
 * Intent-shaped generate tools rather than one generate_media: each operation
 * (generate / upscale / lip-sync) gets a tool whose schema only carries its own
 * fields, and per-tool modelId enums prevent cross-type model misuse. Image and
 * video share the async smart-wait lifecycle; audio shares almost no parameters
 * and runs synchronously.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  ContentHero,
  GenerationTimeoutError,
  type GenerateRequest,
  type GenerateBoardRequest,
  type References,
} from '@contenthero/sdk'
import { getClient as defaultGetClient } from './client.js'
import {
  resolveModelEnums,
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
  brandPerformanceResult,
  completedResult,
  costResult,
  destinationResult,
  inspirationAccountResult,
  inspirationContentResult,
  mediaListResult,
  mediaResult,
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
 * returns the clean "still rendering, call get_generation_status" handoff rather than
 * tripping the client's timeout. Comfortably covers images (~15-30s); slower
 * video/lip-sync jobs return the pollable pending result.
 */
const SMART_WAIT_MS = 50_000

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

export async function buildServer(options: BuildServerOptions = {}): Promise<McpServer> {
  const getClient = options.getClient ?? defaultGetClient
  // Resolve the per-tool model enums from the live discovery catalog (falls back
  // to static lists if discovery is unreachable). Done once at startup, since
  // tool schemas are advertised once; a restart picks up admin-switchboard changes.
  const models = await resolveModelEnums(getClient)
  const server = new McpServer({ name: 'contenthero', version: '0.2.1' })

  // -- generate_image -------------------------------------------------------
  server.registerTool(
    'generate_image',
    {
      title: 'Generate Image',
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
    async (args) => {
      try {
        const request = compact<GenerateRequest>({
          contentType: 'image',
          modelId: args.modelId,
          prompt: args.prompt,
          aspectRatio: args.aspectRatio,
          resolution: args.resolution,
          numImages: args.numImages,
          seed: args.seed,
          references: buildReferences({ images: args.referenceImages }),
          // Mode (Flux pro/flex, Kontext pro/max) rides the model-agnostic
          // parameters passthrough, which the server reads for variant + pricing.
          parameters: args.mode ? { mode: args.mode } : undefined,
        })
        if (args.getCost) return costResult(await getClient().estimateCost(request))
        const gen = await getClient().generateAndWait(request, { timeoutMs: SMART_WAIT_MS })
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
    async (args) => {
      try {
        const request = compact<GenerateBoardRequest>({
          boardType: args.boardType,
          prompt: args.prompt,
          referenceImages: args.referenceImages,
          numImages: args.numImages,
          boardName: args.boardName,
        })
        if (args.getCost) return costResult(await getClient().estimateBoardCost(request))
        const gen = await getClient().generateBoardAndWait(request, { timeoutMs: SMART_WAIT_MS })
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
    async (args) => {
      try {
        const klingMultiShot = Array.isArray(args.shots) && args.shots.length > 0
        // multiShot is on for Kling's per-shot mode or WAN's boolean toggle; both
        // ride the model-agnostic `parameters` passthrough into genParams.
        const wantMultiShot = klingMultiShot || args.multiShot === true
        const parameters: Record<string, unknown> = {}
        if (wantMultiShot) parameters.multiShot = true
        if (klingMultiShot) parameters.shots = args.shots
        const request = compact<GenerateRequest>({
          contentType: 'video',
          modelId: args.modelId,
          // Multi-shot puts per-shot prompts in `shots`, but some models (Kling 3.0)
          // still require a top-level prompt to pass validation; the provider drops
          // it in multi-shot, so a synthesized summary is harmless when none is given.
          prompt: klingMultiShot ? args.prompt ?? args.shots!.map((s) => s.prompt).join(' ') : args.prompt,
          aspectRatio: args.aspectRatio,
          resolution: args.resolution,
          // Kling's per-shot total drives duration validation + pricing; the provider
          // recomputes the per-shot timeline from `shots`. WAN multi-shot keeps the
          // single duration field.
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
          }),
        })
        if (args.getCost) return costResult(await getClient().estimateCost(request))
        const gen = await getClient().generateAndWait(request, { timeoutMs: SMART_WAIT_MS })
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
    async (args) => {
      try {
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
        if (args.getCost) return costResult(await getClient().estimateCost(request))
        const result = await getClient().generate(request)
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
    async (args) => {
      try {
        const isVideo = models.upscaleContentType[args.modelId] === 'video'
        const request = compact<GenerateRequest>({
          contentType: isVideo ? 'video' : 'image',
          modelId: args.modelId,
          upscaleFactor: args.factor,
          duration: isVideo ? args.durationSeconds : undefined,
          references: isVideo ? { videos: [args.sourceUrl] } : { images: [args.sourceUrl] },
        })
        if (args.getCost) return costResult(await getClient().estimateCost(request))
        const gen = await getClient().generateAndWait(request, { timeoutMs: SMART_WAIT_MS })
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
    async (args) => {
      try {
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
        if (args.getCost) return costResult(await getClient().estimateCost(request))
        const gen = await getClient().generateAndWait(request, { timeoutMs: SMART_WAIT_MS })
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
    async (args) => {
      try {
        const t = await getClient().transcribe({
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
      description:
        "List the account's avatars. Each avatar has an imageUrl (its base look) and a defaultVoiceId, which feed generate_lip_sync. Call get_avatar for full detail and the avatar's looks.",
    },
    async () => {
      try {
        return avatarListResult(await getClient().listAvatars())
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
      description:
        'Get one avatar by id: its base image (use as generate_lip_sync imageUrl), default voice, traits, and its looks (outfit variations).',
      inputSchema: {
        avatarId: z.string().describe('The avatar id from list_avatars.'),
      },
    },
    async (args) => {
      try {
        return avatarResult(await getClient().getAvatar(args.avatarId))
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
      description:
        "List the account's saved voices (favorites first). Each has a voiceId for generate_lip_sync / generate_audio (TTS). Call get_voice for full detail.",
    },
    async () => {
      try {
        return voiceListResult(await getClient().listVoices())
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
      description: 'Get one voice by its voiceId: provider, traits (accent/language/gender/age), description, and a preview URL.',
      inputSchema: {
        voiceId: z.string().describe('The voice id from list_voices.'),
      },
    },
    async (args) => {
      try {
        return voiceResult(await getClient().getVoice(args.voiceId))
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
      description:
        "List the account's brand kits (default first). Call get_brand_kit for one kit's full brand context (voice, visual identity, audience, sections, accounts, knowledge) to write on-brand content.",
    },
    async () => {
      try {
        return brandKitListResult(await getClient().listBrandKits())
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
      description:
        'Get one brand kit in full: business overview, positioning, audience, voice profile, visual identity (logos/colors/typography), curated sections, linked brand + inspiration accounts, and a knowledge-base summary. Use it to ground on-brand generation.',
      inputSchema: {
        brandKitId: z.string().describe('The brand kit id from list_brand_kits.'),
      },
    },
    async (args) => {
      try {
        return brandKitResult(await getClient().getBrandKit(args.brandKitId))
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
      description:
        "List the account's recent studio outputs (generated images, videos, audio, transcripts), newest first. Reference boards are included too; filter with kind='board' (or 'creation'/'look'). Each item has an id and its variation URLs. Call get_media for one output's full detail and individual variations.",
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
        limit: z.number().int().min(1).max(100).optional().describe('How many to return (default 20).'),
      },
    },
    async (args) => {
      try {
        return mediaListResult(
          await getClient().listMedia({
            contentType: args.contentType,
            kind: args.kind,
            status: args.status,
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
      description:
        'Get one studio output by id: its variations (URLs), prompt/script, model, and specs. The id may be the full output id, its first 8 characters, or either with a "-N" suffix to address one variation (1-based, e.g. "...abcd-2"). A whole-output id returns all variations.',
      inputSchema: {
        id: z
          .string()
          .describe('The output id (full or first-8), optionally with a "-N" variation suffix.'),
      },
    },
    async (args) => {
      try {
        return mediaResult(await getClient().getMedia(args.id))
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- get_generation_status -----------------------------------------------------
  server.registerTool(
    'get_generation_status',
    {
      title: 'Get Generation Status',
      description:
        'Get the current status of an image or video generation by its outputId (returned by generate_image / generate_video when a render is still in progress). Returns the final URLs once complete, otherwise the current status plus a poll_after_seconds hint. For a blocking wait on one or more outputIds, use wait_for_generation.',
      inputSchema: {
        outputId: z.string().describe('The outputId from generate_image or generate_video.'),
      },
    },
    async (args) => {
      try {
        const gen = await getClient().getGeneration(args.outputId)
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
    async (args) => {
      try {
        const blocking = args.wait !== false
        const gens = await Promise.all(
          args.outputIds.map(async (id) => {
            if (!blocking) return getClient().getGeneration(id)
            try {
              return await getClient().waitForGeneration(id, { timeoutMs: SMART_WAIT_MS })
            } catch (err) {
              // Still rendering past the smart-wait window: hand back the current snapshot.
              if (err instanceof GenerationTimeoutError) return getClient().getGeneration(id)
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
    async (args) => {
      try {
        return postListResult(
          await getClient().listPosts({
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
      description:
        "Get one post in full: its fields (title, description, script, notes, status, stage, schedule), plus its publish destinations and attached assets.",
      inputSchema: {
        postId: z.string().describe('The post id from list_posts.'),
      },
    },
    async (args) => {
      try {
        return postResult(await getClient().getPost(args.postId))
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
      description:
        "List the account's pipeline stages, in order. Stages are user-customizable (renamed, reordered, added, removed), so call this to discover the real stages before placing a post; pass a stage's id (most stable), slug, or name to create_post / update_post.",
    },
    async () => {
      try {
        return pipelineStageListResult(await getClient().listPipelineStages())
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
      description:
        "Create a content-pipeline post. The post is the container; attach platforms with add_post_destination and media with add_post_asset, then schedule_post or publish_post. `stage` accepts a stage id/slug/name (defaults to the first stage). Requires a key with the pipeline:write scope.",
      inputSchema: {
        title: z.string().describe('Post title (required).'),
        platform: z.enum(POST_PLATFORMS).describe('Primary platform for the post.'),
        description: z.string().optional().describe('Optional description / caption draft.'),
        stage: z.string().optional().describe('Pipeline stage id, slug, or name. Defaults to the first stage.'),
      },
    },
    async (args) => {
      try {
        return postSummaryResult(
          await getClient().createPost({
            title: args.title,
            platform: args.platform,
            description: args.description,
            stage: args.stage,
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
      description:
        'Update a post\'s fields: title, description, script, notes, status, platform, or pipeline stage (move it through the pipeline by passing `stage`). Requires the pipeline:write scope.',
      inputSchema: {
        postId: z.string().describe('The post id.'),
        title: z.string().optional(),
        description: z.string().optional(),
        platform: z.enum(POST_PLATFORMS).optional(),
        status: z.enum(['draft', 'active', 'completed', 'archived']).optional(),
        stage: z.string().optional().describe('Move the post to this stage (id, slug, or name).'),
        script: z.string().optional(),
        notes: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const { postId, ...input } = args
        return postSummaryResult(await getClient().updatePost(postId, input), 'Updated')
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  // -- archive_post ---------------------------------------------------------
  server.registerTool(
    'archive_post',
    {
      title: 'Archive Post',
      description:
        'Archive a post (sets status to archived; reversible by updating the status back). ContentHero never hard-deletes. Requires the pipeline:write scope.',
      inputSchema: {
        postId: z.string().describe('The post id to archive.'),
      },
    },
    async (args) => {
      try {
        return postSummaryResult(await getClient().archivePost(args.postId), 'Archived')
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
      description:
        "Attach a publish destination (one platform) to a post, or replace the existing one for that platform. Set connectedAccountId (from list_connected_accounts, web-only today) to make it publishable. Requires the pipeline:write scope.",
      inputSchema: {
        postId: z.string().describe('The post id.'),
        platform: z.enum(POST_PLATFORMS).describe('Destination platform.'),
        format: z.string().optional().describe("Platform format, e.g. 'post', 'reel', 'story', 'short', 'thread'."),
        connectedAccountId: z.string().optional().describe('The connected account to publish through.'),
        scheduledAt: z.string().optional().describe('ISO-8601 scheduled time for this destination.'),
      },
    },
    async (args) => {
      try {
        return destinationResult(
          await getClient().addPostDestination(args.postId, {
            platform: args.platform,
            format: args.format,
            connectedAccountId: args.connectedAccountId,
            scheduledAt: args.scheduledAt,
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
      description:
        'Update one of a post\'s destinations (format, connected account, scheduled time, or status). Requires the pipeline:write scope.',
      inputSchema: {
        postId: z.string().describe('The post id.'),
        destinationId: z.string().describe('The destination id (from get_post).'),
        format: z.string().optional(),
        connectedAccountId: z.string().optional(),
        scheduledAt: z.string().optional().describe('ISO-8601 scheduled time, or empty to clear.'),
        status: z.string().optional(),
      },
    },
    async (args) => {
      try {
        return destinationResult(
          await getClient().updatePostDestination(args.postId, args.destinationId, {
            format: args.format,
            connectedAccountId: args.connectedAccountId,
            scheduledAt: args.scheduledAt,
            status: args.status,
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
      description:
        "Attach an asset to a post by URL (e.g. a generated image/video URL from get_media, or any public link). Sets the post cover from the first image. Requires the assets:write scope.",
      inputSchema: {
        postId: z.string().describe('The post id.'),
        assetType: z.enum(['image', 'video', 'audio', 'document', 'link']).describe('The kind of asset.'),
        assetUrl: z.string().describe('Public URL of the asset.'),
        displayName: z.string().optional().describe('Optional display name.'),
      },
    },
    async (args) => {
      try {
        return assetResult(
          await getClient().addPostAsset(args.postId, {
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

  // -- schedule_post --------------------------------------------------------
  server.registerTool(
    'schedule_post',
    {
      title: 'Schedule Post',
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
    async (args) => {
      try {
        return postSummaryResult(await getClient().schedulePost(args.postId, args.scheduledAt), 'Scheduled')
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
      description:
        "Publish a post NOW to its destinations (a single platform when `platform` is given, otherwise all). Each destination must have a connected account. Requires a key with the publish:write scope; holding that scope is the account owner's consent to autonomous publishing. Returns per-destination results.",
      inputSchema: {
        postId: z.string().describe('The post id to publish.'),
        platform: z.enum(POST_PLATFORMS).optional().describe('Publish only this platform. Omit to publish all destinations.'),
      },
    },
    async (args) => {
      try {
        return publishResult(await getClient().publishPost(args.postId, { platform: args.platform }))
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
      description:
        "List the creators/competitors the account tracks for inspiration. Use these as grounding for research; call list_outliers for their top content or get_inspiration_account for one account's detail.",
    },
    async () => {
      try {
        return trackedAccountListResult(await getClient().listInspirationAccounts(), 'inspiration account(s)')
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
      description:
        "Get one tracked inspiration account with its content count and a few top outliers (by score). Use it to study a specific creator.",
      inputSchema: {
        accountId: z.string().describe('The account id from list_inspiration_accounts.'),
      },
    },
    async (args) => {
      try {
        const detail = await getClient().getInspirationAccount(args.accountId)
        return inspirationAccountResult(detail)
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
      description:
        "List top-performing content (outliers) from the creators the account tracks, ranked by outlier score (how far a post overperformed its creator's baseline). Filter by platform, content type, minimum score, or a text search. Call get_inspiration_content for one item's full detail incl. transcript. This is the core research read for finding what's working.",
      inputSchema: {
        platform: z.enum(['youtube', 'instagram']).optional().describe('Filter to one platform.'),
        contentType: z.string().optional().describe("Filter by content type, e.g. 'video', 'short', 'reel'."),
        minOutlierScore: z.number().optional().describe('Only content at or above this outlier score.'),
        search: z.string().optional().describe('Text search across title, creator, handle, and description.'),
        sortBy: z.enum(['score', 'date', 'views']).optional().describe("Sort order (default 'score')."),
        limit: z.number().int().min(1).max(100).optional().describe('How many to return (default 20).'),
        offset: z.number().int().min(0).optional().describe('Pagination offset.'),
      },
    },
    async (args) => {
      try {
        return outlierListResult(
          await getClient().listOutliers({
            platform: args.platform,
            contentType: args.contentType,
            minOutlierScore: args.minOutlierScore,
            search: args.search,
            sortBy: args.sortBy,
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
      description:
        "Get one tracked-content item in full: engagement stats, outlier score, hashtags, and the transcript when available. Use it to study exactly what a high-performing post says and does.",
      inputSchema: {
        contentId: z.string().describe('The content id from list_outliers or get_inspiration_account.'),
      },
    },
    async (args) => {
      try {
        return inspirationContentResult(await getClient().getInspirationContent(args.contentId))
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
      description:
        "List the account owner's OWN connected social accounts that ContentHero tracks for performance (distinct from list_brand_kits, which are the brand identity documents). Call get_brand_account_performance for one account's stats.",
    },
    async () => {
      try {
        return trackedAccountListResult(await getClient().listBrandAccounts(), 'brand account(s)')
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
      description:
        "Get the performance summary for one of the owner's brand accounts: content count, total and average views/likes/comments, average engagement and outlier score, plus top and recent content. Use it to ground decisions in how the owner's own content actually performs.",
      inputSchema: {
        accountId: z.string().describe('The account id from list_brand_accounts.'),
      },
    },
    async (args) => {
      try {
        return brandPerformanceResult(await getClient().getBrandAccountPerformance(args.accountId))
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
      description: 'Get the current ContentHero credit balance, subscription tier, and auto-top-up state.',
    },
    async () => {
      try {
        const balance = await getClient().getBalance()
        return balanceResult(balance)
      } catch (err) {
        return errorResult(err)
      }
    },
  )

  return server
}
