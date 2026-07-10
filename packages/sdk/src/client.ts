/**
 * The ContentHero client: a thin, typed wrapper over the /api/v1 surface.
 *
 * Identity is the API key. The key resolves the owning account server-side, so
 * the SDK never sends a user id. Generation is always-async on the wire; the
 * SDK offers both a fire-and-forget `generate` and a `generateAndWait` that
 * polls to a terminal state for you.
 */

import { errorFromResponse, GenerationFailedError, GenerationTimeoutError } from './errors.js'
import type {
  AddAssetInput,
  AddBrandKitSectionInput,
  AddBrandKnowledgeInput,
  AddDestinationInput,
  Avatar,
  AvatarSummary,
  Balance,
  BrandAccountPerformance,
  BrandKit,
  BrandKitSectionRecord,
  BrandKitSummary,
  BrandKnowledgeDetail,
  BrandKnowledgeItem,
  BrandKnowledgeListResult,
  BrandKnowledgeMatch,
  ConnectedAccount,
  ListTrackedAccountsOptions,
  SearchBrandKnowledgeOptions,
  CostEstimate,
  CreatePostInput,
  UpdateBrandKitInput,
  UpdateBrandKitSectionInput,
  InspirationAccountDetail,
  InspirationContent,
  ListOutliersOptions,
  Outlier,
  OutliersResult,
  TrackedAccount,
  GenerateBoardRequest,
  GenerateRequest,
  GenerateResult,
  Generation,
  ListMediaOptions,
  ListVoicesOptions,
  ListBrandKitsOptions,
  ListPostsOptions,
  FavoriteInput,
  ArchiveInput,
  ApplyEditorOpsInput,
  ApplyEditorOpsResult,
  EditorComposition,
  MediaItem,
  MediaSummary,
  CreateMediaUploadInput,
  CreateMediaUploadResult,
  ImportMediaInput,
  UploadedMedia,
  ModelInfo,
  PlatformSummary,
  PlatformSchema,
  Element,
  CreateElementRequest,
  PipelineStage,
  PostAsset,
  PostDestination,
  PostDetail,
  PostListResult,
  PostPlatform,
  PostSummary,
  Tag,
  PublishPostResult,
  TranscribeRequest,
  Transcription,
  UpdateDestinationInput,
  UpdatePostInput,
  Voice,
  VoiceSummary,
  WaitOptions,
} from './types.js'

/** Minimal fetch signature, so a custom implementation can be injected. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface ContentHeroOptions {
  /**
   * API key (`ch_live_...`). Falls back to the `CONTENTHERO_API_KEY`
   * environment variable when omitted.
   */
  apiKey?: string
  /**
   * API base URL. Falls back to `CONTENTHERO_BASE_URL`, then the production
   * host. Override for self-hosted or preview environments.
   */
  baseUrl?: string
  /** Custom fetch implementation. Defaults to the global `fetch`. */
  fetch?: FetchLike
}

const DEFAULT_BASE_URL = 'https://app.contenthero.ai'
const TERMINAL: ReadonlySet<string> = new Set(['completed', 'failed'])

export class ContentHero {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly fetchImpl: FetchLike

  constructor(options: ContentHeroOptions = {}) {
    const apiKey = options.apiKey ?? readEnv('CONTENTHERO_API_KEY')
    if (!apiKey) {
      throw new Error(
        'A ContentHero API key is required. Pass { apiKey } or set CONTENTHERO_API_KEY.',
      )
    }
    const fetchImpl = options.fetch ?? (globalThis.fetch as FetchLike | undefined)
    if (!fetchImpl) {
      throw new Error(
        'No fetch implementation found. Use Node 20+ or pass a custom fetch via { fetch }.',
      )
    }
    this.apiKey = apiKey
    this.baseUrl = (options.baseUrl ?? readEnv('CONTENTHERO_BASE_URL') ?? DEFAULT_BASE_URL).replace(
      /\/+$/,
      '',
    )
    this.fetchImpl = fetchImpl
  }

  /**
   * Submit a generation. Returns immediately. For image/video the result is
   * `status: 'processing'` (poll with `getGeneration` or use `generateAndWait`);
   * audio returns `status: 'completed'` with `outputUrls` populated.
   */
  async generate(request: GenerateRequest): Promise<GenerateResult> {
    return this.request<GenerateResult>('POST', '/api/v1/studio/generate', request)
  }

  /** Fetch the current state of a generation by its id. */
  async getGeneration(outputId: string): Promise<Generation> {
    return this.request<Generation>(
      'GET',
      `/api/v1/studio/generate/${encodeURIComponent(outputId)}`,
    )
  }

  /**
   * Submit a generation and poll until it reaches a terminal state. Resolves
   * with the completed `Generation`, throws `GenerationFailedError` if it fails,
   * or `GenerationTimeoutError` if it does not finish within `timeoutMs` (the
   * server-side job may still complete; re-poll with `getGeneration`).
   */
  async generateAndWait(request: GenerateRequest, options: WaitOptions = {}): Promise<Generation> {
    const submitted = await this.generate(request)
    return this.waitForGeneration(submitted.outputId, options)
  }

  /**
   * Submit a Reference Board: a dense multi-panel reference sheet built from a
   * source image and/or a written description (one of them is required). A board
   * is a pipeline, not a registry model, so it has its own endpoint. Returns
   * immediately with `status: 'processing'`; poll with `getGeneration` (boards
   * are ordinary outputs) or use `generateBoardAndWait`.
   */
  async generateBoard(request: GenerateBoardRequest): Promise<GenerateResult> {
    return this.request<GenerateResult>('POST', '/api/v1/studio/reference-board', request)
  }

  /**
   * Submit a board and poll until it reaches a terminal state. Same semantics as
   * `generateAndWait`. Boards render slowly (minutes), so size `timeoutMs`
   * accordingly or catch `GenerationTimeoutError` and re-poll with `getGeneration`.
   */
  async generateBoardAndWait(
    request: GenerateBoardRequest,
    options: WaitOptions = {},
  ): Promise<Generation> {
    const submitted = await this.generateBoard(request)
    return this.waitForGeneration(submitted.outputId, options)
  }

  /**
   * Estimate the credit cost of a generation without running it (the get_cost
   * preflight). Returns the same number the real generate would charge; it runs no
   * job and charges nothing. Audio covered by a BYO ElevenLabs key estimates 0.
   */
  async estimateCost(request: GenerateRequest): Promise<CostEstimate> {
    return this.request<CostEstimate>('POST', '/api/v1/studio/generate', { ...request, getCost: true })
  }

  /** Estimate the credit cost of a Reference Board without running it. */
  async estimateBoardCost(request: GenerateBoardRequest): Promise<CostEstimate> {
    return this.request<CostEstimate>('POST', '/api/v1/studio/reference-board', { ...request, getCost: true })
  }

  /**
   * Poll an already-submitted generation to a terminal state. Pass an outputId
   * from a prior `generate` / `generateBoard` (e.g. one you got back when a
   * render was still in progress). Resolves with the completed `Generation`,
   * throws `GenerationFailedError` on failure, or `GenerationTimeoutError` if it
   * does not finish within `timeoutMs` (the server-side job may still complete;
   * re-poll). Also backs `generateAndWait` / `generateBoardAndWait`.
   */
  async waitForGeneration(
    outputId: string,
    options: WaitOptions = {},
  ): Promise<Generation> {
    const { pollIntervalMs = 3000, timeoutMs = 600_000, signal } = options
    const deadline = Date.now() + timeoutMs

    while (true) {
      const generation = await this.getGeneration(outputId)
      if (generation.status === 'completed') return generation
      if (generation.status === 'failed') {
        throw new GenerationFailedError(
          generation.outputId,
          generation.error ?? 'Generation failed',
        )
      }
      if (Date.now() >= deadline) {
        throw new GenerationTimeoutError(outputId)
      }
      await sleep(pollIntervalMs, signal)
    }
  }

  /** Fetch the authenticated account's credit balance, tier, and auto-top-up state. */
  async getBalance(): Promise<Balance> {
    return this.request<Balance>('GET', '/api/v1/account/balance')
  }

  /**
   * Transcribe an audio URL to text (ElevenLabs Scribe). Synchronous: the
   * transcript comes back inline. Free (no credit charge).
   */
  async transcribe(request: TranscribeRequest): Promise<Transcription> {
    return this.request<Transcription>('POST', '/api/v1/studio/transcribe', request)
  }

  /** List the account's avatars (the list half of the list+get pair). */
  async listAvatars(): Promise<AvatarSummary[]> {
    const data = await this.request<{ avatars: AvatarSummary[] }>('GET', '/api/v1/avatars')
    return data.avatars
  }

  /** Get one avatar with its looks (the get half). Throws NotFoundError if absent. */
  async getAvatar(avatarId: string): Promise<Avatar> {
    return this.request<Avatar>('GET', `/api/v1/avatars/${encodeURIComponent(avatarId)}`)
  }

  /** List the account's saved voices (the list half of the list+get pair). */
  async listVoices(options: ListVoicesOptions = {}): Promise<VoiceSummary[]> {
    const q = new URLSearchParams()
    if (options.favorited) q.set('favorited', 'true')
    const qs = q.toString()
    const data = await this.request<{ voices: VoiceSummary[] }>(
      'GET',
      `/api/v1/voices${qs ? `?${qs}` : ''}`,
    )
    return data.voices
  }

  /** Get one voice's detail (the get half). Throws NotFoundError if absent. */
  async getVoice(voiceId: string): Promise<Voice> {
    return this.request<Voice>('GET', `/api/v1/voices/${encodeURIComponent(voiceId)}`)
  }

  /** List the account's brand kits (the list half of the list+get pair). */
  async listBrandKits(options: ListBrandKitsOptions = {}): Promise<BrandKitSummary[]> {
    const q = new URLSearchParams()
    if (options.favorited) q.set('favorited', 'true')
    if (options.archived) q.set('archived', 'true')
    const qs = q.toString()
    const data = await this.request<{ brandKits: BrandKitSummary[] }>(
      'GET',
      `/api/v1/brand-kits${qs ? `?${qs}` : ''}`,
    )
    return data.brandKits
  }

  /** Get one brand kit, fully assembled (the get half). Throws NotFoundError if absent. */
  async getBrandKit(brandKitId: string): Promise<BrandKit> {
    return this.request<BrandKit>('GET', `/api/v1/brand-kits/${encodeURIComponent(brandKitId)}`)
  }

  /**
   * Update a brand kit's identity fields (positioning, audience, voice, visual
   * style, ...). Requires a key with the `brandkit:write` scope. Returns the full
   * updated kit.
   */
  async updateBrandKit(brandKitId: string, input: UpdateBrandKitInput): Promise<BrandKit> {
    return this.request<BrandKit>('PATCH', `/api/v1/brand-kits/${encodeURIComponent(brandKitId)}`, input)
  }

  /** Add a curated section to a brand kit. Requires the `brandkit:write` scope. */
  async addBrandKitSection(brandKitId: string, input: AddBrandKitSectionInput): Promise<BrandKitSectionRecord> {
    const data = await this.request<{ section: BrandKitSectionRecord }>(
      'POST',
      `/api/v1/brand-kits/${encodeURIComponent(brandKitId)}/sections`,
      input,
    )
    return data.section
  }

  /** Update a brand-kit section. Requires the `brandkit:write` scope. */
  async updateBrandKitSection(
    brandKitId: string,
    sectionId: string,
    input: UpdateBrandKitSectionInput,
  ): Promise<BrandKitSectionRecord> {
    const data = await this.request<{ section: BrandKitSectionRecord }>(
      'PATCH',
      `/api/v1/brand-kits/${encodeURIComponent(brandKitId)}/sections/${encodeURIComponent(sectionId)}`,
      input,
    )
    return data.section
  }

  // -------------------------------------------------------------------------
  // Brand knowledge (a brand kit's knowledge base)
  // -------------------------------------------------------------------------

  /** The complete, paginated index of a brand kit's knowledge items. Requires `brandkit:read`. */
  async listBrandKnowledge(
    brandKitId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<BrandKnowledgeListResult> {
    const q = new URLSearchParams()
    if (options.limit != null) q.set('limit', String(options.limit))
    if (options.offset != null) q.set('offset', String(options.offset))
    const qs = q.toString()
    return this.request<BrandKnowledgeListResult>(
      'GET',
      `/api/v1/brand-kits/${encodeURIComponent(brandKitId)}/knowledge${qs ? `?${qs}` : ''}`,
    )
  }

  /** Get one knowledge item with its stored body. Requires `brandkit:read`. */
  async getBrandKnowledge(brandKitId: string, knowledgeId: string): Promise<BrandKnowledgeDetail> {
    const data = await this.request<{ item: BrandKnowledgeDetail }>(
      'GET',
      `/api/v1/brand-kits/${encodeURIComponent(brandKitId)}/knowledge/${encodeURIComponent(knowledgeId)}`,
    )
    return data.item
  }

  /** Semantic search over a brand kit's knowledge base. Requires `brandkit:read`. */
  async searchBrandKnowledge(
    brandKitId: string,
    query: string,
    options: SearchBrandKnowledgeOptions = {},
  ): Promise<BrandKnowledgeMatch[]> {
    const q = new URLSearchParams({ q: query })
    if (options.limit != null) q.set('limit', String(options.limit))
    if (options.threshold != null) q.set('threshold', String(options.threshold))
    const data = await this.request<{ matches: BrandKnowledgeMatch[] }>(
      'GET',
      `/api/v1/brand-kits/${encodeURIComponent(brandKitId)}/knowledge/search?${q.toString()}`,
    )
    return data.matches
  }

  /** Add an item to a brand kit's knowledge base (text/url/youtube/file). Requires `brandkit:write`. */
  async addBrandKnowledge(brandKitId: string, input: AddBrandKnowledgeInput): Promise<BrandKnowledgeItem> {
    const data = await this.request<{ item: BrandKnowledgeItem }>(
      'POST',
      `/api/v1/brand-kits/${encodeURIComponent(brandKitId)}/knowledge`,
      input,
    )
    return data.item
  }

  /** Remove a knowledge item and its embedding chunks. Requires `brandkit:write`. */
  async removeBrandKnowledge(brandKitId: string, knowledgeId: string): Promise<{ id: string }> {
    return this.request<{ id: string }>(
      'DELETE',
      `/api/v1/brand-kits/${encodeURIComponent(brandKitId)}/knowledge/${encodeURIComponent(knowledgeId)}`,
    )
  }

  /** List the account's recent studio outputs (the list half of the list+get pair). */
  async listMedia(options: ListMediaOptions = {}): Promise<MediaSummary[]> {
    const q = new URLSearchParams()
    if (options.contentType) {
      const types = Array.isArray(options.contentType) ? options.contentType : [options.contentType]
      q.set('contentType', types.join(','))
    }
    if (options.status) q.set('status', options.status)
    if (options.kind) q.set('kind', options.kind)
    if (options.favorited) q.set('favorited', 'true')
    if (options.archived) q.set('archived', 'true')
    if (options.limit != null) q.set('limit', String(options.limit))
    if (options.offset != null) q.set('offset', String(options.offset))
    const qs = q.toString()
    const data = await this.request<{ media: MediaSummary[] }>(
      'GET',
      `/api/v1/media${qs ? `?${qs}` : ''}`,
    )
    return data.media
  }

  /**
   * Get one studio output by id token (the get half). The token may be the full
   * output id, its first 8 characters, or either with a `-N` variation suffix
   * (1-based). Throws NotFoundError if absent.
   */
  async getMedia(idToken: string): Promise<MediaItem> {
    return this.request<MediaItem>('GET', `/api/v1/media/${encodeURIComponent(idToken)}`)
  }

  // -------------------------------------------------------------------------
  // Media upload (bring your own file or URL -> first-class media)
  // -------------------------------------------------------------------------

  /**
   * Start a presigned upload (phase 1): pre-creates the media row and returns a
   * signed uploadUrl. PUT the bytes to uploadUrl (with the file's Content-Type),
   * then call completeMediaUpload(outputId). Prefer uploadMedia() which does all
   * three steps.
   */
  async createMediaUpload(input: CreateMediaUploadInput): Promise<CreateMediaUploadResult> {
    return this.request<CreateMediaUploadResult>('POST', '/api/v1/media/uploads', input)
  }

  /** Finalize a presigned upload (phase 2) after the bytes were PUT to uploadUrl. */
  async completeMediaUpload(outputId: string): Promise<UploadedMedia> {
    return this.request<UploadedMedia>(
      'POST',
      `/api/v1/media/uploads/${encodeURIComponent(outputId)}/complete`,
    )
  }

  /**
   * Upload a file as first-class media in one call: create -> PUT the bytes to the
   * signed URL -> complete. Returns the new media (referenceable by outputId in
   * generations and post assets). `data` is the raw bytes (Blob, Buffer, Uint8Array,
   * or ArrayBuffer). For a remote URL you already have, use importMedia instead.
   */
  async uploadMedia(
    data: Blob | ArrayBuffer | ArrayBufferView,
    opts: { fileName: string; contentType: string },
  ): Promise<UploadedMedia> {
    const sizeBytes =
      data instanceof Blob
        ? data.size
        : data instanceof ArrayBuffer
          ? data.byteLength
          : data.byteLength
    const created = await this.createMediaUpload({
      fileName: opts.fileName,
      contentType: opts.contentType,
      sizeBytes,
    })
    // The PUT goes to Supabase storage (not our API), so it uses a bare fetch
    // with only the file's Content-Type, none of our auth headers.
    const put = await this.fetchImpl(created.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': opts.contentType },
      body: data as BodyInit,
    })
    if (!put.ok) {
      const detail = await put.text().catch(() => '')
      throw new Error(`Upload PUT failed (HTTP ${put.status})${detail ? `: ${detail}` : ''}`)
    }
    return this.completeMediaUpload(created.outputId)
  }

  /**
   * Import a remote URL as first-class media: the server fetches and re-hosts it.
   * Use when the file is already on a public URL (or from an environment that can't
   * read local files). Returns the new media, referenceable by outputId.
   */
  async importMedia(input: ImportMediaInput): Promise<UploadedMedia> {
    return this.request<UploadedMedia>('POST', '/api/v1/media/imports', input)
  }

  /**
   * List the models available to this key (the discovery catalog): which models
   * exist, their content type and operation kind, and their capability surface.
   * The source of truth for building model selections instead of hardcoding ids.
   */
  async listModels(options: { contentType?: 'image' | 'video' | 'audio' } = {}): Promise<ModelInfo[]> {
    const query = options.contentType ? `?contentType=${options.contentType}` : ''
    const data = await this.request<{ models: ModelInfo[] }>('GET', `/api/v1/models${query}`)
    return data.models
  }

  /**
   * Get one model's full request shape by id: the exact parameters it accepts
   * (input types, modes, duration range, resolutions, aspect ratios, max refs,
   * generation count, promptMode, promptMaxChars, features). Use this to ground
   * a generation against the model's real capabilities instead of guessing.
   * Throws NotFoundError for an unknown, disabled, or hidden model id.
   */
  async getModel(modelId: string): Promise<ModelInfo> {
    return this.request<ModelInfo>('GET', `/api/v1/models/${encodeURIComponent(modelId)}`)
  }

  // -------------------------------------------------------------------------
  // Publish platforms (destination discovery)
  // -------------------------------------------------------------------------

  /**
   * List the platforms this account can publish to (the discovery catalog):
   * their formats, and whether a connected account exists for each. The source
   * of truth for valid platforms/formats; call getPlatform for one platform's
   * full request shape before configuring a destination.
   */
  async listPlatforms(): Promise<PlatformSummary[]> {
    const data = await this.request<{ platforms: PlatformSummary[] }>('GET', '/api/v1/platforms')
    return data.platforms
  }

  /**
   * Get one platform's full publishing shape: the fields, options (enums), and
   * character limits a post requires per format. Use this to construct a
   * destination's platformSettings against the platform's real fields instead of
   * guessing. Optionally narrow to one format. Throws NotFoundError for an
   * unknown platform.
   */
  async getPlatform(platform: string, options: { format?: string } = {}): Promise<PlatformSchema> {
    const query = options.format ? `?format=${encodeURIComponent(options.format)}` : ''
    return this.request<PlatformSchema>(
      'GET',
      `/api/v1/platforms/${encodeURIComponent(platform)}${query}`,
    )
  }

  // -------------------------------------------------------------------------
  // Reference elements (named reference library, Kling 3.0)
  // -------------------------------------------------------------------------

  /** List the account's saved reference elements (newest first). */
  async listElements(): Promise<Element[]> {
    const data = await this.request<{ elements: Element[] }>('GET', '/api/v1/elements')
    return data.elements
  }

  /** Get one saved reference element by id. */
  async getElement(id: string): Promise<Element> {
    return this.request<Element>('GET', `/api/v1/elements/${encodeURIComponent(id)}`)
  }

  /**
   * Create a reusable reference element from 2-4 images (or 1 video). Inputs may
   * be URLs or output-id tokens (generate the angle shots first, then assemble).
   * Reference it later in a Kling generation via references.elements [{ elementId }].
   */
  async createElement(request: CreateElementRequest): Promise<Element> {
    return this.request<Element>('POST', '/api/v1/elements', request)
  }

  /** Update a saved element's name / description / category. */
  async updateElement(
    id: string,
    patch: { name?: string; description?: string; category?: string },
  ): Promise<Element> {
    return this.request<Element>('PATCH', `/api/v1/elements/${encodeURIComponent(id)}`, patch)
  }

  /** Delete a saved element. */
  async deleteElement(id: string): Promise<{ deleted: boolean; id: string }> {
    return this.request<{ deleted: boolean; id: string }>('DELETE', `/api/v1/elements/${encodeURIComponent(id)}`)
  }

  // -------------------------------------------------------------------------
  // Content pipeline (posts)
  // -------------------------------------------------------------------------

  /** List the account's posts (most recently updated first), with optional filters. */
  async listPosts(options: ListPostsOptions = {}): Promise<PostListResult> {
    const q = new URLSearchParams()
    if (options.status) q.set('status', options.status)
    if (options.platform) q.set('platform', options.platform)
    if (options.pipelineStage) q.set('pipeline_stage', options.pipelineStage)
    if (options.folderId) q.set('folder_id', options.folderId)
    if (options.isFavorite) q.set('is_favorite', 'true')
    if (options.search) q.set('search', options.search)
    if (options.limit != null) q.set('limit', String(options.limit))
    if (options.offset != null) q.set('offset', String(options.offset))
    const qs = q.toString()
    return this.request<PostListResult>('GET', `/api/v1/posts${qs ? `?${qs}` : ''}`)
  }

  /** Get one post with its assets and destinations. Throws NotFoundError if absent. */
  async getPost(postId: string): Promise<PostDetail> {
    const data = await this.request<{ post: PostDetail }>(
      'GET',
      `/api/v1/posts/${encodeURIComponent(postId)}`,
    )
    return data.post
  }

  /** Create a post. `stage` accepts a stage id, slug, or name (defaults to the first stage). */
  async createPost(input: CreatePostInput): Promise<PostSummary> {
    const data = await this.request<{ post: PostSummary }>('POST', '/api/v1/posts', input)
    return data.post
  }

  /** Update a post's fields. `stage` accepts a stage id, slug, or name. */
  async updatePost(postId: string, input: UpdatePostInput): Promise<PostSummary> {
    const data = await this.request<{ post: PostSummary }>(
      'PATCH',
      `/api/v1/posts/${encodeURIComponent(postId)}`,
      input,
    )
    return data.post
  }

  /**
   * List the account's pipeline stages (sorted), seeding the defaults on first
   * access. Use this to resolve a stage before placing a post; stages are
   * per-account customizable.
   */
  async listPipelineStages(): Promise<PipelineStage[]> {
    const data = await this.request<{ stages: PipelineStage[] }>('GET', '/api/v1/pipeline-stages')
    return data.stages
  }

  /** Attach (or replace) a destination on a post. Upserts on platform. */
  async addPostDestination(postId: string, input: AddDestinationInput): Promise<PostDestination> {
    const data = await this.request<{ destination: PostDestination }>(
      'POST',
      `/api/v1/posts/${encodeURIComponent(postId)}/destinations`,
      input,
    )
    return data.destination
  }

  /** Update one of a post's destinations. */
  async updatePostDestination(
    postId: string,
    destinationId: string,
    input: UpdateDestinationInput,
  ): Promise<PostDestination> {
    const data = await this.request<{ destination: PostDestination }>(
      'PATCH',
      `/api/v1/posts/${encodeURIComponent(postId)}/destinations?destination_id=${encodeURIComponent(destinationId)}`,
      input,
    )
    return data.destination
  }

  /** Attach an asset to a post by URL or outputId. */
  async addPostAsset(postId: string, input: AddAssetInput): Promise<PostAsset> {
    const data = await this.request<{ asset: PostAsset }>(
      'POST',
      `/api/v1/posts/${encodeURIComponent(postId)}/assets`,
      input,
    )
    return data.asset
  }

  /**
   * Reorder a post's assets (e.g. carousel slide order). `assetIds` must list all
   * of the post's asset ids in the desired order. Returns the assets reordered.
   */
  async reorderPostAssets(postId: string, assetIds: string[]): Promise<PostAsset[]> {
    const data = await this.request<{ assets: PostAsset[] }>(
      'PATCH',
      `/api/v1/posts/${encodeURIComponent(postId)}/assets`,
      { assetIds },
    )
    return data.assets
  }

  /** Detach an asset from a post. */
  async removePostAsset(postId: string, assetId: string): Promise<{ id: string }> {
    return this.request<{ id: string }>(
      'DELETE',
      `/api/v1/posts/${encodeURIComponent(postId)}/assets?asset_id=${encodeURIComponent(assetId)}`,
    )
  }

  /** Detach a destination from a post. */
  async removePostDestination(postId: string, destinationId: string): Promise<{ id: string }> {
    return this.request<{ id: string }>(
      'DELETE',
      `/api/v1/posts/${encodeURIComponent(postId)}/destinations?destination_id=${encodeURIComponent(destinationId)}`,
    )
  }

  // -------------------------------------------------------------------------
  // Tags (the organizational tag library; set a post's tags via the `tags`
  // field on createPost / updatePost)
  // -------------------------------------------------------------------------

  /** List the account's tags. */
  async listTags(): Promise<Tag[]> {
    const data = await this.request<{ tags: Tag[] }>('GET', '/api/v1/tags')
    return data.tags
  }

  /** Create a tag (the name is lowercased). Throws if it already exists. */
  async createTag(name: string): Promise<Tag> {
    const data = await this.request<{ tag: Tag }>('POST', '/api/v1/tags', { name })
    return data.tag
  }

  /** Rename a tag (preserves its post assignments). */
  async updateTag(id: string, name: string): Promise<Tag> {
    const data = await this.request<{ tag: Tag }>(
      'PATCH',
      `/api/v1/tags/${encodeURIComponent(id)}`,
      { name },
    )
    return data.tag
  }

  /** Delete a tag from the account (cascades off every post). */
  async deleteTag(id: string): Promise<{ id: string }> {
    return this.request<{ id: string }>('DELETE', `/api/v1/tags/${encodeURIComponent(id)}`)
  }

  /**
   * Schedule a post: set (or clear, with null) the publish time on the post and
   * all its destinations. This queues; publishing now is `publishPost`.
   */
  async schedulePost(postId: string, scheduledAt: string | null): Promise<PostSummary> {
    const data = await this.request<{ post: PostSummary }>(
      'POST',
      `/api/v1/posts/${encodeURIComponent(postId)}/schedule`,
      { scheduledAt },
    )
    return data.post
  }

  /**
   * Publish a post NOW. Publishes a single platform when `platform` is given,
   * otherwise every destination. Requires a key with the `publish:write` scope.
   * Each destination publishes independently; check per-destination results.
   */
  async publishPost(postId: string, options: { platform?: PostPlatform } = {}): Promise<PublishPostResult> {
    return this.request<PublishPostResult>(
      'POST',
      `/api/v1/posts/${encodeURIComponent(postId)}/publish`,
      options.platform ? { platform: options.platform } : {},
    )
  }

  // -------------------------------------------------------------------------
  // Inspiration / research reads
  // -------------------------------------------------------------------------

  /** List the account's tracked inspiration accounts (creators/competitors). */
  async listInspirationAccounts(options: ListTrackedAccountsOptions = {}): Promise<TrackedAccount[]> {
    const qs = options.brandKitId ? `?brand_kit_id=${encodeURIComponent(options.brandKitId)}` : ''
    const data = await this.request<{ accounts: TrackedAccount[] }>('GET', `/api/v1/inspiration/accounts${qs}`)
    return data.accounts
  }

  /** Get one inspiration account with its content count and top outliers. */
  async getInspirationAccount(accountId: string): Promise<InspirationAccountDetail> {
    return this.request<InspirationAccountDetail>(
      'GET',
      `/api/v1/inspiration/accounts/${encodeURIComponent(accountId)}`,
    )
  }

  /** List top-performing content from the creators the account tracks, by outlier score. */
  async listOutliers(options: ListOutliersOptions = {}): Promise<OutliersResult> {
    const q = new URLSearchParams()
    if (options.platform) q.set('platform', options.platform)
    if (options.contentType) q.set('content_type', options.contentType)
    if (options.minOutlierScore != null) q.set('min_outlier_score', String(options.minOutlierScore))
    if (options.search) q.set('search', options.search)
    if (options.sortBy) q.set('sort_by', options.sortBy)
    if (options.brandKitId) q.set('brand_kit_id', options.brandKitId)
    if (options.favorited) q.set('favorited', 'true')
    if (options.limit != null) q.set('limit', String(options.limit))
    if (options.offset != null) q.set('offset', String(options.offset))
    const qs = q.toString()
    return this.request<OutliersResult>('GET', `/api/v1/inspiration/outliers${qs ? `?${qs}` : ''}`)
  }

  /** Get one tracked-content item in full (incl. transcript, engagement, hashtags). */
  async getInspirationContent(contentId: string): Promise<InspirationContent> {
    const data = await this.request<{ content: InspirationContent }>(
      'GET',
      `/api/v1/inspiration/content/${encodeURIComponent(contentId)}`,
    )
    return data.content
  }

  /** List the account's own brand social accounts (the basis for own-performance reads). */
  async listBrandAccounts(options: ListTrackedAccountsOptions = {}): Promise<TrackedAccount[]> {
    const qs = options.brandKitId ? `?brand_kit_id=${encodeURIComponent(options.brandKitId)}` : ''
    const data = await this.request<{ accounts: TrackedAccount[] }>('GET', `/api/v1/brand-accounts${qs}`)
    return data.accounts
  }

  /** Get the performance summary for one of the account's brand accounts. */
  async getBrandAccountPerformance(accountId: string): Promise<BrandAccountPerformance> {
    return this.request<BrandAccountPerformance>(
      'GET',
      `/api/v1/brand-accounts/${encodeURIComponent(accountId)}/performance`,
    )
  }

  // -------------------------------------------------------------------------
  // Connected accounts (publish targets)
  // -------------------------------------------------------------------------

  /** List the account's connected social accounts (publish targets), default first. */
  async listConnectedAccounts(): Promise<ConnectedAccount[]> {
    const data = await this.request<{ accounts: ConnectedAccount[] }>('GET', '/api/v1/connected-accounts')
    return data.accounts
  }

  /** Get one connected account by id. Throws NotFoundError if absent. */
  async getConnectedAccount(accountId: string): Promise<ConnectedAccount> {
    const data = await this.request<{ account: ConnectedAccount }>(
      'GET',
      `/api/v1/connected-accounts/${encodeURIComponent(accountId)}`,
    )
    return data.account
  }

  // -------------------------------------------------------------------------
  // Favorites & archive (universal set/clear across asset types)
  // -------------------------------------------------------------------------

  /**
   * Mark an asset as favorited. Requires the `favorites:write` scope.
   *
   * Pass `{ assetType, id }` for a top-level asset (post, voice, brand_kit,
   * project, inspiration_content, gallery), or `{ id, variationIndex }` to
   * favorite a single studio output variation slot (id is a studio output id).
   * Idempotent.
   */
  async favorite(input: FavoriteInput): Promise<void> {
    await this.request<{ favorited: boolean }>('POST', '/api/v1/favorite', input)
  }

  /**
   * Clear the favorite flag on an asset. Requires the `favorites:write` scope.
   * Same target shape as `favorite`. Idempotent.
   */
  async unfavorite(input: FavoriteInput): Promise<void> {
    await this.request<{ favorited: boolean }>('POST', '/api/v1/unfavorite', input)
  }

  /**
   * Archive an asset. Requires the `favorites:write` scope.
   *
   * Pass `{ assetType, id }` for a top-level asset (post, brand_kit,
   * brand_kit_section, project), or `{ id, variationIndex }` to archive a single
   * studio output variation slot. Archiving a post sets its status to 'archived'.
   * Idempotent.
   */
  async archive(input: ArchiveInput): Promise<void> {
    await this.request<{ archived: boolean }>('POST', '/api/v1/archive', input)
  }

  /**
   * Unarchive an asset. Requires the `favorites:write` scope. Same target shape
   * as `archive`. Unarchiving a post restores it to 'draft'. Idempotent.
   */
  async unarchive(input: ArchiveInput): Promise<void> {
    await this.request<{ archived: boolean }>('POST', '/api/v1/unarchive', input)
  }

  // -------------------------------------------------------------------------
  // Editor / canvas ops (programmatic parity with the manual UI + in-app agent)
  // -------------------------------------------------------------------------

  /**
   * Apply a batch of ops to a project's composition (canvas slides or editor timeline) and persist
   * atomically. The project `kind` selects the surface; the ops run through the same reducers the manual
   * UI and in-app agent use. Requires the `editor:write` scope.
   *
   * Optimistic concurrency: pass `expectedRevision` (from `getEditorComposition`) to fail with a 409
   * ConflictError if a concurrent edit landed, instead of clobbering it. Returns the new revision and the
   * per-op results (a bad op is reported, never throws).
   */
  async applyEditorOps(input: ApplyEditorOpsInput): Promise<ApplyEditorOpsResult> {
    return this.request<ApplyEditorOpsResult>('POST', '/api/v1/editor/ops', input)
  }

  /**
   * Read a project's current composition + revision, to read-before-write. Pass the returned `revision`
   * back as `applyEditorOps`'s `expectedRevision`. Requires the `editor:read` scope.
   */
  async getEditorComposition(projectId: string): Promise<EditorComposition> {
    return this.request<EditorComposition>('GET', `/api/v1/editor/${encodeURIComponent(projectId)}`)
  }

  /** Issue an authenticated request and map non-2xx responses to typed errors. */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json'

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    const text = await response.text()
    let data: unknown = undefined
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }
    }

    if (!response.ok) {
      throw errorFromResponse(response.status, data)
    }
    return data as T
  }
}

/** Read an env var without assuming `process` exists (keeps non-Node bundles happy). */
function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env
  return env?.[name]
}

/** Promise-based delay that rejects if the provided signal aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('Aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
