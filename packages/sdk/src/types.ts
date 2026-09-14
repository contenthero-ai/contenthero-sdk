/**
 * Public request/response types for the ContentHero SDK.
 *
 * These mirror the server contract in the ContentHero app
 * (lib/studio/v1-request.ts and the /api/v1 route responses). The request is a
 * thin envelope: a typed core of universal fields, a `references` object, and a
 * model-specific `parameters` passthrough for the long tail. Per-model
 * capabilities (which models accept which fields) are validated server-side
 * against the same registry that drives the Studio UI.
 */

/**
 * Reference inputs (image-to-image, video-to-video, frame conditioning).
 *
 * Every value may be either a media URL OR one of your own output ids, so you
 * can chain generations: pass a previous generation's id and the server
 * substitutes that output's URL (ownership-checked). The id may be the full
 * output id, its first 8 characters, or either with a `-N` variation suffix
 * (1-based), e.g. `"a1b2c3d4-2"`. Without a suffix the first variation is used.
 */
export interface References {
  /** Image references / image-to-image inputs (URL or output id). */
  images?: string[]
  /** Video references, e.g. video-to-video models (URL or output id). */
  videos?: string[]
  /** Audio references, e.g. lip-sync custom audio input (URL or output id). */
  audio?: string[]
  /** First frame for video models that accept one (URL or output id). */
  startFrame?: string
  /** Last frame for video models that accept one (URL or output id). */
  endFrame?: string
  /**
   * Named reference elements (Kling 3.0), each addressable in the prompt as
   * @name. Requires a startFrame alongside them. See get_model's promptReferences
   * for which models support elements.
   */
  elements?: ReferenceElement[]
}

/**
 * A named group of reference images, addressable in the prompt as @name (Kling
 * 3.0). Provide EITHER a saved element by `elementId`, OR define one inline with
 * `name` + `images`.
 */
export interface ReferenceElement {
  /** Reference a saved element-library entry by id (resolves to its name + images). */
  elementId?: string
  /** Inline: referenced in the prompt as @name. */
  name?: string
  /** Inline: what the element represents (passed to the provider for conditioning). */
  description?: string
  /** Inline: supporting image URLs or output-id tokens for this element. */
  images?: string[]
}

/** A saved reference element in the account's library (the persistent form). */
export interface Element {
  id: string
  name: string
  /** 'auto' | 'character' | 'location' | 'prop'. */
  category: string
  description: string | null
  /** The element's supporting image URLs. */
  input_urls: string[]
  /** A single supporting video URL (alternative to images), if any. */
  input_video_url: string | null
  /** A representative image/video URL for previews. */
  preview_url: string
  created_at: string
}

/** Create an element from 2-4 images (or 1 video). Inputs may be URLs or output-id tokens. */
export interface CreateElementRequest {
  name: string
  description: string
  /** 'auto' | 'character' | 'location' | 'prop' (default 'auto'). */
  category?: string
  /** 2-4 image URLs or output-id tokens (one of images/video is required). */
  images?: string[]
  /** A single video URL or output-id token (alternative to images). */
  video?: string
}

/**
 * A generation request. `modelId` is always required. For image/video the
 * `prompt` and typed-core fields apply; for audio (ElevenLabs) the audio fields
 * apply. Anything a specific model supports beyond the typed core can be passed
 * through `parameters`.
 */
export interface GenerateRequest {
  /** Media kind. Optional: inferred from the model when omitted. */
  contentType?: 'image' | 'video' | 'audio'
  /** Model identifier, e.g. 'nano-banana-2'. Required. */
  modelId: string
  /** Text prompt. Required for image/video and for music/sfx audio. */
  prompt?: string

  // Typed core (image / video)
  aspectRatio?: string
  resolution?: string
  /** Quality mode for models that expose it separately (e.g. GPT Image). */
  quality?: string
  /** Number of images to produce (image models). */
  numImages?: number
  /** Number of variations to produce (video models). */
  numGenerations?: number
  /** Clip duration in seconds (video models). */
  duration?: number
  /** Enable generated audio on video models that support it. */
  audioEnabled?: boolean
  negativePrompt?: string
  seed?: number
  /** Upscale factor for upscale models, e.g. "2x", "4x" (validated per model). */
  upscaleFactor?: string
  references?: References

  /** Model-specific parameters passed through to the provider (long tail). */
  parameters?: Record<string, unknown>

  // Audio (ElevenLabs)
  /** Text to speak (text-to-speech). */
  text?: string
  /** ElevenLabs voice id (text-to-speech). */
  voiceId?: string
  /** Human-readable voice name, stored for display (text-to-speech). */
  voiceName?: string
  /** Duration in seconds (music / sound effects). */
  durationSeconds?: number
  /** How literally to follow the prompt, 0.0 to 1.0 (sound effects). */
  promptInfluence?: number

  /**
   * Optional client-chosen id for idempotency. Must be a UUID; it becomes the
   * generation's id. Re-submitting with the same id returns the existing job
   * instead of starting (and charging for) another, so retries are safe. You
   * also know the id up front and can poll `getGeneration` immediately.
   */
  outputId?: string

  /** Optional: place the generated asset onto this editor project's timeline in the same call. Omit for a
   *  standalone library output. Sync models (audio) place immediately; async models (image/video) place when
   *  the output finalizes. */
  projectId?: string

  /**
   * Optional: file the generated image onto this avatar as a new LOOK rather than as a standalone library
   * output. Image models only.
   *
   * A look is one appearance of a reusable character: same person, different outfit, setting or framing.
   * Generating into one directly is how an agent builds out an avatar without a human attaching the result
   * afterwards. Use an id from `listAvatars`.
   *
   * ⚠️ The avatar must be one you own; the server rejects an id that is not, because an id in a request body
   * is an argument the caller chose and not a claim about who they are.
   */
  avatarId?: string
  /** Optional placement intent; omitted = playhead when `playheadFrame` is given, else append at the end. */
  placement?: PlacementIntent
  /** Optional interactive-fallback playhead frame (echo one from get_context for playhead-relative placement). */
  playheadFrame?: number
}

/** The nine Reference Board types. */
export type BoardType =
  | 'character'
  | 'pose'
  | 'mascot'
  | 'creature'
  | 'weapon'
  | 'vehicle'
  | 'object'
  | 'location'
  | 'shot'

/**
 * A Reference Board generation request. A board is a dense multi-panel reference
 * sheet built from a source image and/or a written description, on a fixed
 * pipeline (3:4 / 4K). Provide at least one of `referenceImages` or `prompt`.
 */
export interface GenerateBoardRequest {
  /** One of the nine board types. Required. */
  boardType: BoardType
  /**
   * Freeform description / context. The source image leads when both are given;
   * required when no `referenceImages` are provided (text-only boards).
   */
  prompt?: string
  /**
   * Image references the board is built from: each a URL or one of your own
   * output ids (e.g. "<id>" or "<id>-2") to chain from an earlier generation.
   */
  referenceImages?: string[]
  /** Number of variations to produce (1-4). Defaults to 1. */
  numImages?: number
  /** Optional user-facing board name. */
  boardName?: string
  /** Optional avatar id to associate the board with. */
  avatarId?: string
  /**
   * Optional client-chosen id for idempotency. Must be a UUID; it becomes the
   * board's id. Re-submitting with the same id returns the existing job.
   */
  outputId?: string
}

/** Lifecycle state of a generation. */
export type GenerationStatus = 'pending' | 'processing' | 'completed' | 'failed'

/**
 * Result of submitting a generation. Image/video return `status: 'processing'`
 * (poll with `getGeneration`, or use `generateAndWait`). Audio is synchronous
 * and returns `status: 'completed'` with `outputUrls` already populated.
 */
export interface GenerateResult {
  outputId: string
  status: 'processing' | 'completed'
  /** Estimated credit cost computed server-side. */
  creditsEstimate?: number
  /** Present when the result is already complete (audio). */
  outputUrls?: string[]
  /** True when a client-supplied `outputId` matched an existing job (no new work was started). */
  idempotentReplay?: boolean
  /** Where the asset is being placed (present only when `projectId` was supplied). Lets a caller chain further
   *  ops onto the placed clip/layer without a get_context hop, and see any placement warnings. */
  placement?: PlacementResult
}

/** The outcome of a one-call placement (present on a generate result when `projectId` was supplied). The ids are
 *  known at submit time (deterministic), so they are usable for chaining before the async asset finishes. */
export interface PlacementResult {
  /** True while the async placement completes at finalize (image/video); absent for a synchronous audio place. */
  pending?: boolean
  projectId: string
  /** The placed clip / layer id (deterministic). Chain further ops (animate, reposition, reorder) onto it. */
  itemId?: string
  /** 'canvas' when placed as a layer on a slide, 'editor' when placed as a clip on a track. Mirrors
   *  `project.kind` exactly, rather than renaming it. */
  surface?: 'canvas' | 'editor'
  /** Canvas only: the placed layer id (same as itemId) and the resolved target slide. */
  layerId?: string
  slideId?: string
  /** Non-fatal placement notes (e.g. an ambiguous slide fallback). */
  warnings?: string[]
}

/**
 * Result of a get_cost preflight (`estimateCost` / `estimateBoardCost`): the credit
 * estimate only, with no generation run and nothing charged. It equals what the real
 * generate would charge; audio covered by a BYO ElevenLabs key estimates 0.
 */
export interface CostEstimate {
  creditsEstimate: number
  /** Always true on a cost-preview response. */
  getCost: true
  modelId?: string
  contentType?: 'image' | 'video' | 'audio'
}

/**
 * Request for `editAudio`: transform an existing audio file into a new one with
 * an audio-processing model (audio input -> audio output), e.g. voice isolation.
 * The sibling of `generate` for the existing-audio -> audio shape.
 */
/**
 * Where a generated/processed clip lands on an editor project's timeline. All positional fields are in
 * SECONDS (resolved to frames server-side via the project fps). Omitted intent = the playhead when a
 * `playheadFrame` is supplied, else append at the end of the timeline.
 */
export type PlacementIntent = TimelinePlacementIntent | CanvasPlacementIntent

/** Placement onto a VIDEO timeline: a clip on a track at a time. */
export type TimelinePlacementIntent =
  /** Land after the last clip on the best track of the clip's kind, or on a freshly spawned track. */
  | { mode: 'append' }
  /** Land at an explicit time. `track` selects the track: a track id, 'overlay' (a non-primary track, reused
   *  or spawned), or 'primary' (the main track, media only); omitted uses the default track. `durationSeconds`
   *  sets an IMAGE point clip's length (ignored for video/audio). */
  | { mode: 'at'; startSeconds?: number; track?: string; durationSeconds?: number }
  /** Land at the current playhead (the interactive fallback). `durationSeconds` sets an IMAGE point clip's length. */
  | { mode: 'atPlayhead'; durationSeconds?: number }
  /** Swap in place for an existing clip; the new clip inherits its track + start. `duration` keeps the new
   *  clip's own length and ripples ('natural', default) or trims it to the replaced slot ('match'). */
  | { mode: 'replace'; itemId: string; duration?: 'natural' | 'match' }
  /** Fill or cover a time span. `track` selects the track (id / 'overlay' / 'primary'); omitted uses the default. */
  | { mode: 'range'; startSeconds?: number; endSeconds?: number; track?: string; fit?: 'cover' | 'trim' | 'overwrite' }

/** Placement onto a CANVAS design: a layer on a slide at a position + size (6A A8). Flat (no `mode`); all fields
 *  optional. Positions/sizes are design pixels. Omitting `slideId`/`slideIndex` targets the focused slide. */
export interface CanvasPlacementIntent {
  slideId?: string
  slideIndex?: number
  fit?: 'contain' | 'cover' | 'none'
  anchor?: 'center' | 'top-left' | 'top' | 'top-right' | 'left' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right'
  x?: number
  y?: number
  width?: number
  height?: number
  /** Make the generated asset the slide's background rather than a free layer (placed full-bleed, promoted into
   *  the background slot once it lands). Ignores anchor / x / y / width / height. */
  asBackground?: boolean
}

export interface EditAudioRequest {
  /** The audio-processing model to run. */
  modelId: string
  /**
   * Public URL (or a previous output id) of the source audio to process.
   *
   * Required in FILE mode and must be OMITTED in in-place mode, where the sources come from the clips
   * themselves. The two are mutually exclusive: one produces a new library asset, the other edits a timeline.
   */
  sourceUrl?: string
  /** Source audio length in seconds. Required for a cost estimate; on a real run
   *  it refines the estimate (the authoritative charge is the processed duration). */
  durationSeconds?: number
  /** Optional: place the processed audio onto this editor project's timeline in the same call. Omit for a
   *  standalone library output (today's behavior). */
  projectId?: string
  /** Optional placement intent; omitted = playhead when `playheadFrame` is given, else append at the end. */
  placement?: PlacementIntent
  /** Optional interactive-fallback playhead frame (echo one from get_context for playhead-relative placement). */
  playheadFrame?: number
  /**
   * IN-PLACE mode: enhance the audio OF EXISTING CLIPS on `projectId`, rather than processing a standalone file.
   *
   * Requires `projectId` and `modelId: 'auphonic-enhance'`. Omitting `clipIds` while passing
   * `enhanceClips: true` means every audible clip on the timeline, the same whole-timeline default the sibling
   * timeline ops use. Silenced clips are excluded automatically; enhancing audio nobody can hear would spend
   * credits and then overwrite something the user deliberately muted.
   *
   * ⚠️ RETURNS A LIST on `outputs`. Auphonic estimates a noise profile and picks a loudness target per
   * PRODUCTION, so one source's clips are concatenated and enhanced as a SINGLE job. Grouping stops at the
   * source because a profile spanning two recordings is an average of two rooms and fits neither, so a
   * selection covering three recordings is three jobs and three outputIds.
   */
  clipIds?: string[]
  /** Opt in to in-place mode without naming clips (whole timeline). Implied when `clipIds` is present. */
  enhanceClips?: boolean
}

/** One in-place enhancement job: the clips of a single source, concatenated and enhanced together. */
export interface EnhanceClipsJob {
  outputId: string
  creditsEstimate?: number
  /** Every clip this job's pieces will be applied to. */
  clipIds: string[]
  /** How many distinct windows were concatenated into this job. */
  windows: number
}

/**
 * The result of `editAudio`, which serves two shapes.
 *
 * FILE mode returns the `GenerateResult` fields. IN-PLACE mode returns `outputs`, one per source, and echoes
 * the first on `outputId` so a single-source project can be awaited without unpacking the list. `status` is
 * `'noop'` when the selection contained no audible audio, which is deliberately distinguishable from a failure.
 */
export interface EditAudioResult extends Omit<GenerateResult, 'status'> {
  status: 'processing' | 'completed' | 'noop'
  /** In-place mode only: one job per source. */
  outputs?: EnhanceClipsJob[]
  /** In-place mode only: the project the pieces are applied to. */
  projectId?: string
  /** In-place mode only: selected clips skipped because they are silenced. */
  silencedClipsExcluded?: number
  /** Present with `status: 'noop'`, explaining why nothing ran. */
  note?: string
}

/** A generation record as returned by `getGeneration` and `generateAndWait`. */
export interface Generation {
  outputId: string
  status: GenerationStatus
  contentType: 'image' | 'video' | 'audio'
  modelId: string
  /** Output asset URLs. Empty until the generation completes. */
  outputUrls: string[]
  /** Error detail when `status` is 'failed', otherwise null. */
  error: string | null
  createdAt: string
  completedAt: string | null
  /** The terminal signal to await when a generation carries a project PLACEMENT (a fresh asset placed on a canvas
   *  / timeline, or an in-place background removal): true once the output exists AND its placement side-effect
   *  (the placeholder->asset swap, the cutout, a background promotion) has been applied to the project. `status`
   *  flips to 'completed' when the asset exists and billing settles, which can precede the swap; `waitForGeneration`
   *  keys on `settled` so "done" always implies the visible composition change is in. Absent (older servers) is
   *  treated as settled. Outputs with no placement are settled as soon as they complete. */
  settled?: boolean
  /** Where the asset was placed (present only when `projectId` was supplied to generate). Carried from the submit
   *  response through `generateAndWait` so a caller gets the placement outcome alongside the finished asset. */
  placement?: PlacementResult
}

/** Subscription tiers the API normalizes balances against. */
export type SubscriptionTier = 'mortal' | 'hero' | 'champion' | 'legend'

/** Account credit standing as returned by `getBalance`. */
export interface Balance {
  balance: number
  tier: SubscriptionTier
  autoTopupEnabled: boolean
}

/** Options for `generateAndWait`'s polling behavior. */
export interface WaitOptions {
  /** Milliseconds between status polls. Default 3000. */
  pollIntervalMs?: number
  /** Give up after this many milliseconds. Default 600000 (10 minutes). */
  timeoutMs?: number
  /** Abort the wait (does not cancel the server-side job). */
  signal?: AbortSignal
}

/** Request to transcribe an audio URL to text. */
export interface TranscribeRequest {
  /** Public URL of the audio to transcribe. */
  audioUrl: string
  /** Optional ISO language hint (e.g. "en"); auto-detected when omitted. */
  languageCode?: string
  /** Label each speaker (diarization). */
  diarize?: boolean
}

/** Result of transcribing audio. Synchronous (no polling). */
export interface Transcription {
  outputId: string
  transcript: string
  language: string
  wordCount: number
  /** Source audio length in seconds, when known. */
  durationSeconds: number | null
  /**
   * ContentHero credits charged for the run. Zero only when the user's own ElevenLabs
   * key covered it, in which case the provider billed them directly.
   */
  creditsUsed: number
}

/** An avatar as returned by `listAvatars` (the list projection). */
export interface AvatarSummary {
  id: string
  name: string
  /** The avatar's base image (profile photo); the default look for lip-sync. */
  imageUrl: string | null
  defaultVoiceId: string | null
  isDefault: boolean
  status: string
}

/** An outfit/look variation of an avatar. */
export interface AvatarLook {
  id: string
  name: string | null
  imageUrl: string | null
  lookType: string | null
  isDefault: boolean
  isFavorited: boolean
  isArchived: boolean
}

/** Full avatar detail as returned by `getAvatar`. */
export interface Avatar extends AvatarSummary {
  description: string | null
  age: string | null
  gender: string | null
  ethnicity: string | null
  niche: string[]
  createdAt: string | null
  looks: AvatarLook[]
}

/**
 * What `createAvatar` needs.
 *
 * `age` and `gender` are required because the generator writes the portrait prompt from this metadata;
 * without them it has nothing to describe. Everything else sharpens the result.
 */
export interface CreateAvatarRequest {
  /** At least 3 characters. */
  name: string
  age: string
  gender: string
  ethnicity?: string
  niche?: string[]
  /** Visual style hint for the prompt writer. Not stored on the avatar. */
  style?: string
  /** Free-text description of the character. The strongest single input. */
  description?: string
  /** An ElevenLabs voice id from `listVoices`, used as this avatar's default. */
  defaultVoiceId?: string
  /**
   * Photos of a REAL PERSON to anchor identity to, as URLs or previous output ids.
   *
   * ⚠️ These make the avatar a likeness of someone. Only supply photos of a person who has agreed to it.
   * With them the generator runs in edit mode against the identity-locked profile prompt; without them it
   * invents a character from the metadata.
   */
  referenceImageUrls?: string[]
}

/**
 * The result of `createAvatar`.
 *
 * ⚠️ THE AVATAR IS NOT READY YET. It lands at `status: 'processing'` with no image, and becomes usable
 * when its first look finishes generating, which is when its default look and profile photo are set.
 * Poll `getAvatar` until `status` is 'completed'.
 */
export interface CreateAvatarResult {
  avatar: Avatar
  status: string
  message: string
}

/** Fields `updateAvatar` can change. Omitted fields are left alone. */
export interface UpdateAvatarRequest {
  /** At least 3 characters. */
  name?: string
  /**
   * An existing look OF THIS AVATAR, from `getAvatar().looks`. Also becomes the avatar's profile photo,
   * because the two are one fact and setting them apart is how they drift.
   */
  defaultLookId?: string
  /** An ElevenLabs voice id, or null to clear it. */
  defaultVoiceId?: string | null
  /**
   * Look changes to apply in the same call, in order.
   *
   * ⚠️ NOT A TRANSACTION. Ops run before the field updates so `add_look` can create the look that
   * `defaultLookId` then points at, but a failure part-way leaves the earlier ops applied. The result's
   * `applied` array says which ran.
   */
  ops?: AvatarOp[]
}

/** A look change applied through `updateAvatar`. */
export type AvatarOp =
  | {
      op: 'add_look'
      /** Images you already own, as URLs. An image this account does not own is skipped, not an error. */
      imageUrls: string[]
    }
  | { op: 'remove_look'; lookId: string }

/** What `updateAvatar` returns: the avatar, plus a per-op record when `ops` were supplied. */
export interface UpdateAvatarResult {
  avatar: Avatar
  applied?: Array<Record<string, unknown>>
}

/** What `addAvatarLooks` returns. */
export interface AddAvatarLooksResult {
  /** The look rows created, in submission order. */
  looks: Array<Record<string, unknown>>
  /**
   * How many images were skipped because they are not this account's.
   *
   * ⚠️ CHECK THIS. Resolution is owner-scoped, so an unresolvable url is silently dropped rather than
   * failing the call; a non-zero count means you asked for more looks than you got.
   */
  skipped: number
}

/** A voice as returned by `listVoices` (the list projection). */
export interface VoiceSummary {
  voiceId: string
  name: string | null
  provider: string | null
  isFavorited: boolean
  previewUrl: string | null
  lastUsedAt: string | null
}

/** Full voice detail as returned by `getVoice`. */
export interface Voice extends VoiceSummary {
  accent: string | null
  language: string | null
  gender: string | null
  age: string | null
  description: string | null
  useCase: string | null
}

/** Options for `listVoices`. */
export interface ListVoicesOptions {
  /** When true, return only favorited voices. */
  favorited?: boolean
}

/** A brand kit as returned by `listBrandKits` (the list projection). */
export interface BrandKitSummary {
  id: string
  name: string
  businessName: string | null
  nicheDefinition: string | null
  isDefault: boolean
  isActive: boolean
  isFavorited: boolean
  isArchived: boolean
  createdAt: string | null
}

/** Options for `listBrandKits`. */
export interface ListBrandKitsOptions {
  /** When true, return only favorited brand kits. */
  favorited?: boolean
  /** When true, return only archived brand kits (default excludes archived). */
  archived?: boolean
}

/** A brand/inspiration account linked to a brand kit. */
export interface BrandKitAccount {
  /** The tracked-account id; feeds getInspirationAccount / getBrandAccountPerformance. */
  id: string | null
  platform: string | null
  name: string | null
  handle: string | null
  avatarUrl: string | null
  followerCount: number | null
  /** 'brand' or 'inspiration'. */
  accountType: string | null
}

/** A curated section of a brand kit (overview / voice tabs). */
export interface BrandKitSection {
  tab: string
  sectionName: string
  sortOrder: number
  /** Field objects: { key, label, type, value }. */
  fields: unknown[]
}

/** A knowledge-base item (body truncated to a preview), as embedded in `getBrandKit`. */
export interface BrandKitKnowledge {
  id: string
  title: string | null
  sourceType: string | null
  sourceUrl: string | null
  contentPreview: string | null
}

/** A knowledge-base item in the dedicated list/get surface (metadata). */
export interface BrandKnowledgeItem {
  id: string
  title: string | null
  sourceType: string | null
  sourceUrl: string | null
  createdAt: string | null
  updatedAt: string | null
}

/** A knowledge item with its stored body (a capped anchor; use search for depth). */
export interface BrandKnowledgeDetail extends BrandKnowledgeItem {
  content: string | null
}

/** Result of `listBrandKnowledge`: a page of items plus pagination metadata. */
export interface BrandKnowledgeListResult {
  items: BrandKnowledgeItem[]
  total: number
  hasMore: boolean
}

/** One ranked chunk match from `searchBrandKnowledge`. */
export interface BrandKnowledgeMatch {
  /** The parent item id (fetch the whole item with getBrandKnowledge). */
  knowledgeId: string | null
  title: string | null
  /** The matching chunk content. */
  content: string
  similarity: number
  sourceUrl: string | null
  chunkIndex: number | null
}

/** How a knowledge item is ingested. */
export type BrandKnowledgeSourceType = 'text' | 'url' | 'youtube' | 'file'

/** Input for `addBrandKnowledge`. */
export interface AddBrandKnowledgeInput {
  sourceType: BrandKnowledgeSourceType
  /** text source: the note body. */
  text?: string
  /** url / youtube source: the link. */
  url?: string
  /** file source: base64-encoded file bytes (use this OR fileUrl; best for small documents and images). */
  fileData?: string
  /** file source: a hosted URL the server fetches (use this OR fileData; needed for large files and video/audio). */
  fileUrl?: string
  /** file source: the file extension (no dot), e.g. "pdf". Inferred from fileUrl when omitted. */
  fileExt?: string
  /** Optional explicit title (else derived from the content). */
  title?: string
  /** Optional tag ids to attach. */
  tags?: { id: string }[]
}

/** Options for `searchBrandKnowledge`. */
export interface SearchBrandKnowledgeOptions {
  /** Max matches to return (1-50, default 8). */
  limit?: number
  /** Minimum cosine similarity (0-1, default 0.45). */
  threshold?: number
}

/** Full brand kit as returned by `getBrandKit` (the whole document). */
export interface BrandKit extends BrandKitSummary {
  websiteUrl: string | null
  /**
   * Where website extraction has got to: 'idle', 'extracting', 'reviewing', 'complete', 'failed'.
   * This is the polling surface after `createBrandKit({ extract: true })` or `extractBrandKit`.
   */
  extractionStatus?: string | null
  /** The user-facing reason the last extraction failed, when it did. */
  extractionError?: string | null
  sourceType: string | null
  primaryOffer: string | null
  positioning: Record<string, unknown> | null
  audience: Record<string, unknown> | null
  voiceProfile: Record<string, unknown> | null
  logos: unknown[]
  brandColors: unknown[]
  typography: Record<string, unknown> | null
  visualStyle: string | null
  designPrinciples: string[]
  socialAccounts: unknown[]
  contentStrategy: Record<string, unknown> | null
  assets: unknown[]
  sections: BrandKitSection[]
  brandAccounts: BrandKitAccount[]
  inspirationAccounts: BrandKitAccount[]
  knowledge: BrandKitKnowledge[]
}

/** Identity fields writable via `updateBrandKit` (allow-listed server-side). */
export interface UpdateBrandKitInput {
  name?: string
  businessName?: string | null
  websiteUrl?: string | null
  primaryOffer?: string | null
  nicheDefinition?: string | null
  positioning?: Record<string, unknown> | null
  audience?: Record<string, unknown> | null
  voiceProfile?: Record<string, unknown> | null
  visualStyle?: string | null
  designPrinciples?: string[]
  brandColors?: unknown[]
  typography?: Record<string, unknown> | null
  contentStrategy?: Record<string, unknown> | null
  /**
   * Brand media. A patch REPLACES the list, so pass the whole set; `[]` clears it. These are reconciled into
   * `brand_kit_assets` rather than written as columns, which is why they are not simple fields.
   *
   * An entry names its media by `url`, OR by `outputId` to bring in something not in the kit yet: a
   * generation token (`"<id>"`, or `"<id>-2"` for variation 2 of a batch) whose bytes the server COPIES into
   * the kit's own storage. Copied rather than referenced, so trashing the generation later cannot empty the
   * kit. An `outputId` entry is not idempotent (it means "bring this in"), which does not bite in the
   * read-modify-write flow this contract implies, because reads hand back stored urls.
   *
   * Logos also carry `name`, `is_primary`, `layout` and `colorMode`. Exactly one logo ends up primary: it is
   * the kit's cover, so if a list names none, the first wins.
   */
  logos?: unknown[]
  assets?: unknown[]
  /**
   * The kit's curated sections. DECLARATIVE and keyed by (tab, sectionName): pass the whole set, and a
   * section no longer present is ARCHIVED (never deleted). Array position is the default sort order.
   */
  sections?: BrandKitSectionInput[]
  /**
   * Only `true` is meaningful: it makes this the default kit and un-defaults every other one. Passing `false`
   * would leave the account with no default at all, which the brand switcher cannot resolve, so to MOVE the
   * default you name the kit that should hold it.
   */
  isDefault?: boolean
  /**
   * Linked tracked accounts, declarative: pass the whole set and what is absent is unlinked. Undefined leaves
   * a list untouched, `[]` clears it.
   *
   * The two lists mean opposite things and stay separate: `brandAccounts` are the user's OWN profiles,
   * `inspirationAccounts` are competitors and creators they watch.
   *
   * An entry is either an existing tracked-account id, or `{ platform?, handleOrUrl }` to ADD a profile that
   * is not tracked yet. Adding one is what STARTS ingestion: it sets the account pending, and the dispatcher
   * drains pending accounts every 5 minutes. A full profile url carries its own platform, so `platform` is
   * only needed for a bare handle.
   */
  brandAccounts?: BrandKitAccountInput[]
  inspirationAccounts?: BrandKitAccountInput[]
  /** Re-run website extraction after applying this patch. Requires the kit to have a `websiteUrl`. */
  extract?: boolean
}

/** Fields accepted when creating a brand kit. */
export interface CreateBrandKitInput extends UpdateBrandKitInput {
  /** Optional when `websiteUrl` is given: it then defaults to the site's hostname until extraction supplies a real one. */
  name?: string
  /** Caller-minted id, so a create can be made idempotent. Must be a UUID. */
  id?: string
  /** Free-text provenance ('manual', 'wizard', 'mcp', ...). Defaults to 'manual'. */
  sourceType?: string
  /** Start filling the kit from `websiteUrl` immediately. Returns at once; poll `extractionStatus`. */
  extract?: boolean
}

/** What happened to an extraction request. `deduped` means an identical job was already running, not a failure. */
export interface ExtractionOutcome {
  status: 'enqueued' | 'deduped' | 'unconfigured' | 'skipped'
  msgId?: number
  reason?: string
}

/** A brand-kit section record (returned by the section write methods). */
export interface BrandKitSectionRecord {
  id: string
  tab: string
  sectionName: string
  sortOrder: number
  fields: unknown[]
}

/** An account to link: an existing tracked-account id, or a profile to ADD by handle or url. */
export type BrandKitAccountInput = string | { platform?: string; handleOrUrl: string }

/** One curated section on a brand kit. Keyed by (tab, sectionName). */
export interface BrandKitSectionInput {
  tab: string
  sectionName: string
  sortOrder?: number
  /** Curated field objects: { key, label, type, value }. */
  fields?: unknown[]
}

/** A studio output's media kind. */
export type MediaType = 'image' | 'video' | 'audio' | 'transcript'

/**
 * Which library a media read targets. 'creations' = studio generations (with variations);
 * 'uploads' = the editor Uploads tab (the user-level upload library); 'stock' = stock media
 * the user has used (cached and reusable); 'all' = every library merged newest-first, each item
 * self-describing via its `source` (list only; a `get` uses the item's specific source).
 */
export type MediaSource = 'creations' | 'uploads' | 'stock' | 'all'

/** One variation (slot) of a studio output. */
export interface MediaVariation {
  /** 1-based variation number (matches the UI and a share link's ?v=N). */
  variation: number
  url: string | null
  status: string
  isFavorited: boolean
  isArchived: boolean
  /**
   * MEASURED PIXEL GEOMETRY of this slot's image. `content` is the ARTWORK's bounds within the file (its
   * alpha bounds), so a padded logo can be placed and aligned by what is VISIBLE rather than by its file
   * rectangle. Absent until the asset has been measured. The same field appears on a media-batch item, so
   * the CLI and the MCP report identical facts.
   */
  geometry?: {
    width: number
    height: number
    content?: { x: number; y: number; width: number; height: number }
  }
}

/**
 * One atomic library asset as returned by `listMedia`. The grain is a VARIATION (an individual media file),
 * not a whole generation: a studio generation with N variations lists as N items sharing one `id` but with
 * distinct `variant`. The universal identity is (id, variant).
 */
export interface MediaSummary {
  id: string
  type: MediaType
  model: string | null
  prompt: string | null
  status: string
  createdAt: string | null
  /**
   * 0-based canonical slot of this variation (matches a share link's ?v=N as variant+1, and getMedia's
   * `<id>-<N>` token as N = variant+1). Single-asset sources (uploads, stock) are always 0.
   */
  variant: number
  /** This variation's resolved URL (null only in a detail view whose slots have no media yet). */
  url: string | null
  /** Total variations in the parent generation this variation belongs to (1 for uploads/stock). */
  generationSize: number
  /** Whether THIS variation is favorited (studio per-slot; uploads/stock are go-forward, false). */
  isFavorited: boolean
  /** Asset class: 'creation' (default), 'board' (a reference board), or 'look'. */
  kind: string | null
  /** Board type when kind is 'board' (character, weapon, location, etc.); else null. */
  boardType: string | null
  /** Which library this item came from ('creations' | 'uploads' | 'stock'); self-describing. */
  source: MediaSource
  /** Original file name (uploads); null for studio outputs. */
  fileName: string | null
  /** Duration in seconds for a single-file item (uploads video/audio); null otherwise. */
  durationSeconds: number | null
}

/** Full studio output detail as returned by `getMedia`. */
export interface MediaItem extends MediaSummary {
  script: string | null
  aspectRatio: string | null
  resolution: string | null
  duration: number | null
  creditsUsed: number | null
  variations: MediaVariation[]
  /** Set when the requested token addressed a single variation; else null. */
  selectedVariation: number | null
  /** Output-level representative still (video poster / optimized image preview), or null. */
  thumbnailUrl: string | null
}

/**
 * VIDEO keyframe watch (opt-in): set any of these on a video item to get low-res keyframes across the
 * [fromSec, toSec] source-time window (whole clip by default), so you can SEE the footage — the fix for
 * "video returns no frame yet". Frame-based, so cost is decoupled from clip length.
 */
export interface MediaClipWindow {
  fromSec?: number
  toSec?: number
  /** How many keyframes (proportional default; service-capped). */
  frames?: number
}

/** One requested item for `getMediaBatch`: a raw URL, or an output id (+ variation); videos accept a window. */
export type MediaBatchItem = ({ url: string } | { mediaId: string; variation?: number }) & MediaClipWindow

/**
 * One resolved item from `getMediaBatch`, uniform across the url and mediaId
 * paths. `url` is the single thing to fetch (the MCP turns it into an image
 * block); `ok` is false with an `error` when the item could not be resolved.
 */
export interface ResolvedMediaBatchItem {
  ok: boolean
  /** Echo of the requested item, to correlate results with inputs. */
  input: MediaBatchItem
  /** The media itself (image master, or video master). */
  url: string | null
  /**
   * The still image to view for this item: the image itself for images, the
   * poster still for a video's primary variation, null when no still is available
   * (audio, transcript, non-primary video variation, raw video url). The MCP turns
   * this into an image block; SDK/CLI just surface the URL.
   */
  imageUrl: string | null
  type: MediaType | null
  model: string | null
  prompt: string | null
  /** The output id when resolved from a mediaId; null for a raw url. */
  mediaId: string | null
  /** The 1-based variation this url represents (mediaId path), else null. */
  variation: number | null
  /** Sibling variation numbers not returned here (mediaId-without-variation path). */
  otherVariations: number[]
  /**
   * VIDEO keyframes (present only when the item requested a window on a video): low-res frames across the
   * source-time window, each an inline `data:image/jpeg;base64,...`. The MCP turns each into an image block.
   */
  keyframes?: { atSec: number; dataUrl: string }[]
  /**
   * MEASURED PIXEL GEOMETRY from the storage spine. Absent for an asset that is not ours or not yet measured.
   *
   * `content` is the ARTWORK's bounds within the file (its alpha bounds). For a padded logo these differ
   * sharply from the file rectangle, and using the file rectangle is what makes a placed logo look wrong:
   * the true aspect is the artwork's, and aligning the file edge leaves a visible gap the width of the
   * transparent margin. This is the same measurement the editor's selection, snapping and align-to-page use.
   */
  geometry?: {
    width: number
    height: number
    /** Alpha bounds in SOURCE pixels. Equals the full frame for an image with no transparent margin. */
    content?: { x: number; y: number; width: number; height: number }
  }
  /**
   * MEASURED LENGTH in seconds, for anything time-based: video, audio, and whatever comes later.
   *
   * Absent for an asset that is not ours or not yet measured. This was missing entirely for audio, which made
   * `editAudio` uncallable without downloading the file first, because it REQUIRES a `durationSeconds` to
   * price the job and no read returned one.
   */
  durationSeconds?: number
  error?: string
}

/** Result of `getMediaBatch`: one resolved entry per requested item, in order. */
export interface MediaBatchResult {
  items: ResolvedMediaBatchItem[]
}

/** Options for `listMedia`. */
export interface ListMediaOptions {
  /** Which library to read; defaults to 'creations' (studio outputs). 'uploads' = the editor Uploads tab. */
  source?: MediaSource
  contentType?: MediaType | MediaType[]
  status?: string
  /** Filter by asset class: 'creation', 'board', 'look', or 'upload'. */
  kind?: 'creation' | 'board' | 'look' | 'upload'
  /** When true, return only outputs that have a favorited (non-archived) variation. */
  favorited?: boolean
  /** When true, return only outputs that have an archived variation. */
  archived?: boolean
  limit?: number
  offset?: number
}

/** Media kinds that semantic library search can return / filter by. */
export type MediaKind = 'image' | 'video' | 'audio'

/** A scene within a video asset that matched a media search, with its own relevance. */
export interface SearchMediaScene {
  /** Scene start within the asset, in milliseconds. */
  startMs: number
  /** Scene end within the asset, in milliseconds. */
  endMs: number
  /** Cosine relevance of this scene to the query (0..1). */
  relevance: number
}

/** One asset (a single variation) returned by semantic library search. */
export interface SearchMediaResult {
  /** The asset's record id (source_record_id). With `variant`, uniquely identifies the atomic asset. */
  id: string
  /** The variation index within the record (studio generation output index; 0 for single-asset sources). */
  variant: number
  /** The asset's origin table (studio_outputs, editor_uploads, stock_assets, brand_kits). */
  sourceTable: string
  kind: MediaKind | null
  /** A resolved, usable URL for the asset (a cached edit proxy for stock). */
  url: string | null
  /** The vision description of the asset. */
  summary: string | null
  tags: string[]
  /** Best cosine relevance of this asset to the query (0..1). */
  relevance: number
  /** For videos, the specific scenes that matched, best first (empty for image/audio). */
  scenes: SearchMediaScene[]
}

/** Options for searchMedia. */
export interface SearchMediaOptions {
  /** Restrict results to these media kinds. Omit to search all kinds. */
  kinds?: MediaKind[]
  /** Maximum number of assets to return (default 12, max 50). */
  limit?: number
}

// ─── Library folders (Unified Content Library, Phase D) ──────────────────────

export type FolderType = 'manual' | 'smart'

/** The smart-folder query spec = the same filters the library search bar produces. */
export interface SmartFolderQuery {
  text?: string
  kinds?: MediaKind[]
  sources?: Array<'creations' | 'uploads' | 'stock'>
  facets?: Record<string, string>
  tags?: string[]
  favoritedOnly?: boolean
  sort?: 'relevance' | 'recent' | 'name'
}

export interface Folder {
  id: string
  name: string
  type: FolderType
  query: SmartFolderQuery | null
  parentId: string | null
  icon: string | null
  color: string | null
  position: number
  createdAt: string
  updatedAt: string
}

/** A built-in derived folder (recents, favorites, edits, canvas, posts). */
export interface DerivedFolder {
  key: string
  name: string
}

/** One item inside a folder: media (variation-atomic) or an entity (project/post, manual folders only). */
export type FolderItem =
  | { type: 'media'; kind: MediaKind | null; sourceTable: string; sourceRecordId: string; variant: number; url: string | null; summary: string | null; isFavorited: boolean; relevance?: number }
  | { type: 'project' | 'card'; id: string; name: string; subtype: string | null }

export interface CreateFolderInput {
  name: string
  type?: FolderType
  query?: SmartFolderQuery
  parentId?: string | null
}

export interface UpdateFolderInput {
  name?: string
  /**
   * MOVES the folder: a folder has exactly ONE parent, so setting this takes it out of wherever it was.
   * That is a different relationship from `addItems`, where an item gains a pointer and keeps the ones it
   * already had.
   */
  parentId?: string | null
  query?: SmartFolderQuery | null
  icon?: string | null
  color?: string | null
  position?: number
  /**
   * File these items. A DELTA, not a list to replace: folder membership is many-to-many, so a declarative
   * list would silently unfile everything absent from it.
   */
  addItems?: FolderItemRef[]
  /** Unfile these items. Only the pointer goes; the asset is never touched. */
  removeItems?: FolderItemRef[]
  /** Apply this patch to several folders. Attribute fields (name, query, icon, color, position) need one. */
  folderIds?: string[]
}

/** A pointer into a manual folder, by the universal variation-atomic identity. */
export interface FolderItemRef {
  sourceTable: string
  sourceRecordId: string
  variant?: number
}

/** Fields to start a presigned media upload (phase 1 of uploadMedia). */
export interface CreateMediaUploadInput {
  fileName: string
  contentType: string
  sizeBytes?: number
}

/** A pending upload: PUT the bytes to uploadUrl, then completeMediaUpload(outputId). */
export interface CreateMediaUploadResult {
  outputId: string
  uploadUrl: string
  /**
   * Headers to send with the PUT, exactly as given.
   *
   * Optional because an older API deployment does not return it; when absent, send
   * `Content-Type` alone. Once storage is R2 the presigned URL signs the owner in as
   * `x-amz-meta-user_id` and a PUT without it is refused, so a client that hardcodes
   * `Content-Type` breaks. Taking the headers from the server keeps this client
   * store-agnostic and lets the API and the SDK deploy in either order.
   */
  uploadHeaders?: Record<string, string>
  storagePath: string
  expiresAt: string
}

/** Fields to import a remote URL as first-class media. */
export interface ImportMediaInput {
  url: string
  contentType?: string
  fileName?: string
}

/** A finalized upload/import: a first-class media output (referenceable by outputId). */
export interface UploadedMedia {
  outputId: string
  url: string
}

/**
 * The result of importing a remote URL.
 *
 * ⚠️ Separate from `UploadedMedia` because `outputId` can be NULL here and cannot there. A two-phase upload
 * always creates a row; an import may create nothing, because the server dedups on content hash and the same
 * bytes twice give one library item rather than two. Widening `UploadedMedia` instead would force every
 * upload caller to handle a null that its path can never produce.
 */
export interface ImportedMedia {
  /**
   * The library item, or null.
   *
   * Null means the bytes are already the account's but belong to something that is not a library item, such
   * as an export from a project. There is nothing to reference by id in that case.
   */
  outputId: string | null
  url: string
  /** True when nothing was created because the account already held these exact bytes. NOT an error. */
  alreadyExisted: boolean
  /** What the bytes already ARE, when `alreadyExisted`, so a caller can say which thing rather than "duplicate". */
  existing?: { objectName: string; role: string | null; ownedBy: string | null }
}

/** The operation a model performs within its content type. */
export type ModelKind = 'generate' | 'upscale' | 'lip-sync' | 'voice'

/**
 * A model's capability surface, as advertised by the discovery endpoint. Typed
 * loosely (an index signature for the long tail) because the full contract is
 * validated server-side; the fields below are the stable ones clients reason
 * about.
 */
export interface ModelCapabilities {
  kind: ModelKind
  outputType: 'image' | 'video' | 'audio' | 'text' | 'voice'
  promptMode: 'required' | 'optional' | 'none'
  [key: string]: unknown
}

/**
 * How to address a model's references in the prompt (from get_model). Tells an
 * agent the scheme the model actually binds, so references are tagged correctly.
 */
export interface PromptReferences {
  /** 'numbered_tag' (@Image1) | 'named_tag' (@name) | 'numbered_prose' ("image 1") | 'descriptive' | 'none'. */
  scheme: 'numbered_tag' | 'named_tag' | 'numbered_prose' | 'descriptive' | 'none'
  /** Whether the model semantically binds the addressing (vs positional-only). */
  honored: boolean
  /** The model's multi-reference buckets and the token to use for each ({n}/{name}). */
  inputs: Array<{ for: string; token: string | null; max: number }>
  /** One-sentence guidance for weaving references into the prompt. */
  instruction: string
}

/** A model in the discovery catalog returned by `listModels` / `getModel`. */
export interface ModelInfo {
  modelId: string
  displayName: string
  description: string | null
  contentType: 'image' | 'video' | 'audio'
  kind: ModelKind
  tags: string[]
  /** True for the default model of its content type. */
  isDefault?: boolean
  capabilities: ModelCapabilities
  /** How to address references in the prompt (present on getModel; optional on list items). */
  promptReferences?: PromptReferences
}

// ---------------------------------------------------------------------------
// Content pipeline (posts)
// ---------------------------------------------------------------------------

/** Platforms a card or one of its posts may target. */
export type PostPlatform =
  | 'youtube'
  | 'instagram'
  | 'tiktok'
  | 'facebook'
  | 'linkedin'
  | 'x'
  | 'threads'
  | 'general'

/**
 * 🚨 `CardStatus` IS GONE, AND SO IS THE COLUMN BEHIND IT. A card has no status.
 *
 * It carried no information and where it was set it was wrong. Publishing deliberately never wrote it
 * (`published_at IS NOT NULL` is the canonical indicator), so almost every row read `draft` regardless of
 * what the card actually was, and the handful that did not contradicted their own timestamps.
 *
 * ⭐ A CARD'S STATE IS FOUR FACTS THAT ALREADY EXIST: `stageId` (the pipeline position the user controls),
 * `scheduledAt`, `publishedAt` and `archivedAt`. Read those instead.
 */

/**
 * A stage. Stages are per-account customizable (renamed, reordered,
 * added, removed), so resolve one with `listStages` rather than assuming
 * fixed names. The `id` is the only fully stable handle; `slug` is frozen at
 * creation and `name` is a display label.
 */
/**
 * A SPACE: the planner's top-level container. Space > Stage > Card > Post.
 *
 * A space is ACCOUNT-owned, not user-owned, so every member of an account sees the same spaces. Each
 * space has its own stages, so two spaces can both hold a stage called `Published` without collision.
 */
export interface Space {
  id: string
  accountId: string
  name: string
  coverUrl: string | null
  coverPosition: { x: number; y: number } | null
  isFavorite: boolean
  /** ISO timestamp when the space was archived, or null while it is active. */
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  /**
   * Live cards on the board, ARCHIVED EXCLUDED. Present on both `listSpaces` and `getSpace`, and the
   * two agree by construction: they ask the same question so an agent never sees two numbers for one
   * board.
   */
  postCount?: number
}

export interface Stage {
  id: string
  name: string
  slug: string | null
  color: string | null
  sortOrder: number
  isDefault: boolean
}

/** A post as returned by `listCards` (the list projection). */
export interface CardSummary {
  id: string
  title: string
  platform: string | null
  stageId: string | null
  boardOrder: number | null
  contentType: string | null
  coverUrl: string | null
  isFavorite: boolean
  /** When the card was archived; `null` is live. The stored fact. */
  archivedAt: string | null
  /** Derived from `archivedAt` for convenience. There is no such column. */
  isArchived: boolean
  folderId: string | null
  scheduledAt: string | null
  publishedAt: string | null
  publishUrl: string | null
  createdAt: string | null
  updatedAt: string | null
  /** Distinct platforms this card has posts for. */
  platforms: string[]
}

/** An asset attached to a post. */
export interface CardAsset {
  id: string
  assetType: string | null
  assetId: string | null
  assetUrl: string | null
  displayName: string | null
  sortOrder: number
}

/** One post: a card's publication on one platform, bound to a connected account. */
export interface Post {
  id: string
  connectedAccountId: string | null
  platform: string | null
  format: string | null
  status: string | null
  scheduledAt: string | null
  publishedAt: string | null
  /**
   * Per-platform/per-format publish config: the publish payload for this
   * post (mediaItems, caption, thumbnails, privacy, etc.). The shape per
   * platform/format comes from getPlatform. Null when not yet set.
   */
  platformSettings: Record<string, unknown> | null
}

/** Full card detail as returned by `getCard`, with its assets and posts. */
export interface CardDetail extends CardSummary {
  script: string | null
  notes: string | null
  metadata: Record<string, unknown> | null
  assets: CardAsset[]
  /** ⚠️ `posts`, NOT `destinations`. The type was ALREADY `Post`; only the field name lagged.
   *  A card publishes one or more POSTS, each with its own platform-specific settings. */
  posts: Post[]
  /** Tag names on the post (organizational). */
  tags: string[]
}

/** An account tag (the organizational tag library). */
export interface Tag {
  id: string
  name: string
  isDefault: boolean
  isSystem: boolean
}

/** The space a scoped read resolved to. Always present, so a caller never has to infer it. */
export interface ResolvedSpace {
  id: string
  name: string
}

/** Result of `listCards`: a page of cards, pagination metadata, and the SCOPE it answers about. */
export interface CardListResult {
  /** ⚠️ `cards`, NOT `posts`. This has always held CARDS. `Post` now means a publish DESTINATION,
   *  and the stale name is what let an app-side realtime binding subscribe to the wrong table. */
  cards: CardSummary[]
  total: number
  hasMore: boolean
  /**
   * ⭐⭐⭐ THE SPACE THIS LIST IS AN ANSWER ABOUT. This read is scoped to ONE space and falls back to the
   * account's default when none is named, so without this a list of the wrong board is indistinguishable
   * from a list of the right one. Measured 2026-09-14: a caller passing `space_id` where the parameter is
   * `spaceId` got a complete-looking list of a different board and concluded the filter was ignored.
   */
  space: ResolvedSpace
}

/** Options for `listCards`. */
export interface ListCardsOptions {
  /**
   * `true` lists ARCHIVED cards instead of live ones. Archived are excluded by default.
   *
   * ⚠️ THIS REPLACED `status`, WHICH WAS THE ONLY WAY TO SEE ARCHIVED CARDS. Archive is its own field now,
   * so without this the archive would have become unreachable through the API.
   */
  archived?: boolean
  platform?: string
  /** A stage id, slug, or name; resolved against your stages server-side. */
  stage?: string
  isFavorite?: boolean
  search?: string
  limit?: number
  offset?: number
  /**
   * Which SPACE's board to list. Omitted means the account's DEFAULT space, not
   * every space.
   *
   * ⚠️ A LIST WITHOUT THIS IS SCOPED, NOT COMPLETE. `listCards` is always
   * `.eq('space_id', ...)` server-side, so cards on any other board are absent
   * with nothing in the response saying so, and `search` misses them too. Get an
   * id from `listSpaces()`.
   */
  spaceId?: string
}

/** Options for {@link ContentHeroClient.listStages}. */
export interface ListStagesOptions {
  /**
   * Which SPACE's stages. Omitted means the account's default space. Stages are
   * per-space, so two spaces can each have a stage called "Published" with
   * different ids.
   */
  spaceId?: string
}

/** Fields to create a post. `stage` accepts a stage id, slug, or name. */
export interface CreateCardInput {
  title: string
  platform: PostPlatform
  stage?: string | null
  /** A public URL for the post cover (the card thumbnail). */
  coverUrl?: string | null
  /** A media token (output id, first-8, or "-N") for the cover; resolved to its URL. */
  coverOutputId?: string | null
  /** Tag names to set on the post (must already exist; replaces the set). */
  tags?: string[]
  /**
   * The card's posts. DECLARATIVE and keyed by PLATFORM: pass the whole set, and a platform no
   * longer present is detached. `[]` clears them.
   */
  posts?: PostInput[]
  /**
   * The post's assets. DECLARATIVE, and **the array ORDER IS the carousel order**. Keep an existing asset
   * by `id`, add a new one by `assetUrl` / `outputId`; anything absent is removed. `[]` clears them.
   */
  assets?: CardAssetInput[]
}

/** Fields to update a post. `stage` accepts a stage id, slug, or name. */
/** One post, keyed by platform. */
export interface PostInput {
  platform: PostPlatform
  format?: string
  connectedAccountId?: string | null
  /** Per-post override. Omitted, the card's own `scheduledAt` applies. */
  scheduledAt?: string | null
  platformSpecificData?: Record<string, unknown> | null
  status?: string
}

/** One asset on a post: keep an existing one by `id`, or add a new one by `assetUrl` / `outputId`. */
export interface CardAssetInput {
  id?: string
  assetUrl?: string
  outputId?: string
  assetType?: string
  displayName?: string
  metadata?: Record<string, unknown> | null
}

export interface UpdateCardInput {
  title?: string
  platform?: PostPlatform
  /** Archive or restore the card. `status` is untouched because a card no longer has one. */
  archived?: boolean
  /** A stage id, slug, or name; resolved in the space the card is landing in. */
  stage?: string | null
  /**
   * MOVE the card to another space. A space id or slug.
   *
   * 🚨 A MOVE, NOT A FIELD WRITE. `cards_stage_in_space_fkey` is composite on `(stage_id, space_id)`, so
   * the card's stage must already belong to its new space IN THE SAME STATEMENT; writing the space alone
   * is not a state the database will hold. Sent WITHOUT `stage`, the card lands in the target's stage
   * whose SLUG matches its current one, and failing that in the target's first stage.
   */
  spaceId?: string | null
  isFavorite?: boolean
  coverUrl?: string | null
  /** A media token (output id, first-8, or "-N") for the cover; resolved to its URL. */
  coverOutputId?: string | null
  /** Cover framing as `{x, y}` percentages. Sent alone, it reframes without replacing the image. */
  coverPosition?: { x: number; y: number } | null
  /** What the card is (reel, lesson, ad, banner). Free text; the board does not branch on it. */
  contentType?: string | null
  /** Tag names to set on the post (must already exist; replaces the set). */
  tags?: string[]
  scheduledAt?: string | null
  publishedAt?: string | null
  publishUrl?: string | null
  script?: string | null
  notes?: string | null
  metadata?: Record<string, unknown> | null
  /**
   * The card's posts. DECLARATIVE and keyed by PLATFORM: pass the whole set, and a platform no
   * longer present is detached. `[]` clears them.
   */
  posts?: PostInput[]
  /**
   * The post's assets. DECLARATIVE, and **the array ORDER IS the carousel order**. Keep an existing asset
   * by `id`, add a new one by `assetUrl` / `outputId`; anything absent is removed. `[]` clears them.
   */
  assets?: CardAssetInput[]
}

/** One post's publish outcome. */
export interface PublishPostResult {
  success: boolean
  platform: string
  /** ⚠️ Renamed from `destinationId` (2026-08-26). A publish destination IS a post now. */
  postId: string | null
  url?: string
  error?: string
}

/** The result of `publishPost`: one outcome per post, plus tallies. */
export interface PublishResult {
  cardId: string
  results: PublishPostResult[]
  publishedCount: number
  failedCount: number
}

// ---------------------------------------------------------------------------
// Inspiration / research reads
// ---------------------------------------------------------------------------

/** A tracked account: an inspiration creator or one of the caller's brand accounts. */
export interface TrackedAccount {
  id: string
  platform: string | null
  /** Platform-level account id (the shared key into tracked content). */
  accountId: string | null
  handle: string | null
  name: string | null
  avatarUrl: string | null
  followerCount: number | null
  lastSyncedAt: string | null
  syncStatus: string | null
  accountType: string | null
}

/** A piece of tracked content: the list projection. */
export interface ContentSummary {
  id: string
  platform: string | null
  contentType: string | null
  title: string | null
  url: string | null
  thumbnailUrl: string | null
  viewCount: number | null
  likeCount: number | null
  commentCount: number | null
  shareCount: number | null
  durationSeconds: number | null
  outlierScore: number | null
  engagementRate: number | null
  viewsPerFollower: number | null
  publishedAt: string | null
  sourceCreator: string | null
  accountHandle: string | null
  /** True when the post is on one of the caller's OWN accounts rather than a creator they watch. */
  isOwn?: boolean
}

/** One timed slice of a transcript. */
export interface ContentTranscriptSegment {
  startMs: number
  endMs: number
  text: string
  speaker: string | null
}

/**
 * A post's transcript, at the grain that was asked for.
 *
 * `status` distinguishes outcomes that used to collapse into an empty string: `complete`, `not_applicable`
 * (asked, and there is nothing to transcribe), `failed` (asked, and it broke, so it will be retried),
 * `processing`, and `absent` (never asked).
 */
export interface ContentTranscript {
  status: string
  language: string | null
  /** Present at the `text` grain. */
  text?: string | null
  /** Present at the `segments` grain. */
  segments?: ContentTranscriptSegment[]
  /** True when a window or a search narrowed what came back, so an empty list is not "nothing exists". */
  windowed?: boolean
}

/** Full detail for one tracked post. */
export interface ContentDetail extends ContentSummary {
  description: string | null
  hashtags: string[]
  keywords: string[]
  mentions: string[]
  audioInfo: Record<string, unknown> | null
  followerCountSnapshot: number | null
  /** Present only when a transcript grain was requested. */
  transcript?: ContentTranscript
}

/** One tracked account with its performance. */
export interface AccountDetail {
  account: TrackedAccount
  contentCount: number
  totals: { views: number; likes: number; comments: number }
  averages: { views: number | null; engagementRate: number | null; outlierScore: number | null }
  topContent: ContentSummary[]
  recentContent: ContentSummary[]
}

/** Which ownership tiers a content read spans. */
export type ContentScope = 'all' | 'inspiration' | 'brand'

/** Options for `listContent`. */
export interface ListContentOptions {
  /**
   * `inspiration` = creators they watch, `brand` = their own accounts, `all` = both (the default).
   * Each row carries `isOwn`, so one list can answer both questions.
   */
  scope?: ContentScope
  platform?: string
  /** A specific content type, or `posts` for the Instagram feed-post group (image, carousel, video). */
  contentType?: string
  outlierScoreMin?: number
  outlierScoreMax?: number
  viewsMin?: number
  viewsMax?: number
  durationMin?: number
  durationMax?: number
  subscribersMin?: number
  subscribersMax?: number
  /** ISO timestamps. More specific than `publicationDate` and wins over it. */
  publishedAfter?: string
  publishedBefore?: string
  /** A window keyword: week, month, 3months, 6months, year, 2years. */
  publicationDate?: string
  search?: string
  sortBy?: 'score' | 'date' | 'views' | 'engagement'
  sortOrder?: 'asc' | 'desc'
  /** Tracked-account ids. Ids the caller does not own resolve to nothing rather than widening the query. */
  accountIds?: string[]
  /** Only the one-off posts the caller saved by url. */
  addedByYou?: boolean
  /** Scope to the accounts linked to this brand kit. */
  brandKitId?: string
  favorited?: boolean
  limit?: number
  offset?: number
}

/** Options for `getContent`. */
export interface GetContentOptions {
  /** `none` (default), `text` for the flat transcript, or `segments` for the timed form. */
  transcript?: 'none' | 'text' | 'segments'
  /** Segment window, in milliseconds from the start of the media. Implies the `segments` grain. */
  startMs?: number
  endMs?: number
  /** Case-insensitive substring; returns only the segments containing it. Implies the `segments` grain. */
  transcriptSearch?: string
}

/** Options for `listAccounts`. */
export interface ListAccountsOptions {
  /** Narrow to one tier. Omitted, both come back. */
  accountType?: 'inspiration' | 'brand'
  /** Scope to the accounts linked to this brand kit. */
  brandKitId?: string
}

/** Result of `listContent`: a page of content plus pagination metadata. */
export interface ContentListResult {
  outliers: ContentSummary[]
  total: number
  hasMore: boolean
}

// ---------------------------------------------------------------------------
// Connected accounts (publish targets)
// ---------------------------------------------------------------------------

/**
 * A connected social account: a publish target. Read-only (connecting an account
 * is a web-only OAuth flow). The safe projection only; no tokens are ever exposed.
 */
export interface ConnectedAccount {
  id: string
  platform: string | null
  accountId: string | null
  accountName: string | null
  accountHandle: string | null
  accountUrl: string | null
  connectionStatus: string | null
  connectionType: string | null
  /** What this connection can do (publish, analytics, ...); platform-shaped. */
  capabilities: Record<string, unknown> | null
  isDefault: boolean
  lastSyncedAt: string | null
  lastValidatedAt: string | null
  createdAt: string | null
}

// ---------------------------------------------------------------------------
// Publish platforms (what a post can target)
// ---------------------------------------------------------------------------

/** One selectable format for a platform (e.g. reel, short, story, thread). */
export interface PlatformFormatInfo {
  value: string
  label: string
}

/**
 * A publish target in the catalog (the list_platforms item): the platform, its
 * formats, and whether the caller has an active connected account for it. Call
 * getPlatform for the full per-format request shape.
 */
export interface PlatformSummary {
  platform: string
  name: string
  formats: PlatformFormatInfo[]
  /** Whether the caller can publish here now (has an active connected account). */
  connected: boolean
}

/**
 * One platform's full publishing shape (the getPlatform result): the fields,
 * options, and limits a post requires per format, which a client fills as a
 * post's platformSettings.
 */
export interface PlatformSchema {
  platform: string
  name: string
  formats: string[]
  postingModes: string[]
  /** Constrained-field option sets (e.g. visibility, privacyLevel, categoryId). */
  enums: Record<string, readonly unknown[]>
  characterLimits: Record<string, number> | null
  /** Per-format field template: field names + default values (File handles stripped). */
  fieldTemplatesByFormat: Record<string, Record<string, unknown>>
}

// ---------------------------------------------------------------------------
// Favorites & archive (universal set/clear across asset types)
// ---------------------------------------------------------------------------

/** The asset types that can be favorited. */
export type FavoriteAssetType =
  | 'card'
  | 'voice'
  | 'brand_kit'
  | 'project'
  | 'inspiration_content'
  | 'gallery'
  | 'transition'
  | 'space'

/** The asset types that can be archived. */
export type ArchiveAssetType = 'card' | 'brand_kit' | 'brand_kit_section' | 'project' | 'space'

/**
 * The target of a favorite / unfavorite call.
 *
 * Provide `assetType` + `id` for a top-level asset, OR `id` + `variationIndex`
 * (1-based) to target a single studio output variation slot, in which case the
 * id is a studio output id and `assetType` is ignored.
 */
export interface FavoriteInput {
  assetType?: FavoriteAssetType
  id: string
  /** 1-based variation slot; when set, `id` is a studio output id. */
  variationIndex?: number  /** Defaults to true. Pass false to clear the favorite. */
  favorited?: boolean
}

/**
 * The target of an archive / unarchive call.
 *
 * Provide `assetType` + `id` for a top-level asset, OR `id` + `variationIndex`
 * (1-based) to target a single studio output variation slot, in which case the
 * id is a studio output id and `assetType` is ignored.
 */
export interface ArchiveInput {
  assetType?: ArchiveAssetType
  id: string
  /** 1-based variation slot; when set, `id` is a studio output id. */
  variationIndex?: number  /** Defaults to true. Pass false to restore. */
  archived?: boolean
}

// ---------------------------------------------------------------------------
// Editor / canvas ops (programmatic parity with the manual UI + in-app agent)
// ---------------------------------------------------------------------------

/** Which write model a project's composition uses: 2D canvas layers or a 1D editor timeline. */
export type EditorSurface = 'canvas' | 'editor'

/** One op in the shared editor/canvas op vocabulary. Opaque here: shaped by the reducer for the
 *  project's surface (canvas layer/slide ops, or timeline clip ops). Every op has an `op` name. */
export interface EditorOp {
  op: string
  /**
   * Optional client-generated stable id (uuid) for this op. When omitted, `applyEditorOps` generates one
   * for you before sending. It is the op's identity across its whole lifecycle: the server persists it, the
   * unique-per-project constraint makes a retried op idempotent, and a live editor client uses it to ignore
   * the broadcast echo of its own edit.
   */
  op_id?: string
  [key: string]: unknown
}

/** Input to `applyEditorOps`. */
export interface ApplyEditorOpsInput {
  /** The project to edit. Its `surface` selects the op vocabulary (canvas layers vs timeline clips). */
  projectId: string
  /** The ops to apply, in order. */
  ops: EditorOp[]
  /** Optimistic-concurrency token from a prior read. When omitted, the server uses the current revision. */
  expectedRevision?: number
  /** A short human intent for the edit (attribution + observability). */
  userIntent?: string
  /** When true, the result includes a fingerprint-validated preview still URL of the post-edit state. */
  includeRenderUrl?: boolean
}

/** The per-op outcome (surface-agnostic; created ids normalized across surfaces). */
export interface EditorOpResult {
  op: string
  /** The op's stable id (the one you sent, or the one generated for you), echoed back for every op. */
  opId: string
  ok: boolean
  error?: string
  warnings?: string[]
  createdIds?: string[]
  /** For an async effect op (remove_background): the studio_outputs id of the dispatched job, so the caller can
   *  wait_for_generation on it. Present only on a successfully-dispatched async op. */
  generatingOutputId?: string
}

/** Result of `applyEditorOps`: the new revision + per-op results. */
export interface ApplyEditorOpsResult {
  // No `surface`: it equalled the project's `kind` once the vocabularies converged, and returning the same
  // value under two names is what this change removed.
  revision: number
  results: EditorOpResult[]
  /** Present only when `includeRenderUrl` was set: a preview still URL of the resulting composition. */
  renderUrl?: string | null
}

/** Which surface a project is: an editor (video timeline) or a canvas (slides/layers). */
/**
 * Which surface a project lives on.
 *
 * Named `ProjectKind` for source compatibility; the field it describes is now `surface`. The API column was
 * renamed because `canvas` and `editor` are two of the product's eleven surfaces, while `kind` now means the
 * document shape (`tracks` | `slides`) on a project version.
 */
export type ProjectKind = 'editor' | 'canvas'
export type ProjectSurface = ProjectKind

/** Lightweight project list item (spans both surfaces), from `listProjects`. */
export interface ProjectSummary {
  id: string
  surface: string
  /** @deprecated Alias for `surface`, still emitted for one release window. Prefer `surface`. */
  kind: string
  title: string
  orientation: string
  width: number
  height: number
  thumbnailUrl: string | null
  isArchived: boolean
  isFavorited: boolean
  createdAt: string | null
  updatedAt: string | null
}

/**
 * A project's full detail, from `getProject` (read-before-write) and returned by `createProject`. Extends
 * the summary with the composition `state` + `revision` (pass the revision back as `applyEditorOps`'s
 * `expectedRevision`) plus the link fields.
 */
/** One clip group on the timeline: its members share a groupId, and the ordinal/name are stamped on each.
 *  Rolled up by get_project so you can list groups + resolve members without scanning every clip. */
export interface GroupSummary {
  id: string
  /** Stable "Group N" number, assigned at creation and never renumbered. */
  ordinal: number | null
  /** Optional user/agent-set name (via update_group); null means show "Group {ordinal}". */
  name: string | null
  memberClipIds: string[]
}

export interface ProjectDetail extends ProjectSummary {
  revision: number
  /** The full composition state (`{ slides }` for canvas, `{ tracks }` for the editor timeline). */
  state: unknown
  /** Timeline clip groups rolled up from the clips. Empty for canvas. Use to list/target groups
   *  (update_group to rename, update_clips with `groupId` to bulk-edit a whole group). */
  groups: GroupSummary[]
  assetReferences: unknown
  brandKitId: string | null
  exportedCardId: string | null
  exportedUrl: string | null
  shareId: string | null
  favoritedAt: string | null
  archivedAt: string | null
  /** A fingerprint-validated preview still URL. Present only when getProject is called with
   *  `includeRenderUrl` (opt-in, since it may render). */
  renderUrl?: string | null
  /**
   * The coordinate space LAYER GEOMETRY is expressed in. This is NOT `width`/`height`.
   *
   * `width`/`height` are the project's OUTPUT resolution (what a render produces). Layer boxes and
   * positions are in PREVIEW dims, the project scaled to a 960px longest edge, so a 2168x1152 project has
   * a 960x510 layer space. The two differ by 2.26x there, and nothing in the response previously said so,
   * which meant an external caller sizing a layer from `width`/`height` was silently wrong: an oversized
   * box is valid input, so no error was ever raised.
   *
   * Use it for any absolute geometry, and pass it as layerWidth/layerHeight for a FULL-FRAME layer.
   */
  compositionSpace?: { width: number; height: number }
}

/** One live participant in `getContext`: who is present and on what surface/scope. */
export interface LiveContextParticipant {
  userId: string
  sessionId: string
  /** The surface they are on: 'canvas' | 'editor' | 'studio' | 'content' | future surfaces. */
  surface: string
  projectId: string | null
  cardId: string | null
  /** ISO timestamp of their last activity. */
  updatedAt: string
}

/** The result of `getContext`: the most-recent-active session's live context + the full participant set. */
export interface LiveContextResult {
  /**
   * The most-recent-active session's context: a discriminated `{ surface, ...surfaceState }` object carrying
   * the focus (e.g. `focusedSlideId`, `playheadFrame`) and current selection. A short-lived `snapshotUrl` of
   * the live viewport is included ONLY when the read was made with `capture: true`. Null when no session is live.
   */
  context: Record<string, unknown> | null
  /** Metadata for that default participant, or null when no one is live. */
  participant: LiveContextParticipant | null
  /** Every currently-live participant, most-recent first, for multi-human callers. */
  participants: LiveContextParticipant[]
}

/** Options for `getContext`. */
export interface GetContextInput {
  /** Scope to a specific project's presence (editor/canvas). Omit for the caller's most-recent surface anywhere. */
  projectId?: string
  /**
   * Opt in to vision: also ping the live tab for a fresh viewport screenshot at read time, returned as a
   * short-lived `snapshotUrl`. Default false = structured-only (fast, never touches the live page). To see the
   * COMPOSED OUTPUT (not the user's screen) use `render` instead.
   */
  capture?: boolean
  /**
   * Opt in to an inline render (never persisted), returned as image(s), so you can visually verify work while
   * iterating. `true` renders the current focus point as a still; use `mode` + the params below for a filmstrip.
   * Ephemeral (counts against no quota) and does not need a live tab. To watch a RAW source clip use `getMedia`
   * with a video item; for a composed VIDEO of a range use `createPreview` / `getPreview` (a job).
   */
  render?: boolean
  /**
   * Render tier (inferred from the params when omitted): 'still' (one composed frame/slide) or 'filmstrip' (N
   * composed frames across an editor range).
   */
  mode?: 'still' | 'filmstrip'
  /** still (editor): which timeline frame. Omit to render the current playhead frame. */
  frame?: number
  /** still (canvas): which slide (id). Omit to render the focused slide. */
  slideId?: string
  /** still (canvas): which slide (1-based index; alternative to `slideId`). */
  slideIndex?: number
  /** filmstrip: start timeline frame of the range (edit space). Omit to start at the beginning. */
  fromFrame?: number
  /** filmstrip: end timeline frame of the range. Omit to run to the end. */
  toFrame?: number
  /** filmstrip: how many frames to return. Omit for a proportional default. */
  count?: number
  /**
   * still: render at an explicit DISPLAY width in pixels, so you can judge legibility at the size the output
   * will actually be seen (a classroom tile, a thumbnail, a feed card) rather than at full resolution, where
   * small type always looks fine. Height is derived from the composition's aspect ratio and is deliberately
   * not a parameter. Clamped to a sane range; the size actually produced comes back on `rendered`.
   */
  width?: number
}

/** Input to `createPreview`: currently a short COMPOSED video of an editor range (ephemeral, job-based). */
export interface PreviewInput {
  projectId: string
  /** Start timeline frame of the range (edit space). Omit to start at the beginning. */
  fromFrame?: number
  /** End timeline frame. Omit to run to the end (capped to a short preview length). */
  toFrame?: number
}

/** The handle returned by `createPreview`; feed `renderId` + `bucketName` to `getPreview`. */
export interface PreviewJob {
  renderId: string
  bucketName: string
  fromFrame: number
  toFrame: number
  durationSeconds: number
}

/** The poll result for a preview render. */
export interface PreviewStatus {
  status: 'rendering' | 'done' | 'failed'
  /** 0..1 while rendering. */
  progress?: number
  /** Short-lived signed URL to the ephemeral preview output (present when status = 'done'). */
  url?: string
  /** Estimated Lambda cost for this render (telemetry). */
  estimatedCostUsd?: number
  error?: string
}

/** A resolved selected editor timeline clip, threaded so you see the selection without a `getProject` hop. */
export interface EditorSelectedItem {
  id: string
  type: string
  trackId?: string
  /** Timeline start frame (edit space). */
  from: number
  durationInFrames: number
  /** Resolved media URL for image/video/audio clips, so you can fetch the raw clip directly. */
  mediaUrl?: string
}

/** The inline render returned when `getContext` is called with `render`. Shape depends on the tier. */
export interface LiveContextRender {
  /** The tier that produced this: 'still' (default) | 'filmstrip'. */
  mode?: 'still' | 'filmstrip'
  // still:
  surface?: 'editor' | 'canvas'
  frame?: number
  slideId?: string
  slideIndex?: number
  /** still: the pixel size of the returned image. Confirms what an explicit `width` request actually produced
   *  (it is clamped), and reports the derived height. */
  width?: number
  height?: number
  /** still: `data:image/webp;base64,...` of the composed frame/slide. */
  dataUrl?: string
  // filmstrip (multiple frames, each with its own dataUrl):
  fromFrame?: number
  toFrame?: number
  frames?: Array<{ frame?: number; dataUrl: string }>
}

/** Filters for `listProjects`. */
export interface ListProjectsInput {
  /** 'archived' -> only archived; 'favorited' -> favorited + not archived; omitted -> not archived. */
  filter?: 'archived' | 'favorited'
  /** Restrict to one surface. Omitted returns both. */
  surface?: ProjectSurface
  /** @deprecated Alias for `surface`, accepted for one release window. `surface` wins if both are set. */
  kind?: ProjectKind
  /** Case-insensitive title search. */
  search?: string
}

/** Input to `createProject`. All optional; the server applies the same defaults as the in-app new-project
 *  flow (16:9 landscape, `editor` kind, an empty composition the app lazy-inits). */
export interface CreateProjectInput {
  surface?: ProjectSurface
  /** @deprecated Alias for `surface`, accepted for one release window. */
  kind?: ProjectKind
  title?: string
  orientation?: string
  width?: number
  height?: number
  brandKitId?: string
}

/** A source for `importProject`: a PowerPoint / Google Slides file URL, or a Canva design id. */
export type ImportProjectSource =
  | { type: 'pptx'; fileUrl: string }
  | { type: 'canva'; designId: string }

/** Input to `importProject`. Creates a new canvas project from the imported deck. */
export interface ImportProjectInput {
  source: ImportProjectSource
  /** Title for the created project. Defaults to 'Imported deck'. */
  title?: string
  /** Optional slide count for an early page-cap check. */
  pageCount?: number
}

/** Options for starting a project export. All optional; defaults: format 'mp4', 720p, watermark on. */
export interface StartExportInput {
  /** 'mp4' (both surfaces) or 'png'/'jpg' (both surfaces) or 'pdf'/'pptx' (canvas only). */
  format?: string
  /** Video resolution (mp4): '480p'|'720p'|'1080p'|'2k'|'4k'. 1080p+ is plan-gated. */
  resolution?: string
  /** Video quality (mp4): 'low'|'recommended'|'high'. */
  quality?: string
  /** Keep the watermark. Removing it is plan-gated. Defaults true. */
  watermark?: boolean
  /** Editor still (png/jpg) only: the timeline frame to render. Clamped to the composition length. Defaults 0. */
  frame?: number
}

/** An export job. `mp4` starts as 'rendering' (poll it); canvas still/doc formats return 'completed'. */
export interface ExportJob {
  exportId: string
  /** 'pending' | 'rendering' | 'transferring' | 'completed' | 'failed'. */
  status: string
  /** The final file URL, present when status is 'completed'. */
  outputUrl?: string | null
  errorMessage?: string | null
  /** 0..1 render progress. */
  progress?: number
}

/** One format in the export catalog. */
export interface ExportFormatSpec {
  format: string
  surfaces: string[]
  /** true = async render job (poll it); false = returned completed immediately. */
  async: boolean
  description: string
  options: string[]
}

/** The export-format catalog, from `getExportFormats`. */
export interface ExportFormatCatalog {
  formats: ExportFormatSpec[]
  resolutions: string[]
  qualities: string[]
}

/** One editable field on a layer/clip type (from the type-discovery catalogs). */
export interface EditorTypeProp {
  name: string
  /** A human-readable type hint (e.g. 'string', 'number', "'left' | 'center' | 'right'"). */
  type: string
  description?: string
}

/** A layer/clip type and its editable props. */
export interface EditorTypeSpec {
  type: string
  description: string
  props: EditorTypeProp[]
  /** Which shared prop groups this type also accepts (keys of `sharedProps`). */
  supports: string[]
  /** A copy-pasteable minimal item skeleton for creating this type via add_item / insert_prebuilt_track. */
  example?: Record<string, unknown>
}

/** How to CREATE clips + tracks (the creation ops of update_timeline), documented alongside the edit ops. */
export interface EditorCreationSpec {
  description: string
  ops: { op: string; shape: string; description: string }[]
}

/** A timeline track type and the clip types it holds. */
export interface EditorTrackSpec {
  trackType: string
  description: string
  holds: string[]
}

/** Shared prop groups reused across visual types (referenced by each type's `supports`). */
export interface EditorSharedProps {
  base: EditorTypeProp[]
  transform: EditorTypeProp[]
  decoration: EditorTypeProp[]
  adjust: EditorTypeProp[]
}

/** The canvas layer-type catalog, from `getLayerTypes`. Makes `update_canvas` self-describing. */
export interface LayerTypeCatalog {
  surface: 'canvas'
  description: string
  sharedProps: EditorSharedProps
  layerTypes: EditorTypeSpec[]
  /** The update_canvas op vocabulary: every layer + slide op an agent can emit, with its field signature. */
  ops?: EditorCreationSpec
}

/** The editor timeline clip + track-type catalog, from `getTimelineTypes`. Makes `update_timeline`
 *  self-describing. */
export interface TimelineTypeCatalog {
  surface: 'editor'
  description: string
  sharedProps: EditorSharedProps
  clipTypes: EditorTypeSpec[]
  trackTypes: EditorTrackSpec[]
  /** How to CREATE clips + tracks (add_item, insert_track, insert_prebuilt_track), using each clipType `example`. */
  creation?: EditorCreationSpec
  /** The EDIT ops of update_timeline (move_clip, trim_clip, disable_ranges, ...), with each field signature. */
  editOps?: EditorCreationSpec
}

/** A spoken word with source-media timing, ABSOLUTE timeline frames, and per-word metadata (granularity 'word'). */
export interface WordTiming {
  text: string
  /** Start within the SOURCE media, in ms. */
  startMs: number
  /** End within the SOURCE media, in ms (exclusive). */
  endMs: number
  /** Absolute timeline frame this word starts on (feed straight into update_timeline split / range ops). */
  startFrame: number
  /** Absolute timeline frame this word ends on. */
  endFrame: number
  /** Diarized speaker, when known. */
  speakerId: string | null
  /** Normalized 0-1 confidence, when known. */
  confidence: number | null
}

/** A derived dead-air gap between words within a clip: source-media range + timeline frames + duration. */
export interface Silence {
  startMs: number
  endMs: number
  durationMs: number
  startFrame: number
  endFrame: number
}

/** A non-speech audio event (e.g. "[chuckles]", "[sighs]") with source-media timing + timeline frames. */
export interface AudioEvent {
  text: string
  startMs: number
  endMs: number
  startFrame: number
  endFrame: number
  speakerId: string | null
}

/** One timeline clip's transcript segment: the words spoken within it plus its current enabled/disabled state. */
export interface TranscriptSegment {
  /** The timeline clip id, targetable by update_timeline disable_ranges / set_disabled / delete_ranges. */
  clipId: string
  /** Whether the clip is currently excluded from the render (disabled). */
  disabled: boolean
  /** Why it was disabled ('silence' | 'manual' | 'agent'), when known. */
  disabledReason: string | null
  /** The freeform note an agent left explaining this cut, when present. */
  disabledNote: string | null
  /** Start of this clip's slice within its SOURCE media, in milliseconds. */
  sourceStartMs: number
  /** End of this clip's slice within its SOURCE media, in milliseconds (exclusive). */
  sourceEndMs: number
  /** The clip's start position on the TIMELINE, in frames (source range maps onto [fromFrame, fromFrame+durationFrames)). */
  fromFrame: number
  /** The clip's length on the TIMELINE, in frames. */
  durationFrames: number
  /** The words spoken within this clip, space-joined. Empty for a silence gap or untranscribed clip. */
  text: string
  /** Word-level timing (granularity 'word' only), scoped to the requested window when given. */
  words?: WordTiming[]
  /** Derived dead-air gaps within this clip (granularity 'word' only). */
  silences?: Silence[]
  /** Non-speech audio events within this clip (granularity 'word' only; empty for pre-token-store media). */
  audioEvents?: AudioEvent[]
}

export interface TranscriptResult {
  projectId: string
  /**
   * The project's current optimistic-concurrency revision. Pass it straight back as `applyEditorOps` /
   * update_timeline's `expectedRevision` to make a follow-up edit fail on a concurrent change instead of
   * clobbering it. `expectedRevision` is optional, so omit it to just apply to the current revision.
   */
  revision: number
  fps: number
  /** true when at least one clip's source media had a stored transcript. */
  mediaTranscribed: boolean
  segmentCount: number
  segments: TranscriptSegment[]
  /** The distinct diarized speakers present across the returned transcript, sorted. */
  speakers?: string[]
  /** Present only when nothing has been transcribed yet, explaining the empty result. */
  note?: string
}
