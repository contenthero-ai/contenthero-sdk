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
  AddDestinationInput,
  Avatar,
  AvatarSummary,
  Balance,
  BrandKit,
  BrandKitSummary,
  CostEstimate,
  CreatePostInput,
  GenerateBoardRequest,
  GenerateRequest,
  GenerateResult,
  Generation,
  ListMediaOptions,
  ListPostsOptions,
  MediaItem,
  MediaSummary,
  ModelInfo,
  PipelineStage,
  PostAsset,
  PostDestination,
  PostDetail,
  PostListResult,
  PostPlatform,
  PostSummary,
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
  async listVoices(): Promise<VoiceSummary[]> {
    const data = await this.request<{ voices: VoiceSummary[] }>('GET', '/api/v1/voices')
    return data.voices
  }

  /** Get one voice's detail (the get half). Throws NotFoundError if absent. */
  async getVoice(voiceId: string): Promise<Voice> {
    return this.request<Voice>('GET', `/api/v1/voices/${encodeURIComponent(voiceId)}`)
  }

  /** List the account's brand kits (the list half of the list+get pair). */
  async listBrandKits(): Promise<BrandKitSummary[]> {
    const data = await this.request<{ brandKits: BrandKitSummary[] }>('GET', '/api/v1/brand-kits')
    return data.brandKits
  }

  /** Get one brand kit, fully assembled (the get half). Throws NotFoundError if absent. */
  async getBrandKit(brandKitId: string): Promise<BrandKit> {
    return this.request<BrandKit>('GET', `/api/v1/brand-kits/${encodeURIComponent(brandKitId)}`)
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

  /** Archive a post (status -> 'archived'). No hard delete. */
  async archivePost(postId: string): Promise<PostSummary> {
    return this.updatePost(postId, { status: 'archived' })
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

  /** Attach an asset to a post by URL (file uploads stay web-only). */
  async addPostAsset(postId: string, input: AddAssetInput): Promise<PostAsset> {
    const data = await this.request<{ asset: PostAsset }>(
      'POST',
      `/api/v1/posts/${encodeURIComponent(postId)}/assets`,
      input,
    )
    return data.asset
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
