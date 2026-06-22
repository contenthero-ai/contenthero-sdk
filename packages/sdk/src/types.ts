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
}

/** A brand-kit section record (returned by the section write methods). */
export interface BrandKitSectionRecord {
  id: string
  tab: string
  sectionName: string
  sortOrder: number
  fields: unknown[]
}

/** Fields to add a brand-kit section. */
export interface AddBrandKitSectionInput {
  tab: string
  sectionName: string
  sortOrder?: number
  fields?: unknown[]
}

/** Fields to update a brand-kit section. */
export interface UpdateBrandKitSectionInput {
  sectionName?: string
  sortOrder?: number
  fields?: unknown[]
}

/** A studio output's media kind. */
export type MediaType = 'image' | 'video' | 'audio' | 'transcript'

/** One variation (slot) of a studio output. */
export interface MediaVariation {
  /** 1-based variation number (matches the UI and a share link's ?v=N). */
  variation: number
  url: string | null
  status: string
  isFavorited: boolean
}

/** A studio output as returned by `listMedia` (the list projection). */
export interface MediaSummary {
  id: string
  type: MediaType
  model: string | null
  prompt: string | null
  status: string
  createdAt: string | null
  variationCount: number
  /** Resolved (non-null) variation URLs. */
  urls: string[]
  /** Asset class: 'creation' (default), 'board' (a reference board), or 'look'. */
  kind: string | null
  /** Board type when kind is 'board' (character, weapon, location, etc.); else null. */
  boardType: string | null
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
}

/** Options for `listMedia`. */
export interface ListMediaOptions {
  contentType?: MediaType | MediaType[]
  status?: string
  /** Filter by asset class: 'creation', 'board', 'look', or 'upload'. */
  kind?: 'creation' | 'board' | 'look' | 'upload'
  limit?: number
  offset?: number
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

/** Platforms a post or destination may target. */
export type PostPlatform =
  | 'youtube'
  | 'instagram'
  | 'tiktok'
  | 'facebook'
  | 'linkedin'
  | 'x'
  | 'threads'
  | 'general'

/** A post's lifecycle status. 'archived' is the archive state (no hard delete). */
export type PostStatus = 'draft' | 'active' | 'completed' | 'archived'

/**
 * A pipeline stage. Stages are per-account customizable (renamed, reordered,
 * added, removed), so resolve one with `listPipelineStages` rather than assuming
 * fixed names. The `id` is the only fully stable handle; `slug` is frozen at
 * creation and `name` is a display label.
 */
export interface PipelineStage {
  id: string
  name: string
  slug: string | null
  color: string | null
  sortOrder: number
  isDefault: boolean
}

/** A post as returned by `listPosts` (the list projection). */
export interface PostSummary {
  id: string
  title: string
  description: string | null
  platform: string | null
  status: string
  pipelineStageId: string | null
  pipelineOrder: number | null
  contentType: string | null
  coverUrl: string | null
  isFavorite: boolean
  folderId: string | null
  scheduledAt: string | null
  publishedAt: string | null
  publishUrl: string | null
  createdAt: string | null
  updatedAt: string | null
  /** Distinct destination platforms attached to this post. */
  platforms: string[]
}

/** An asset attached to a post. */
export interface PostAsset {
  id: string
  assetType: string | null
  assetId: string | null
  assetUrl: string | null
  displayName: string | null
  sortOrder: number
}

/** A publish destination on a post (one platform + connected account). */
export interface PostDestination {
  id: string
  connectedAccountId: string | null
  platform: string | null
  format: string | null
  status: string | null
  scheduledAt: string | null
  publishedAt: string | null
  /**
   * Per-platform/per-format publish config: the publish payload for this
   * destination (mediaItems, caption, thumbnails, privacy, etc.). The shape per
   * platform/format comes from getPlatform. Null when not yet set.
   */
  platformSettings: Record<string, unknown> | null
}

/** Full post detail as returned by `getPost`, with its assets and destinations. */
export interface PostDetail extends PostSummary {
  script: string | null
  notes: string | null
  metadata: Record<string, unknown> | null
  assets: PostAsset[]
  destinations: PostDestination[]
}

/** Result of `listPosts`: a page of posts plus pagination metadata. */
export interface PostListResult {
  posts: PostSummary[]
  total: number
  hasMore: boolean
}

/** Options for `listPosts`. */
export interface ListPostsOptions {
  status?: string
  platform?: string
  /** A stage id, slug, or name; resolved against your stages server-side. */
  pipelineStage?: string
  folderId?: string
  isFavorite?: boolean
  search?: string
  limit?: number
  offset?: number
}

/** Fields to create a post. `stage` accepts a stage id, slug, or name. */
export interface CreatePostInput {
  title: string
  platform: PostPlatform
  description?: string | null
  stage?: string | null
  folderId?: string | null
  status?: PostStatus
}

/** Fields to update a post. `stage` accepts a stage id, slug, or name. */
export interface UpdatePostInput {
  title?: string
  description?: string | null
  platform?: PostPlatform
  status?: PostStatus
  stage?: string | null
  pipelineOrder?: number
  folderId?: string | null
  isFavorite?: boolean
  coverUrl?: string | null
  scheduledAt?: string | null
  publishedAt?: string | null
  publishUrl?: string | null
  script?: string | null
  notes?: string | null
  metadata?: Record<string, unknown> | null
}

/** Fields to attach (or replace) a destination on a post. Upserts on platform. */
export interface AddDestinationInput {
  platform: PostPlatform
  format?: string
  connectedAccountId?: string | null
  scheduledAt?: string | null
  /**
   * Per-platform/per-format publish config (mediaItems, caption, thumbnails,
   * privacy, etc.). Get the exact shape for the platform + format from
   * getPlatform, then fill it here.
   */
  platformSettings?: Record<string, unknown> | null
  /** @deprecated Use platformSettings. Still accepted for back-compat. */
  platformSpecificData?: Record<string, unknown> | null
}

/** Fields to update a destination. */
export interface UpdateDestinationInput {
  format?: string
  status?: string
  connectedAccountId?: string | null
  scheduledAt?: string | null
  /**
   * Per-platform/per-format publish config (mediaItems, caption, thumbnails,
   * privacy, etc.). Get the exact shape from getPlatform, then fill it here.
   */
  platformSettings?: Record<string, unknown> | null
  /** @deprecated Use platformSettings. Still accepted for back-compat. */
  platformSpecificData?: Record<string, unknown> | null
}

/** Fields to attach an asset to a post: by URL, or by output-id (outputId). */
export interface AddAssetInput {
  /** Required with assetUrl; optional with outputId (inferred from the media type). */
  assetType?: 'image' | 'video' | 'audio' | 'document' | 'link'
  /** A public URL. Provide this or outputId. */
  assetUrl?: string
  /**
   * A media token (output id, first-8, or "-N") of generated or uploaded media,
   * resolved server-side to its URL and type. Provide this or assetUrl.
   */
  outputId?: string | null
  assetId?: string | null
  displayName?: string | null
  metadata?: Record<string, unknown> | null
}

/** The result of publishing one destination. */
export interface PublishDestinationResult {
  success: boolean
  platform: string
  destinationId: string | null
  url?: string
  error?: string
}

/** The result of `publishPost`: per-destination outcomes plus tallies. */
export interface PublishPostResult {
  postId: string
  results: PublishDestinationResult[]
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

/** A piece of tracked content (the list projection used for outliers). */
export interface Outlier {
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
}

/** Full tracked-content detail as returned by `getInspirationContent`. */
export interface InspirationContent extends Outlier {
  description: string | null
  transcript: string | null
  hashtags: string[]
  keywords: string[]
  mentions: string[]
  audioInfo: Record<string, unknown> | null
  followerCountSnapshot: number | null
}

/** One inspiration account with its content count and top outliers. */
export interface InspirationAccountDetail {
  account: TrackedAccount
  contentCount: number
  topContent: Outlier[]
}

/** Options for `listOutliers`. */
export interface ListOutliersOptions {
  platform?: string
  contentType?: string
  /** Only content scoring at or above this outlier score. */
  minOutlierScore?: number
  search?: string
  /** 'score' (default), 'date', or 'views'. */
  sortBy?: 'score' | 'date' | 'views'
  /** Scope to the inspiration accounts linked to this brand kit. */
  brandKitId?: string
  limit?: number
  offset?: number
}

/** Options for `listInspirationAccounts` / `listBrandAccounts`. */
export interface ListTrackedAccountsOptions {
  /** Scope to the accounts linked to this brand kit. */
  brandKitId?: string
}

/** Result of `listOutliers`: a page of outliers plus pagination metadata. */
export interface OutliersResult {
  outliers: Outlier[]
  total: number
  hasMore: boolean
}

/** Performance summary for one of the caller's brand accounts. */
export interface BrandAccountPerformance {
  account: TrackedAccount
  contentCount: number
  totals: { views: number; likes: number; comments: number }
  averages: { views: number | null; engagementRate: number | null; outlierScore: number | null }
  topContent: Outlier[]
  recentContent: Outlier[]
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
// Publish platforms (destination discovery)
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
 * destination's platformSettings.
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
