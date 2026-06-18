/**
 * Per-tool model lists, resolved dynamically from the discovery endpoint.
 *
 * `resolveModelEnums` fetches `GET /api/v1/models` (via the SDK) once at server
 * startup and groups the enabled models into the three generate tools by their
 * registry `kind`. So the model a tool offers always tracks the admin
 * switchboard: enable a model in the app and it appears here on the next restart,
 * with no package change. The hardcoded `*_FALLBACK` lists below are used only
 * when discovery is unreachable (no key yet, or a network error), so the server
 * still starts and advertises a sensible default surface.
 *
 * Grouping (v1 generate-tool scope):
 *   - image: contentType=image, kind=generate (upscalers are kind=upscale)
 *   - video: contentType=video, kind=generate (excludes upscale + lip-sync)
 *   - audio: contentType=audio, kind=generate, outputType=audio (TTS/music/sfx;
 *            excludes transcribe, which outputs text, and the voice utilities)
 *   - upscale: kind=upscale (image or video), surfaced as the dedicated `upscale`
 *            tool rather than mixed into the generate tools
 *   - lipSync: kind=lip-sync (Wavespeed talking-head), surfaced as the dedicated
 *            `generate_lip_sync` tool (a portrait + audio/script, not prompt-led)
 */

import type { ContentHero } from '@contenthero/sdk'

/** Fallback image-generation models (used only if discovery is unreachable). */
export const IMAGE_MODELS_FALLBACK = [
  'nano-banana-2',
  'nano-banana',
  'nano-banana-pro',
  'seedream-5-lite',
  'gpt-image-2',
  'flux-2-pro',
  'flux-1-kontext',
] as const

/** Fallback video-generation models (used only if discovery is unreachable). */
export const VIDEO_MODELS_FALLBACK = [
  'veo-3.1-fast',
  'veo-3.1-quality',
  'seedance-2',
  'seedance-2-fast',
  'kling-3.0',
  'kling-2.6',
  'kling-3.0-motion-control',
  'kling-2.6-motion-control',
  'wan-2.6',
] as const

/** Fallback audio-generation models (used only if discovery is unreachable). */
export const AUDIO_MODELS_FALLBACK = [
  'elevenlabs-tts',
  'elevenlabs-music',
  'elevenlabs-sound-effects',
] as const

/** Fallback upscale models (used only if discovery is unreachable). */
export const UPSCALE_MODELS_FALLBACK = ['topaz-image-upscale', 'topaz-video-upscale'] as const

/** Fallback lip-sync models (used only if discovery is unreachable). */
export const LIP_SYNC_MODELS_FALLBACK = ['infinitalk', 'infinitalk-fast', 'kling-ai-avatar'] as const

/** Source media kind per upscale model (used to route the source URL + duration). */
const UPSCALE_CONTENT_TYPE_FALLBACK: Record<string, 'image' | 'video'> = {
  'topaz-image-upscale': 'image',
  'topaz-video-upscale': 'video',
}

/** A non-empty model-id tuple, the shape `z.enum` requires. */
export type ModelEnum = [string, ...string[]]

export interface ResolvedModelEnums {
  image: ModelEnum
  video: ModelEnum
  audio: ModelEnum
  upscale: ModelEnum
  lipSync: ModelEnum
  /** Maps each upscale modelId to its source media kind (image vs video). */
  upscaleContentType: Record<string, 'image' | 'video'>
}

function nonEmpty(ids: string[], fallback: readonly string[]): ModelEnum {
  return (ids.length > 0 ? ids : [...fallback]) as ModelEnum
}

/**
 * The static fallback enums, with no discovery call. Used by hosts that resolve
 * tool schemas without a single user API key (e.g. the hosted OAuth MCP, where
 * there is no one user at registration time). The npm/stdio server still resolves
 * the live catalog via `resolveModelEnums`.
 */
export function fallbackModelEnums(): ResolvedModelEnums {
  return {
    image: [...IMAGE_MODELS_FALLBACK],
    video: [...VIDEO_MODELS_FALLBACK],
    audio: [...AUDIO_MODELS_FALLBACK],
    upscale: [...UPSCALE_MODELS_FALLBACK],
    lipSync: [...LIP_SYNC_MODELS_FALLBACK],
    upscaleContentType: { ...UPSCALE_CONTENT_TYPE_FALLBACK },
  }
}

/**
 * Build the three per-tool model enums from the live discovery catalog, falling
 * back to the static lists on any failure (missing key, network error, empty
 * result). Never throws: the server must always start.
 */
export async function resolveModelEnums(getClient: () => ContentHero): Promise<ResolvedModelEnums> {
  try {
    const models = await getClient().listModels()
    const image = models
      .filter((m) => m.contentType === 'image' && m.kind === 'generate')
      .map((m) => m.modelId)
    const video = models
      .filter((m) => m.contentType === 'video' && m.kind === 'generate')
      .map((m) => m.modelId)
    const audio = models
      .filter(
        (m) =>
          m.contentType === 'audio' &&
          m.kind === 'generate' &&
          m.capabilities?.outputType === 'audio',
      )
      .map((m) => m.modelId)
    const upscaleModels = models.filter((m) => m.kind === 'upscale')
    const upscale = upscaleModels.map((m) => m.modelId)
    const upscaleContentType: Record<string, 'image' | 'video'> = {}
    for (const m of upscaleModels) {
      upscaleContentType[m.modelId] = m.contentType === 'video' ? 'video' : 'image'
    }
    const lipSync = models.filter((m) => m.kind === 'lip-sync').map((m) => m.modelId)
    return {
      image: nonEmpty(image, IMAGE_MODELS_FALLBACK),
      video: nonEmpty(video, VIDEO_MODELS_FALLBACK),
      audio: nonEmpty(audio, AUDIO_MODELS_FALLBACK),
      upscale: nonEmpty(upscale, UPSCALE_MODELS_FALLBACK),
      lipSync: nonEmpty(lipSync, LIP_SYNC_MODELS_FALLBACK),
      upscaleContentType:
        upscale.length > 0 ? upscaleContentType : { ...UPSCALE_CONTENT_TYPE_FALLBACK },
    }
  } catch {
    return {
      image: [...IMAGE_MODELS_FALLBACK],
      video: [...VIDEO_MODELS_FALLBACK],
      audio: [...AUDIO_MODELS_FALLBACK],
      upscale: [...UPSCALE_MODELS_FALLBACK],
      lipSync: [...LIP_SYNC_MODELS_FALLBACK],
      upscaleContentType: { ...UPSCALE_CONTENT_TYPE_FALLBACK },
    }
  }
}

/**
 * The nine Reference Board types. Unlike the model roster (resolved dynamically
 * from the discovery catalog), board types are a fixed product taxonomy with no
 * discovery endpoint, so they are enumerated here. Keep in sync with the app's
 * lib/studio/reference-boards/templates.ts BOARD_TYPES.
 */
export const BOARD_TYPES = [
  'character',
  'pose',
  'mascot',
  'creature',
  'weapon',
  'vehicle',
  'object',
  'location',
  'shot',
] as const

/** Short selection guidance baked into the generate_board boardType description. */
export const BOARD_TYPE_GUIDANCE =
  'character = a person or figure. pose = a pose / action sheet. mascot = a brand mascot. creature = a creature or animal. weapon = a weapon. vehicle = a vehicle. object = a prop or object. location = an environment. shot = a multi-shot storyboard in one image.'

/** Short selection guidance baked into each generate tool's modelId description. */
export const IMAGE_MODEL_GUIDANCE =
  'nano-banana-2 = strong general default (1K/2K/4K). gpt-image-2 = best text rendering (resolution 1K/2K/4K, no quality param). flux-2-pro (mode pro|flex) / seedream-5-lite / nano-banana-pro = alternatives. flux-1-kontext (mode pro|max) = edit/recreate. Pass referenceImages for image-to-image / editing; pass mode for flux models.'

export const VIDEO_MODEL_GUIDANCE =
  'veo-3.1-fast / veo-3.1-quality = high quality clips with audio. seedance-2 / seedance-2-fast = multimodal references; startFrame(+endFrame) = frame mode, referenceImages/Videos/Audio = references mode. kling-3.0 (per-shot via shots) / kling-2.6 = strong motion. wan-2.6 (multiShot for multi-shot mode) = alternative. The motion-control variants require an input image plus an input video.'

export const AUDIO_MODEL_GUIDANCE =
  'elevenlabs-tts = text to speech (needs text + voiceId). elevenlabs-music = music from a prompt. elevenlabs-sound-effects = a sound effect from a prompt.'

export const UPSCALE_MODEL_GUIDANCE =
  'topaz-image-upscale = upscale an image (source must be an image URL). topaz-video-upscale = upscale a video (source must be a video URL; also pass durationSeconds).'

export const LIP_SYNC_MODEL_GUIDANCE =
  'infinitalk = talking-head lip-sync (480p/720p). infinitalk-fast = faster, cheaper. kling-ai-avatar = Kling avatar (720p/1080p). All take a portrait image plus either an audio clip or a script + voiceId.'
