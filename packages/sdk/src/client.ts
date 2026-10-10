/**
 * The ContentHero client: a thin, typed wrapper over the /api/v1 surface.
 *
 * Identity is the API key. The key resolves the owning account server-side, so
 * the SDK never sends a user id. Generation is always-async on the wire; the
 * SDK offers both a fire-and-forget `generate` and a `generateAndWait` that
 * polls to a terminal state for you.
 */

import {
  errorFromResponse,
  GenerationFailedError,
  GenerationInterruptedError,
  GenerationTimeoutError,
} from './errors.js'
import type {
  Folder,
  FolderContents,
  GetFolderOptions,
  MediaListResult,
  PageOptions,
  ProjectListResult,
  SearchMediaPage,
  CreateFolderInput,
  UpdateFolderInput,
  BrandKitAccountInput,
  AddBrandKnowledgeInput,
  AddBrandKnowledgeResult,
  Avatar,
  CreateAvatarRequest,
  CreateAvatarResult,
  UpdateAvatarRequest,
  UpdateAvatarResult,
  AddAvatarLooksResult,
  Account,
  AccountUpdate,
  BrandKit,
  BrandKitSummaryRead,
  BrandKitSectionFilter,
  BrandKitSectionsRead,
  BrandKnowledgeDetail,
  BrandKnowledgeItem,
  BrandKnowledgeListResult,
  BrandKnowledgeMatch,
  ConnectedAccount,
  ListTrackedAccountsOptions,
  ListContentOptions,
  GetContentOptions,
  ContentListResult,
  ContentDetail,
  ContentAnalysisResult,
  ContentAnalysisKind,
  ContentScenesResult,
  TrackedAccountDetail,
  SearchBrandKnowledgeOptions,
  CostEstimate,
  CreateCardInput,
  UpdateBrandKitInput,
  CreateBrandKitInput,
  BrandImportOutcome,
  GenerateBoardRequest,
  GenerateRequest,
  GenerateResult,
  Generation,
  EditAudioRequest,
  EditAudioResult,
  ListMediaOptions,
  ListVoicesOptions,
  ListBrandKitsOptions,
  ListCardsOptions,
  ListStagesOptions,
  FavoriteInput,
  ShareProjectInput,
  ProjectShare,
  ShareMediaInput,
  MediaShare,
  ArchiveInput,
  ApplyEditorOpsInput,
  ApplyEditorOpsResult,
  ProjectDetail,
  LiveContextResult,
  GetContextInput,
  ListProjectsInput,
  CreateProjectInput,
  ImportProjectInput,
  StartExportInput,
  ExportJob,
  ExportFormatCatalog,
  LinkFormats,
  CodeGuide,
  EffectList,
  EffectDetail,
  LayerTypeCatalog,
  TimelineTypeCatalog,
  TimelineSchemaIndex,
  TimelineSchemaEntry,
  EditorSchemaOptions,
  LayerSchemaIndex,
  LayerSchemaEntry,
  TypeCatalogOptions,
  TranscriptResult,
  MediaItem,
  MediaSource,
  SearchMediaOptions,
  MediaBatchItem,
  MediaBatchResult,
  CreateMediaUploadInput,
  CreateMediaUploadResult,
  ImportMediaInput,
  ImportedMedia,
  ImportStarted,
  UploadedMedia,
  ModelInfo,
  PlatformSummary,
  PlatformSchema,
  KlingElement,
  CreateKlingElementRequest,
  Template,
  ListTemplatesOptions,
  TemplateListResult,
  TemplateFields,
  CreateTemplateRequest,
  TemplateWriteResult,
  Stage,
  Space,
  CardAsset,
  Post,
  CardDetail,
  CardListResult,
  StageListResult,
  PostPlatform,
  CardSummary,
  Tag,
  PublishResult,
  TranscribeRequest,
  Transcription,
  UpdateCardInput,
  PostInput,
  CardAssetInput,
  Voice,
  WaitOptions,
  KlingElementListResult,
  ListTemplateCategoriesOptions,
  TemplateCategoryListResult,
  AvatarListResult,
  VoiceListResult,
  BrandKitListResult,
  FolderListResult,
  TagListResult,
  ListSpacesOptions,
  SpaceListResult,
  TrackedAccountListResult,
  ConnectedAccountListResult,
  UpdateProjectInput,
  TimelineSettings,
  TimelineSettingsChange,
  ProjectVersionListResult,
  ProjectExportListResult,
  SavedProjectVersion,
  RestoredProjectVersion,
  UndoInput,
  RedoInput,
  UndoResult,
  SortOptions,
  ProjectSummary,
  Placement,
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
  /**
   * The resolved API base url: explicit option, then CONTENTHERO_BASE_URL, then the stored config, then
   * production.
   *
   * ⚠️ PUBLIC so callers can build links against the SAME server this client talks to. The MCP widget's
   * Open button needs it, and resolving it a second time from the environment would disagree the moment
   * someone is authenticated through the config file rather than an env var.
   */
  readonly baseUrl: string
  private readonly fetchImpl: FetchLike
  /** Per-project last-touched timestamp (ms). Presence is lit SERVER-SIDE (every project-scoped route broadcasts
   *  the badge), so this no longer drives per-call pings; it records which projects this client operated on so
   *  releaseProjectActivity / flushRelease can clear their badges promptly on exit, and debounces any explicit
   *  touchProjectActivity ping. */
  private readonly activityPingedAt = new Map<string, number>()
  /** Min gap between explicit presence pings for the same project, so a burst does not spam. */
  private static readonly ACTIVITY_DEBOUNCE_MS = 10_000

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
   * Explicitly signal PRESENCE for a project. Presence is normally lit SERVER-SIDE now (every project-scoped API
   * route broadcasts the "Editing via MCP/CLI" badge for the resolved project), so the SDK's own methods no longer
   * each call this. It remains for an external consumer that wants to signal presence ahead of working on a
   * project, and it records the project for prompt release on exit. Debounced + fire-and-forget: never throws,
   * never blocks, no-op without a projectId.
   */
  touchProjectActivity(projectId?: string | null): void {
    if (!projectId) return
    const now = Date.now()
    const last = this.activityPingedAt.get(projectId) ?? 0
    if (now - last < ContentHero.ACTIVITY_DEBOUNCE_MS) return
    this.activityPingedAt.set(projectId, now)
    void this.request('POST', '/api/v1/editor/activity', { projectId }).catch(() => {})
  }

  /**
   * Explicitly RELEASE presence so the badge clears promptly (no TTL lingering). Use in a `finally` when a
   * short-lived consumer (the CLI) finishes a command. Fire-and-forget.
   */
  releaseProjectActivity(projectId?: string | null): void {
    if (!projectId) return
    this.activityPingedAt.delete(projectId)
    void this.request('POST', '/api/v1/editor/activity', { projectId, release: true }).catch(() => {})
  }

  /**
   * AWAIT a presence release for every project this client pinged. The CLI calls this before the process exits
   * so the badge clears immediately (a short-lived process cannot rely on the sliding TTL). Best-effort:
   * resolves even if the releases fail.
   */
  async flushRelease(): Promise<void> {
    const ids = [...this.activityPingedAt.keys()]
    this.activityPingedAt.clear()
    await Promise.all(
      ids.map((projectId) =>
        this.request('POST', '/api/v1/editor/activity', { projectId, release: true }).catch(() => {}),
      ),
    )
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
  async getGeneration(outputId: string, init: { signal?: AbortSignal } = {}): Promise<Generation> {
    return this.request<Generation>(
      'GET',
      `/api/v1/studio/generate/${encodeURIComponent(outputId)}`,
      undefined,
      init,
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
    const gen = await this.#waitAfterSubmit(submitted.outputId, options)
    // Carry the placement outcome (known at submit time) through to the completed record so the caller learns
    // where the asset landed + its id for chaining, without a separate lookup.
    return submitted.placement ? { ...gen, placement: submitted.placement } : gen
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
    return this.#waitAfterSubmit(submitted.outputId, options)
  }

  /**
   * Poll a job that has ALREADY been submitted, converting any non-terminal failure into
   * an error that still carries the outputId.
   *
   * Once the POST succeeds the job is running and charged, so the outputId is the only
   * thing standing between a transient poll failure and a duplicate generation: a caller
   * that loses it has no way to resume and will almost certainly resubmit. A genuine
   * `GenerationFailedError` is terminal and passes through untouched.
   */
  async #waitAfterSubmit(outputId: string, options: WaitOptions): Promise<Generation> {
    try {
      return await this.waitForGeneration(outputId, options)
    } catch (err) {
      if (err instanceof GenerationFailedError || err instanceof GenerationTimeoutError) throw err
      throw new GenerationInterruptedError(outputId, err)
    }
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
   * render was still in progress). Resolves with the completed `Generation` (or an
   * `abandoned` one, which is terminal without being a failure),
   * throws `GenerationFailedError` on failure, or `GenerationTimeoutError` if it
   * does not finish within `timeoutMs` (the server-side job may still complete;
   * re-poll). Also backs `generateAndWait` / `generateBoardAndWait`.
   */
  async waitForGeneration(
    outputId: string,
    options: WaitOptions = {},
  ): Promise<Generation> {
    return this.#pollWithin(
      (signal) => this.getGeneration(outputId, { signal }),
      (generation) => {
        options.onPoll?.(generation)
        // Terminal only when SETTLED: a placement-bearing generation is not "done" for a caller until its swap /
        // cutout side-effect has landed (see Generation.settled). `settled !== false` keeps older servers (which
        // omit the field) working as before, and a no-placement output is settled the moment it completes.
        if (generation.status === 'completed' && generation.settled !== false) return true
        // Terminal without being a failure: set aside with no output of its own (see GenerationStatus).
        if (generation.status === 'abandoned') return true
        if (generation.status === 'failed') {
          throw new GenerationFailedError(generation.outputId, generation.error ?? 'Generation failed', { generation })
        }
        return false
      },
      options,
      (last) => new GenerationTimeoutError(outputId, undefined, last),
    )
  }

  /**
   * Wait for several generations under one deadline. Each comes back settled, failed, or as last read when the
   * deadline came, so one slow or failed generation never hides the others: read each `status`. A transient read
   * error on one id falls back to a single snapshot within the same deadline, and throws only when that fails too.
   */
  async waitForGenerations(outputIds: string[], options: WaitOptions = {}): Promise<Generation[]> {
    const deadline = Date.now() + (options.timeoutMs ?? 600_000)
    return Promise.all(
      outputIds.map(async (id) => {
        try {
          return await this.waitForGeneration(id, { ...options, timeoutMs: Math.max(0, deadline - Date.now()) })
        } catch (err) {
          if (err instanceof GenerationTimeoutError && err.lastStatus) return err.lastStatus
          if (err instanceof GenerationFailedError && err.generation) return err.generation
          const timer = deadlineSignal(deadline, options.signal)
          try {
            return await this.getGeneration(id, { signal: timer.signal })
          } catch {
            throw err
          } finally {
            timer.release()
          }
        }
      }),
    )
  }

  /**
   * Read until `settled` says the item is done, within ONE deadline nothing runs past: a read still in flight at the
   * deadline is cut, and the last pause is shortened to fit. The one poll loop behind every wait in this client.
   *
   * It used to check the deadline only after each read and then pause a full interval, with no limit on the read
   * itself, so a 50 second wait could run for a minute or more and an MCP call built on it ran past its host's 60
   * second ceiling (7.49). `timedOut` builds the error from the last value read, so the caller can show progress
   * without reading again.
   */
  async #pollWithin<T>(
    read: (signal: AbortSignal) => Promise<T>,
    settled: (value: T) => boolean,
    options: WaitOptions,
    timedOut: (last: T | undefined) => Error,
  ): Promise<T> {
    const { pollIntervalMs = 3000, timeoutMs = 600_000, signal } = options
    const deadline = Date.now() + timeoutMs
    let last: T | undefined
    while (true) {
      if (Date.now() >= deadline) throw timedOut(last)
      const timer = deadlineSignal(deadline, signal)
      let value: T
      try {
        value = await read(timer.signal)
      } catch (err) {
        if (timer.expired()) throw timedOut(last)
        throw err
      } finally {
        timer.release()
      }
      last = value
      if (settled(value)) return value
      const left = deadline - Date.now()
      if (left <= 0) throw timedOut(last)
      await sleep(Math.min(pollIntervalMs, left), signal)
    }
  }

  /**
   * Your ContentHero account: the credit balance, what is available, credits reserved for work in progress, this
   * month's spend and the monthly spend cap, the plan and auto top-up. Not a tracked social account
   * (`getTrackedAccount`).
   */
  async getAccount(): Promise<Account> {
    return this.request<Account>('GET', '/api/v1/account')
  }

  /**
   * Update your ContentHero account. Only the fields you pass change; a field the account does not have is refused.
   * `spendCap`: the monthly spend cap in credits, or `null` for no cap. Every credit spent counts toward it, and a
   * spend that would cross it is refused with `SpendCapReachedError`; it needs the `billing:write` scope (every key
   * has it) and the account's owner. Returns the account as it now is.
   */
  async updateAccount(fields: AccountUpdate): Promise<Account> {
    return this.request<Account>('PATCH', '/api/v1/account', fields)
  }

  /**
   * Transcribe an audio URL to text (ElevenLabs Scribe). Synchronous: the transcript comes back inline, with what it
   * cost in `charge` (free only when the account's own ElevenLabs key covered it).
   */
  async transcribe(request: TranscribeRequest): Promise<Transcription> {
    return this.request<Transcription>('POST', '/api/v1/studio/transcribe', request)
  }

  /**
   * Transform existing audio with an audio-processing model. Two shapes:
   *
   * FILE mode (`sourceUrl`): process a standalone file into a new library asset. Voice isolation is
   * synchronous and the processed URL comes back inline on `outputUrls`; enhancement is asynchronous and
   * returns an `outputId` to poll.
   *
   * IN-PLACE mode (`projectId` + `clipIds` / `enhanceClips`): enhance the audio OF EXISTING CLIPS on a
   * timeline. Returns one job per SOURCE on `outputs`, because the vendor estimates a noise profile per
   * production, so a source's clips are concatenated and enhanced together while separate recordings stay
   * separate jobs.
   */
  async editAudio(request: EditAudioRequest): Promise<EditAudioResult> {
    return this.request<EditAudioResult>('POST', '/api/v1/studio/audio/edit', request)
  }

  /** Cost preview for `editAudio` (nothing runs, nothing is charged). */
  async estimateEditAudioCost(request: EditAudioRequest): Promise<CostEstimate> {
    return this.request<CostEstimate>('POST', '/api/v1/studio/audio/edit', { ...request, getCost: true })
  }

  /** List the account's avatars (the list half of the list+get pair), a page at a time. */
  async listAvatars(options: PageOptions = {}): Promise<AvatarListResult> {
    const q = new URLSearchParams()
    setPage(q, options)
    return this.request<AvatarListResult>('GET', `/api/v1/avatars${queryOf(q)}`)
  }

  /** Get one avatar with its looks (the get half). Throws NotFoundError if absent. */
  async getAvatar(avatarId: string): Promise<Avatar> {
    return this.request<Avatar>('GET', `/api/v1/avatars/${encodeURIComponent(avatarId)}`)
  }

  /**
   * Create an avatar and start generating its first look.
   *
   * ⚠️ RESOLVES BEFORE THE AVATAR IS USABLE. The row lands at `status: 'processing'` with no image; its
   * default look and profile photo are set when the first look finishes. Poll `getAvatar` for
   * `status: 'completed'`.
   *
   * ⚠️ SPENDS CREDITS, charged when that look completes rather than here, so a failed generation does
   * not charge. Preview the price with `estimateAvatarCost()`.
   */
  async createAvatar(request: CreateAvatarRequest): Promise<CreateAvatarResult> {
    return this.request<CreateAvatarResult>('POST', '/api/v1/avatars', request)
  }

  /** What `createAvatar` will cost, in credits. Nothing runs and nothing is charged. */
  async estimateAvatarCost(): Promise<number> {
    const data = await this.request<{ creditsEstimate: number }>('POST', '/api/v1/avatars', {
      getCost: true,
    })
    return data.creditsEstimate
  }

  /**
   * Update an avatar's fields, and optionally add or remove looks in the same call.
   *
   * Ops are applied before the fields, so one call can add a look and make it the default.
   */
  async updateAvatar(avatarId: string, request: UpdateAvatarRequest): Promise<UpdateAvatarResult> {
    return this.request<UpdateAvatarResult>(
      'PATCH',
      `/api/v1/avatars/${encodeURIComponent(avatarId)}`,
      request,
    )
  }

  /**
   * Soft-delete an avatar.
   *
   * ⚠️ ITS LOOKS SURVIVE. They stay as library rows and can be reassigned to another avatar, which is
   * what makes consolidating duplicate avatars recoverable rather than destructive.
   */
  async deleteAvatar(avatarId: string): Promise<{ deleted: boolean; avatarId: string }> {
    return this.request('DELETE', `/api/v1/avatars/${encodeURIComponent(avatarId)}`)
  }

  /**
   * File images you already own onto an avatar as looks.
   *
   * ⚠️ THIS DOES NOT GENERATE ANYTHING. To make a NEW image and file it as a look, pass `avatarId` to
   * `generate`. This one costs nothing and only files what exists.
   *
   * Accepts any url the account owns: an upload, a studio creation, an editor export, another avatar's
   * look. Anything it cannot resolve as yours is reported in `skipped` rather than failing the call.
   */
  async addAvatarLooks(avatarId: string, imageUrls: string[]): Promise<AddAvatarLooksResult> {
    return this.request<AddAvatarLooksResult>(
      'POST',
      `/api/v1/avatars/${encodeURIComponent(avatarId)}/looks`,
      { imageUrls },
    )
  }

  /**
   * Remove one look from an avatar.
   *
   * ⚠️ REVERSIBLE. The image moves to trash and is recoverable for 30 days, the same as any other
   * library item. If it was the avatar's default, that pointer is cleared.
   */
  async removeAvatarLook(
    avatarId: string,
    lookId: string,
  ): Promise<{ deleted: boolean; lookId: string }> {
    return this.request(
      'DELETE',
      `/api/v1/avatars/${encodeURIComponent(avatarId)}/looks/${encodeURIComponent(lookId)}`,
    )
  }

  /** List the account's saved voices (the list half of the list+get pair), a page at a time. */
  async listVoices(options: ListVoicesOptions = {}): Promise<VoiceListResult> {
    const q = new URLSearchParams()
    if (options.favorited) q.set('favorited', 'true')
    setPage(q, options)
    return this.request<VoiceListResult>('GET', `/api/v1/voices${queryOf(q)}`)
  }

  /** Get one voice's detail (the get half). Throws NotFoundError if absent. */
  async getVoice(voiceId: string): Promise<Voice> {
    return this.request<Voice>('GET', `/api/v1/voices/${encodeURIComponent(voiceId)}`)
  }

  /** List the account's brand kits (the list half of the list+get pair), a page at a time. */
  async listBrandKits(options: ListBrandKitsOptions = {}): Promise<BrandKitListResult> {
    const q = new URLSearchParams()
    if (options.favorited) q.set('favorited', 'true')
    if (options.archived) q.set('archived', 'true')
    setPage(q, options)
    return this.request<BrandKitListResult>('GET', `/api/v1/brand-kits${queryOf(q)}`)
  }

  /**
   * Create a brand kit. Requires the `brand:write` scope.
   *
   * Three sources, and the input decides which: EMPTY (just a name), IMPORTED (`websiteUrls` and/or its own
   * accounts in `brandAccounts`, with `extract: true`), or A COPY (`duplicateFrom`).
   *
   * ⚠️ WITH `extract` IT RETURNS IMMEDIATELY, before the kit has any content. That empty kit is the HANDLE:
   * the thing to poll and the row the UI renders at once. Poll `extractionStatus` and `analysisStatus` via
   * `getBrandKit`.
   */
  async createBrandKit(
    input: CreateBrandKitInput & { duplicateFrom?: string },
  ): Promise<{ brandKit: BrandKit; import?: BrandImportOutcome }> {
    // A copy is a create with a source, so it shares this method rather than owning a verb of its own.
    if (input.duplicateFrom) {
      const { duplicateFrom, name } = input
      const data = await this.request<{ brandKit: BrandKit }>(
        'POST',
        `/api/v1/brand-kits/${encodeURIComponent(duplicateFrom)}/duplicate`,
        name ? { name } : {},
      )
      return { brandKit: data.brandKit }
    }
    return this.request<{ brandKit: BrandKit; import?: BrandImportOutcome }>(
      'POST',
      '/api/v1/brand-kits',
      input,
    )
  }

  /**
   * Re-run an existing kit's import: visuals from its first website, and the analysis of every website and its own
   * accounts, which writes only into sections still empty. Returns at once; poll `extractionStatus` and
   * `analysisStatus`. Needs a website or an own YouTube or Instagram account, and the `brand:write` scope.
   */
  async extractBrandKit(brandKitId: string): Promise<BrandImportOutcome> {
    const data = await this.request<{ import: BrandImportOutcome }>(
      'POST',
      `/api/v1/brand-kits/${encodeURIComponent(brandKitId)}/extract`,
    )
    return data.import
  }

  /**
   * Get one brand kit, read three ways:
   * - `{ detail: 'summary' }`: every section with its key, role, version, length and outline (its own headings), and
   *   NO bodies. The cheap first read: decide what to load, then load just that.
   * - a section filter (`keys`, `roles`, `tabs`, combined with AND): just those sections with their bodies, and
   *   each one's earlier versions with `history: true`.
   * - nothing: the whole kit.
   * Contradictory combinations (summary with a filter, history without one) are refused with a ValidationError.
   */
  async getBrandKit(brandKitId: string, options?: { detail?: 'full' }): Promise<BrandKit>
  async getBrandKit(brandKitId: string, options: { detail: 'summary' }): Promise<BrandKitSummaryRead>
  async getBrandKit(brandKitId: string, options: BrandKitSectionFilter & { history?: boolean }): Promise<BrandKitSectionsRead>
  async getBrandKit(
    brandKitId: string,
    options: { detail?: 'full' | 'summary'; history?: boolean } & BrandKitSectionFilter = {},
  ): Promise<BrandKit | BrandKitSummaryRead | BrandKitSectionsRead> {
    const q = new URLSearchParams()
    if (options.detail) q.set('detail', options.detail)
    for (const name of ['keys', 'roles', 'tabs'] as const) {
      const list = options[name]
      if (list && list.length > 0) q.set(name, list.join(','))
    }
    if (options.history) q.set('history', 'true')
    const qs = q.toString()
    return this.request<BrandKit | BrandKitSummaryRead | BrandKitSectionsRead>(
      'GET',
      `/api/v1/brand-kits/${encodeURIComponent(brandKitId)}${qs ? `?${qs}` : ''}`,
    )
  }

  /**
   * Update a brand kit: section content (`sections`, the sections you name, all or nothing), media, colors,
   * typography and linked accounts. A stale `expectedVersion` on any section throws a ConflictError whose
   * `conflicts` lists each stale section's current `{ key, version, body }`, and NOTHING in the patch is written.
   * Requires the `brand:write` scope. Returns the full updated kit.
   */
  async updateBrandKit(brandKitId: string, input: UpdateBrandKitInput & Placement): Promise<BrandKit> {
    return this.request<BrandKit>('PATCH', `/api/v1/brand-kits/${encodeURIComponent(brandKitId)}`, input)
  }

  // -------------------------------------------------------------------------
  // Brand knowledge (a brand kit's knowledge base)
  // -------------------------------------------------------------------------

  /** The complete index of a brand kit's knowledge items, a page at a time. Requires `brand:read`. */
  async listBrandKnowledge(
    brandKitId: string,
    options: PageOptions = {},
  ): Promise<BrandKnowledgeListResult> {
    const q = new URLSearchParams()
    setPage(q, options)
    const qs = q.toString()
    return this.request<BrandKnowledgeListResult>(
      'GET',
      `/api/v1/brand-kits/${encodeURIComponent(brandKitId)}/knowledge${qs ? `?${qs}` : ''}`,
    )
  }

  /** Get one knowledge item with its stored body. Requires `brand:read`. */
  async getBrandKnowledge(brandKitId: string, knowledgeId: string): Promise<BrandKnowledgeDetail> {
    const data = await this.request<{ item: BrandKnowledgeDetail }>(
      'GET',
      `/api/v1/brand-kits/${encodeURIComponent(brandKitId)}/knowledge/${encodeURIComponent(knowledgeId)}`,
    )
    return data.item
  }

  /** Semantic search over a brand kit's knowledge base. Requires `brand:read`. */
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

  /** Add an item to a brand kit's knowledge base (text/url/youtube/file). Requires `brand:write`. */
  /**
   * What `addBrandKnowledge` would charge for this item, without adding it. Text, links, YouTube and documents are
   * free; an image is one item; video and audio are measured (not processed) and priced per chunk.
   */
  async estimateBrandKnowledgeCost(brandKitId: string, input: AddBrandKnowledgeInput): Promise<CostEstimate> {
    return this.request<CostEstimate>('POST', `/api/v1/brand-kits/${encodeURIComponent(brandKitId)}/knowledge`, { ...input, getCost: true })
  }

  async addBrandKnowledge(brandKitId: string, input: AddBrandKnowledgeInput): Promise<AddBrandKnowledgeResult> {
    return this.request<AddBrandKnowledgeResult>('POST', `/api/v1/brand-kits/${encodeURIComponent(brandKitId)}/knowledge`, input)
  }

  /** Remove a knowledge item and its embedding chunks. Requires `brand:write`. */
  async removeBrandKnowledge(brandKitId: string, knowledgeId: string): Promise<{ id: string }> {
    return this.request<{ id: string }>(
      'DELETE',
      `/api/v1/brand-kits/${encodeURIComponent(brandKitId)}/knowledge/${encodeURIComponent(knowledgeId)}`,
    )
  }

  /**
   * List the library's files (the list half of the list+get pair), sorted by `sort` and `order`, a page at a time.
   * Every file by default; `source` reads one part of the library.
   */
  async listMedia(options: ListMediaOptions = {}): Promise<MediaListResult> {
    const q = new URLSearchParams()
    if (options.source) q.set('source', options.source)
    if (options.contentType) {
      const types = Array.isArray(options.contentType) ? options.contentType : [options.contentType]
      q.set('contentType', types.join(','))
    }
    if (options.status) q.set('status', options.status)
    if (options.kind) q.set('kind', options.kind)
    if (options.favorited) q.set('favorited', 'true')
    if (options.archived) q.set('archived', 'true')
    setSort(q, options)
    setPage(q, options)
    if (options.smallCopies) q.set('smallCopies', 'true')
    return this.request<MediaListResult>('GET', `/api/v1/media${queryOf(q)}`)
  }

  /**
   * Get one media item by id token (the get half). `source` selects the library the
   * id belongs to: 'creations' (default, a studio output; token may be the full id,
   * its short id or first 8 characters, any with a `-N` variation suffix), 'uploads' (an
   * editor Uploads-tab file; full id or short id, no variations), or 'stock' (a used
   * stock item; full id or short id, no variations). Pass the same source the item
   * reported in listMedia. Throws NotFoundError if absent.
   */
  async getMedia(idToken: string, options: { source?: MediaSource } = {}): Promise<MediaItem> {
    const qs = options.source ? `?source=${encodeURIComponent(options.source)}` : ''
    return this.request<MediaItem>('GET', `/api/v1/media/${encodeURIComponent(idToken)}${qs}`)
  }

  /**
   * Semantically search the account's editable media library (creations, uploads, licensed stock, brand assets)
   * by describing the content in natural language. Returns matching assets ranked by relevance, each with a
   * description, tags, and, for videos, the timestamps of the scenes that matched, so a precise moment can be
   * located. Searches only the account's own usable library, never inspiration, published posts, or knowledge.
   */
  async searchMedia(query: string, options: SearchMediaOptions = {}): Promise<SearchMediaPage> {
    const q = new URLSearchParams({ query })
    if (options.kinds && options.kinds.length > 0) q.set('kinds', options.kinds.join(','))
    setPage(q, options)
    if (options.smallCopies) q.set('smallCopies', 'true')
    return this.request<SearchMediaPage>('GET', `/api/v1/media/search?${q.toString()}`)
  }

  // ─── Library folders (Unified Content Library, Phase D) ────────────────────

  /**
   * List the account's folders (manual + smart, with parent links), a page at a time, plus the built-in derived
   * folders (the same on every page).
   */
  async listFolders(options: PageOptions = {}): Promise<FolderListResult> {
    const q = new URLSearchParams()
    setPage(q, options)
    return this.request<FolderListResult>('GET', `/api/v1/library/folders${queryOf(q)}`)
  }

  /**
   * A folder's contents, a page at a time. `folderId` is a folder id or a derived key
   * (recents|favorites|edits|canvas|posts). `smallCopies` gives each image its `smallUrl`, the smallest copy the
   * library keeps, for drawing it small.
   */
  async getFolder(folderId: string, options: GetFolderOptions = {}): Promise<FolderContents> {
    const q = new URLSearchParams()
    setPage(q, options)
    if (options.smallCopies) q.set('smallCopies', 'true')
    const qs = q.toString()
    const data = await this.request<FolderContents>(
      'GET',
      `/api/v1/library/folders/${encodeURIComponent(folderId)}${qs ? `?${qs}` : ''}`,
    )
    return { folder: data.folder, items: data.items, nextCursor: data.nextCursor }
  }

  async createFolder(input: CreateFolderInput): Promise<Folder> {
    const data = await this.request<{ folder: Folder }>('POST', '/api/v1/library/folders', input)
    return data.folder
  }

  /**
   * Update a folder: rename it, move it (`parentId`), re-query a smart folder, and file or unfile items.
   *
   * `addItems` / `removeItems` are DELTAS, because folder membership is many-to-many: an item lives in
   * several folders at once, so a declarative list would silently unfile everything absent from it.
   * `folderIds` applies the patch to several folders; attribute fields still need exactly one.
   */
  async updateFolder(folderId: string, patch: UpdateFolderInput): Promise<Folder> {
    const data = await this.request<{ folder: Folder }>('PATCH', `/api/v1/library/folders/${encodeURIComponent(folderId)}`, patch)
    return data.folder
  }

  /** Patch several folders at once (bulk moves and filing). Returns every folder that was found. */
  async updateFolders(folderIds: string[], patch: UpdateFolderInput): Promise<Folder[]> {
    const first = folderIds[0]
    if (!first) throw new Error('updateFolders needs at least one folder id')
    const data = await this.request<{ folders: Folder[] }>(
      'PATCH',
      // The path names one folder because the route is per-folder; `folderIds` in the body is what widens
      // it. The first id is as good as any for addressing.
      `/api/v1/library/folders/${encodeURIComponent(first)}`,
      { ...patch, folderIds },
    )
    return data.folders
  }

  async deleteFolder(folderId: string): Promise<void> {
    await this.request<{ ok: boolean }>('DELETE', `/api/v1/library/folders/${encodeURIComponent(folderId)}`)
  }


  /**
   * Resolve a batch of media references to vision-ready URLs + light metadata (the
   * micro drill-in behind get_context's macro screenshot). Each item is a raw
   * `{ url }` or an `{ mediaId, variation? }`; a mediaId with no variation resolves
   * to only the primary variation (siblings listed in `otherVariations`), never a
   * whole generation. Returns one entry per item, in order; a bad item comes back
   * with `ok: false` rather than failing the batch. Max 10 items per call (the SDK
   * returns URLs; the MCP layer is what turns them into image blocks for a model).
   */
  async getMediaBatch(items: MediaBatchItem[]): Promise<MediaBatchResult> {
    return this.request<MediaBatchResult>('POST', '/api/v1/media/batch', { items })
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
    // The PUT goes straight to object storage (not our API), so it uses a bare
    // fetch with none of our auth headers.
    //
    // The headers come from the SERVER rather than being assumed here. Storage
    // used to be Supabase, where Content-Type alone is enough; it is moving to
    // R2, where the presigned URL signs the owner in as `x-amz-meta-user_id` and
    // a PUT missing it is rejected with SignatureDoesNotMatch (verified: 403
    // with Content-Type alone, 200 with both). Letting the server say what to
    // send means this client never has to know which store it is talking to,
    // and the migration needs no coordinated release of it.
    //
    // Falls back to Content-Type so an older API that does not return
    // uploadHeaders keeps working, which is what makes the two deployable in
    // either order.
    const put = await this.fetchImpl(created.uploadUrl, {
      method: 'PUT',
      headers: created.uploadHeaders ?? { 'Content-Type': opts.contentType },
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
   * read local files).
   *
   * ⚠️ IDEMPOTENT. If the account already holds these exact bytes nothing is created and `alreadyExisted`
   * is true; `outputId` is then the item that already owns them, or NULL when the bytes belong to something
   * that is not a library item (an export from a project, an avatar look). A duplicate import is a
   * successful no-op, not an error, so check the flag rather than assuming a new row.
   *
   * The server fetches the url in a background job; this waits for it (`options` as `waitForGeneration`). Throws
   * `GenerationFailedError` when the url cannot be imported (not https, not a public address, not readable media),
   * or `GenerationTimeoutError` carrying the outputId when it has not finished yet: resume with `waitForGeneration`.
   */
  async importMedia(input: ImportMediaInput, options: WaitOptions = {}): Promise<ImportedMedia> {
    const started = await this.startImport(input)
    // A server from before imports ran as a job answers with the finished result.
    if ((started as { status?: string }).status !== 'processing') return started as unknown as ImportedMedia
    const gen = await this.#waitAfterSubmit(started.outputId, options)
    return importedMediaFrom(gen, started.shortId)
  }

  /** Start an import and return at once; follow it with `waitForGeneration` or `getGeneration`. See `importMedia`. */
  async startImport(input: ImportMediaInput): Promise<ImportStarted> {
    return this.request<ImportStarted>('POST', '/api/v1/media/imports', input)
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
  // Publish platforms (what a post can target)
  // -------------------------------------------------------------------------

  /**
   * List the platforms this account can publish to (the discovery catalog):
   * their formats, and whether a connected account exists for each. The source
   * of truth for valid platforms/formats; call getPlatform for one platform's
   * full request shape before configuring a post.
   */
  async listPlatforms(): Promise<PlatformSummary[]> {
    const data = await this.request<{ platforms: PlatformSummary[] }>('GET', '/api/v1/platforms')
    return data.platforms
  }

  /**
   * Get one platform's full publishing shape: the fields, options (enums), and
   * character limits a post requires per format. Use this to construct a
   * post's platformSettings against the platform's real fields instead of
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
  // Kling elements (Kling 3.0's reusable references)
  // -------------------------------------------------------------------------

  /** List the account's saved Kling elements (newest first), a page at a time. */
  async listKlingElements(options: PageOptions = {}): Promise<KlingElementListResult> {
    const q = new URLSearchParams()
    setPage(q, options)
    return this.request<KlingElementListResult>('GET', `/api/v1/kling-elements${queryOf(q)}`)
  }

  /** Get one saved Kling element by id. */
  async getKlingElement(id: string): Promise<KlingElement> {
    return this.request<KlingElement>('GET', `/api/v1/kling-elements/${encodeURIComponent(id)}`)
  }

  /**
   * Create a reusable Kling element from 2-4 images (or 1 video). Inputs may
   * be URLs or output-id tokens (generate the angle shots first, then assemble).
   * Reference it later in a Kling generation via references.klingElements [{ klingElementId }].
   */
  async createKlingElement(request: CreateKlingElementRequest): Promise<KlingElement> {
    return this.request<KlingElement>('POST', '/api/v1/kling-elements', request)
  }

  /** Update a saved Kling element's name / description / category. */
  async updateKlingElement(
    id: string,
    patch: { name?: string; description?: string; category?: string },
  ): Promise<KlingElement> {
    return this.request<KlingElement>('PATCH', `/api/v1/kling-elements/${encodeURIComponent(id)}`, patch)
  }

  /** Delete a saved Kling element. */
  async deleteKlingElement(id: string): Promise<{ deleted: boolean; id: string }> {
    return this.request<{ deleted: boolean; id: string }>('DELETE', `/api/v1/kling-elements/${encodeURIComponent(id)}`)
  }

  // The names before 2026-10-04, kept for one release window. Each calls its Kling twin, so there is one
  // implementation; remove them when the window closes.

  /** @deprecated Use `listKlingElements`. */
  async listElements(options: PageOptions = {}): Promise<KlingElementListResult> {
    return this.listKlingElements(options)
  }

  /** @deprecated Use `getKlingElement`. */
  async getElement(id: string): Promise<KlingElement> {
    return this.getKlingElement(id)
  }

  /** @deprecated Use `createKlingElement`. */
  async createElement(request: CreateKlingElementRequest): Promise<KlingElement> {
    return this.createKlingElement(request)
  }

  /** @deprecated Use `updateKlingElement`. */
  async updateElement(
    id: string,
    patch: { name?: string; description?: string; category?: string },
  ): Promise<KlingElement> {
    return this.updateKlingElement(id, patch)
  }

  /** @deprecated Use `deleteKlingElement`. */
  async deleteElement(id: string): Promise<{ deleted: boolean; id: string }> {
    return this.deleteKlingElement(id)
  }

  // -------------------------------------------------------------------------
  // Templates (the editor's Elements: reusable code, shapes and animated emoji)
  // -------------------------------------------------------------------------

  /**
   * The templates the caller can see, ContentHero's and their own, without their code, a page at a time. Place one
   * with an `insert_template` op on `applyEditorOps`; read one whole with `getTemplate`.
   */
  async listTemplates(options: ListTemplatesOptions = {}): Promise<TemplateListResult> {
    const q = new URLSearchParams()
    if (options.scope) q.set('scope', options.scope)
    if (options.kind) q.set('kind', options.kind)
    for (const category of ([] as string[]).concat(options.category ?? [])) q.append('category', category)
    if (options.search) q.set('search', options.search)
    if (options.archived) q.set('archived', options.archived)
    setPage(q, options)
    const qs = q.toString()
    return this.request<TemplateListResult>('GET', `/api/v1/templates${qs ? `?${qs}` : ''}`)
  }

  /** The categories in use among the templates the caller can see, with how many each holds, a page at a time. */
  async listTemplateCategories(options: ListTemplateCategoriesOptions = {}): Promise<TemplateCategoryListResult> {
    const q = new URLSearchParams()
    if (options.scope) q.set('scope', options.scope)
    setPage(q, options)
    return this.request<TemplateCategoryListResult>('GET', `/api/v1/templates/categories${queryOf(q)}`)
  }

  /** One template, with its code. Someone else's is not found, the same as a missing one. */
  async getTemplate(id: string): Promise<Template> {
    const data = await this.request<{ template: Template }>('GET', `/api/v1/templates/${encodeURIComponent(id)}`)
    return data.template
  }

  /**
   * Save one of the caller's own templates, from exactly one source (`CreateTemplateRequest`). Code that does not
   * compile, and a file addressed by its storage link, are refused.
   */
  async createTemplate(request: CreateTemplateRequest): Promise<TemplateWriteResult> {
    return this.request<TemplateWriteResult>('POST', '/api/v1/templates', request)
  }

  /**
   * Change one of the caller's own templates: only the fields given, and where it sits among the caller's templates
   * (`afterId`, `beforeId`, `position`; a placement alone is a move). Pass the `version` you read as `expectedVersion`
   * to refuse (409) a write over content that changed since. Placed copies keep what they had.
   */
  async updateTemplate(id: string, fields: TemplateFields & Placement, options: { expectedVersion?: number } = {}): Promise<TemplateWriteResult> {
    const body = options.expectedVersion != null ? { ...fields, expectedVersion: options.expectedVersion } : fields
    return this.request<TemplateWriteResult>('PATCH', `/api/v1/templates/${encodeURIComponent(id)}`, body)
  }

  /** Delete one of the caller's own templates. Placed copies keep everything. To hide one instead, archive it. */
  async deleteTemplate(id: string): Promise<{ deleted: boolean; id: string }> {
    return this.request<{ deleted: boolean; id: string }>('DELETE', `/api/v1/templates/${encodeURIComponent(id)}`)
  }

  // -------------------------------------------------------------------------
  // Content pipeline (posts)
  // -------------------------------------------------------------------------

  /**
   * List the account's cards, with optional filters, sorted by `sort` and `order`, a page at a time.
   *
   * ⚠️ SCOPED TO ONE SPACE. Without `spaceId` this is the account's DEFAULT
   * space, not every card you own, and the response says nothing about the ones
   * it excluded. `search` is scoped the same way, so a title that exists on
   * another board returns no results. Call `listSpaces()` first, or pass
   * `spaceId: 'all'` for every space.
   */
  async listCards(options: ListCardsOptions = {}): Promise<CardListResult> {
    const q = new URLSearchParams()
    if (options.spaceId) q.set('spaceId', options.spaceId)
    if (options.archived) q.set('archived', 'true')
    if (options.platform) q.set('platform', options.platform)
    if (options.stage) q.set('stage', options.stage)
    if (options.isFavorite) q.set('isFavorite', 'true')
    if (options.tag) q.set('tag', options.tag)
    if (options.search) q.set('search', options.search)
    setSort(q, options)
    setPage(q, options)
    return this.request<CardListResult>('GET', `/api/v1/cards${queryOf(q)}`)
  }

  /** Get one post with its assets and posts. Throws NotFoundError if absent. */
  async getCard(cardId: string): Promise<CardDetail> {
    const data = await this.request<{ post: CardDetail }>(
      'GET',
      `/api/v1/cards/${encodeURIComponent(cardId)}`,
    )
    return data.post
  }

  /** Create a post. `stage` accepts a stage id, slug, or name (defaults to the first stage). */
  async createCard(input: CreateCardInput): Promise<CardSummary> {
    const data = await this.request<{ post: CardSummary }>('POST', '/api/v1/cards', input)
    return data.post
  }

  /** Update a post's fields. `stage` accepts a stage id, slug, or name. */
  async updateCard(cardId: string, input: UpdateCardInput): Promise<CardSummary> {
    const data = await this.request<{ post: CardSummary }>(
      'PATCH',
      `/api/v1/cards/${encodeURIComponent(cardId)}`,
      input,
    )
    return data.post
  }

  /**
   * Patch several cards at once. The bulk half of `updateCard`.
   *
   * ⚠️ FIELDS THAT DESCRIBE ONE CARD STILL NEED EXACTLY ONE. You cannot retitle five cards to one title,
   * and the server refuses rather than doing it silently. `spaceId`, `stage`, `status`, `isFavorite` and
   * `tags` are the bulk-safe ones, because each is genuinely something a person means for a selection.
   *
   * ⭐ THIS EXISTS FOR THE MOVE. Sending twelve cards to another space per-card would resolve the same
   * target space and the same stage twelve times and interleave twelve advisory locks on the target
   * column. Same shape as `updateFolders`: the path names one card and `cardIds` in the body widens it.
   */
  async updateCards(cardIds: string[], input: UpdateCardInput): Promise<CardSummary[]> {
    const first = cardIds[0]
    if (!first) throw new Error('updateCards needs at least one card id')
    const data = await this.request<{ posts: CardSummary[] }>(
      'PATCH',
      `/api/v1/cards/${encodeURIComponent(first)}`,
      { ...input, cardIds },
    )
    return data.posts
  }

  /**
   * List the account's stages (sorted), seeding the defaults on first
   * access. Use this to resolve a stage before placing a post; stages are
   * per-account customizable.
   */
  async listStages(options: ListStagesOptions = {}): Promise<StageListResult> {
    const q = new URLSearchParams()
    if (options.spaceId) q.set('spaceId', options.spaceId)
    setPage(q, options)
    // ⭐ RETURNS `{ stages, space }` RATHER THAN A BARE ARRAY. Unwrapping to `data.stages` threw away the
    // only thing that says WHOSE stages these are, and this read falls back to the default space when none
    // is named. See `StageListResult`.
    return this.request<StageListResult>('GET', `/api/v1/stages${queryOf(q)}`)
  }

  /**
   * Create a stage (a column on a board).
   *
   * `spaceId` may be omitted, and only here: a new column goes to the account's
   * default board, the same answer `createCard` gives. Every other stage write
   * requires the board, because the stage id already determines it and a
   * default could only contradict it.
   *
   * The slug is DERIVED from the name and is not settable. A board cannot hold
   * two columns whose names derive the same slug, and the server refuses the
   * second rather than inventing `done-2`.
   *
   * A placement (`afterId`, `beforeId`, `position`) places the column; `top` is the first column. Name none and it
   * goes to the end.
   */
  async createStage(input: { name: string; spaceId?: string; color?: string } & Placement): Promise<Stage> {
    const data = await this.request<{ stage: Stage }>('POST', '/api/v1/stages', {
      name: input.name,
      spaceId: input.spaceId,
      color: input.color,
      afterId: input.afterId,
      beforeId: input.beforeId,
      position: input.position,
    })
    return data.stage
  }

  /**
   * Update a stage: rename it, recolor it, or move it.
   *
   * A PATCH, not a replace: a field you omit is left alone. Renaming
   * re-derives the slug, so a column called Done has the slug `done`; a rename
   * that would collide with another column on the same board is REFUSED.
   *
   * Moving names NEIGHBORS (`afterId`, `beforeId`) or an end (`position`,
   * `top` being the first column), never a number, because a number computed
   * against a list you fetched earlier is stale by the time it arrives. Name
   * none to leave it where it is.
   *
   * No position comes back: `listStages` returns the board in its order, so a
   * caller never holds a number a move could make stale.
   */
  async updateStage(
    stageId: string,
    input: { spaceId: string; name?: string; color?: string } & Placement,
  ): Promise<Stage> {
    const body: Record<string, unknown> = { spaceId: input.spaceId }
    if (input.name !== undefined) body.name = input.name
    if (input.color !== undefined) body.color = input.color
    if (input.afterId !== undefined) body.afterId = input.afterId
    if (input.beforeId !== undefined) body.beforeId = input.beforeId
    if (input.position !== undefined) body.position = input.position

    const data = await this.request<{ stage: Stage }>(
      'PATCH',
      `/api/v1/stages/${encodeURIComponent(stageId)}`,
      body,
    )
    return data.stage
  }

  /**
   * Delete a stage, moving its cards to `targetStageId`.
   *
   * The server REFUSES a column that still holds cards when you name no target,
   * and says how many there are. Cards are never destroyed by deleting a
   * column: the delete and the reassignment are one transaction.
   *
   * Returns the board as it stands afterwards, already counted, so you do not
   * have to re-list to find out what is left.
   */
  async deleteStage(
    stageId: string,
    input: { spaceId: string; targetStageId?: string | null },
  ): Promise<{ id: string; movedCards: number; stages: Stage[] }> {
    const data = await this.request<{ id: string; movedCards: number; stages: Stage[] }>(
      'DELETE',
      `/api/v1/stages/${encodeURIComponent(stageId)}`,
      { spaceId: input.spaceId, targetStageId: input.targetStageId ?? null },
    )
    return { id: data.id, movedCards: data.movedCards, stages: data.stages }
  }

  // -------------------------------------------------------------------------
  // Spaces (the planner's top-level container: Space > Stage > Card > Post)
  //
  // Favoriting and archiving a space are NOT here. They are cross-entity verbs
  // reached through `favorite()` and `archive()` with assetType 'space', the
  // same way they work for posts, projects and brand kits.
  // -------------------------------------------------------------------------

  /**
   * List the account's spaces, sorted by `sort` and `order`, a page at a time.
   *
   * Archived spaces are excluded by default, matching the grid in the app; `archived` lists only them. Each space
   * carries `cardCount`, its live card total.
   */
  async listSpaces(options: ListSpacesOptions = {}): Promise<SpaceListResult> {
    const q = new URLSearchParams()
    if (options.archived) q.set('archived', 'true')
    if (options.favorited) q.set('favorited', 'true')
    if (options.search) q.set('search', options.search)
    setSort(q, options)
    setPage(q, options)
    return this.request<SpaceListResult>('GET', `/api/v1/spaces${queryOf(q)}`)
  }

  /** One space, with its live card count. Throws 404 for a space in another account. */
  async getSpace(spaceId: string): Promise<Space> {
    const data = await this.request<{ space: Space }>(
      'GET',
      `/api/v1/spaces/${encodeURIComponent(spaceId)}`,
    )
    return data.space
  }

  /**
   * Create a space.
   *
   * `duplicateFrom` copies another space's STAGES, never its cards, so the new
   * board arrives with the columns and none of the work.
   */
  async createSpace(input: {
    name: string
    coverUrl?: string | null
    coverPosition?: { x: number; y: number } | null
    duplicateFrom?: string
  }): Promise<Space> {
    const data = await this.request<{ space: Space }>('POST', '/api/v1/spaces', {
      name: input.name,
      coverUrl: input.coverUrl,
      coverPosition: input.coverPosition,
      duplicateFrom: input.duplicateFrom,
    })
    return data.space
  }

  /**
   * Update a space. Every field is optional and this is a PATCH, not a replace:
   * a field you omit is left alone.
   *
   * `coverUrl` distinguishes ABSENT from NULL. Omit it to keep the current
   * cover; pass `null` to remove it, which clears its framing too.
   */
  async updateSpace(
    spaceId: string,
    input: {
      name?: string
      coverUrl?: string | null
      coverPosition?: { x: number; y: number } | null
    },
  ): Promise<Space> {
    const body: Record<string, unknown> = {}
    if (input.name !== undefined) body.name = input.name
    if (input.coverUrl !== undefined) body.coverUrl = input.coverUrl
    if (input.coverPosition !== undefined) body.coverPosition = input.coverPosition

    const data = await this.request<{ space: Space }>(
      'PATCH',
      `/api/v1/spaces/${encodeURIComponent(spaceId)}`,
      body,
    )
    return data.space
  }

  /**
   * Delete a space. The server REFUSES a space that still holds cards, naming
   * the count, because the delete cascades to every card in it along with their
   * covers, captions, posts and schedules.
   */
  async deleteSpace(spaceId: string): Promise<{ id: string }> {
    return this.request<{ id: string }>(
      'DELETE',
      `/api/v1/spaces/${encodeURIComponent(spaceId)}`,
    )
  }

  // -------------------------------------------------------------------------
  // Tags (the organizational tag library; set a post's tags via the `tags`
  // field on createCard / updateCard)
  // -------------------------------------------------------------------------

  /** List the account's tags, by name, a page at a time. */
  async listTags(options: PageOptions = {}): Promise<TagListResult> {
    const q = new URLSearchParams()
    setPage(q, options)
    return this.request<TagListResult>('GET', `/api/v1/tags${queryOf(q)}`)
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
   * Publish a card's posts NOW: every post on the card, or only the named
   * platform's post when `platform` is given. Requires a key with the
   * `publish:write` scope. Each post publishes independently; check the
   * per-post results.
   */
  async publishPost(cardId: string, options: { platform?: PostPlatform } = {}): Promise<PublishResult> {
    return this.request<PublishResult>(
      'POST',
      `/api/v1/cards/${encodeURIComponent(cardId)}/publish`,
      options.platform ? { platform: options.platform } : {},
    )
  }

  // -------------------------------------------------------------------------
  // Inspiration / research reads
  // -------------------------------------------------------------------------

  /**
   * The social accounts the caller tracks, both tiers by default.
   *
   * `accountType` narrows to `inspiration` (creators and competitors they learn from) or `brand` (their own
   * profiles). Every row reports its own `accountType`, so one list answers both questions. This replaces
   * `listInspirationAccounts` and `listBrandAccounts`, which were one query with a different literal.
   */
  async listTrackedAccounts(options: ListTrackedAccountsOptions = {}): Promise<TrackedAccountListResult> {
    const q = new URLSearchParams()
    if (options.accountType) q.set('accountType', options.accountType)
    if (options.brandKitId) q.set('brandKitId', options.brandKitId)
    setPage(q, options)
    return this.request<TrackedAccountListResult>('GET', `/api/v1/accounts${queryOf(q)}`)
  }

  /**
   * One tracked account with its performance: content count, totals, averages, top and recent content.
   * Works for either tier; the tier is reported, not required.
   */
  async getTrackedAccount(accountId: string): Promise<TrackedAccountDetail> {
    return this.request<TrackedAccountDetail>('GET', `/api/v1/accounts/${encodeURIComponent(accountId)}`)
  }

  /**
   * Move a tracked account within its list (its kind's: the creators watched, or the owner's own profiles), after or
   * before another or to an end. Answers the account as `getTrackedAccount` does. Requires `inspiration:write`.
   */
  async updateTrackedAccount(accountId: string, placement: Placement): Promise<TrackedAccountDetail> {
    return this.request<TrackedAccountDetail>('PATCH', `/api/v1/accounts/${encodeURIComponent(accountId)}`, placement)
  }

  /**
   * The social content the caller tracks, ranked by outlier score by default.
   *
   * Spans the creators they watch AND their own posts (`scope`, default `all`); each row carries `isOwn`.
   * Filter by platform, content type, a published window, and ranges over score, views, duration and
   * follower count.
   */
  async listContent(options: ListContentOptions = {}): Promise<ContentListResult> {
    const q = new URLSearchParams()
    if (options.scope) q.set('scope', options.scope)
    if (options.platform) q.set('platform', options.platform)
    if (options.contentType) q.set('contentType', options.contentType)
    if (options.outlierScoreMin != null) q.set('outlierScoreMin', String(options.outlierScoreMin))
    if (options.outlierScoreMax != null) q.set('outlierScoreMax', String(options.outlierScoreMax))
    if (options.viewsMin != null) q.set('viewsMin', String(options.viewsMin))
    if (options.viewsMax != null) q.set('viewsMax', String(options.viewsMax))
    if (options.durationMin != null) q.set('durationMin', String(options.durationMin))
    if (options.durationMax != null) q.set('durationMax', String(options.durationMax))
    if (options.subscribersMin != null) q.set('subscribersMin', String(options.subscribersMin))
    if (options.subscribersMax != null) q.set('subscribersMax', String(options.subscribersMax))
    if (options.publishedAfter) q.set('publishedAfter', options.publishedAfter)
    if (options.publishedBefore) q.set('publishedBefore', options.publishedBefore)
    if (options.publicationDate) q.set('publicationDate', options.publicationDate)
    if (options.search) q.set('search', options.search)
    if (options.accountIds?.length) q.set('accountIds', options.accountIds.join(','))
    if (options.addedByYou) q.set('addedByYou', 'true')
    if (options.brandKitId) q.set('brandKitId', options.brandKitId)
    if (options.favorited) q.set('favorited', 'true')
    setSort(q, options)
    setPage(q, options)
    return this.request<ContentListResult>('GET', `/api/v1/content${queryOf(q)}`)
  }

  /**
   * One tracked post in full: engagement, outlier score, hashtags, keywords, mentions, audio info.
   *
   * The transcript is OPT-IN and windowable, because a sixty-minute video is a large document: ask for
   * `text` or `segments`, and narrow segments with `startMs`/`endMs` or `transcriptSearch`. Throws
   * NotFoundError both when the post does not exist and when the caller has no relationship to it.
   */
  async getContent(contentId: string, options: GetContentOptions = {}): Promise<ContentDetail> {
    const q = new URLSearchParams()
    if (options.transcript) q.set('transcript', options.transcript)
    if (options.startMs != null) q.set('startMs', String(options.startMs))
    if (options.endMs != null) q.set('endMs', String(options.endMs))
    if (options.transcriptSearch) q.set('transcriptSearch', options.transcriptSearch)
    if (options.analysis && options.analysis !== 'none') q.set('analysis', options.analysis)
    // camelCase on the wire, like the option. 0.4.11 and 0.4.12 sent `analysis_sections`, which the API now
    // refuses with a 400 naming this spelling (the app's check-wire-vocabulary rule).
    if (options.analysisSections?.length) q.set('analysisSections', options.analysisSections.join(','))
    if (options.scenes && options.scenes !== 'none') q.set('scenes', options.scenes)
    const qs = q.toString()
    return this.request<ContentDetail>(
      'GET',
      `/api/v1/content/${encodeURIComponent(contentId)}${qs ? `?${qs}` : ''}`,
    )
  }

  /**
   * Run Break It Down on a post. One analysis per post, read by everyone: when the post has one it is returned
   * at no charge. Otherwise this starts one and returns `analysis.status: 'running'`; calling again is safe (a
   * running post starts nothing and charges nothing) and returns the analysis once it is stored, which is when
   * the credits are charged, once. Price it first with `estimateAnalysisCost`.
   *
   * `kind: 'scenes'` prepares the post to be seen instead: its scene map and a frame per scene, read afterwards
   * with `getContent`, priced per started minute of video. Same rules: free when it exists, charged once when
   * stored, safe to call again while it runs. A post with no video is refused with the reason.
   */
  async analyzeContent(contentId: string, options?: { kind?: 'breakdown' }): Promise<ContentAnalysisResult>
  async analyzeContent(contentId: string, options: { kind: 'scenes' }): Promise<ContentScenesResult>
  async analyzeContent(
    contentId: string,
    options: { kind?: ContentAnalysisKind } = {},
  ): Promise<ContentAnalysisResult | ContentScenesResult> {
    return this.request('POST', `/api/v1/content/${encodeURIComponent(contentId)}/analysis`, options.kind ? { kind: options.kind } : {})
  }

  /** What `analyzeContent` would charge for this post and kind: 0 when the result already exists. Runs nothing. */
  async estimateAnalysisCost(contentId: string, options: { kind?: ContentAnalysisKind } = {}): Promise<CostEstimate> {
    return this.request<CostEstimate>('POST', `/api/v1/content/${encodeURIComponent(contentId)}/analysis`, {
      getCost: true,
      ...(options.kind ? { kind: options.kind } : {}),
    })
  }

  // -------------------------------------------------------------------------
  // Connected accounts (publish targets)
  // -------------------------------------------------------------------------

  /** List the account's connected social accounts (publish targets), default first, a page at a time. */
  async listConnectedAccounts(options: PageOptions = {}): Promise<ConnectedAccountListResult> {
    const q = new URLSearchParams()
    setPage(q, options)
    return this.request<ConnectedAccountListResult>('GET', `/api/v1/connected-accounts${queryOf(q)}`)
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
   *
   * `favorited` defaults to true; pass false to CLEAR it. That boolean is what replaced the separate
   * `unfavorite` method, which was this call with one value flipped. Idempotent in both directions.
   */
  async favorite(input: FavoriteInput): Promise<void> {
    await this.request<{ favorited: boolean }>('POST', '/api/v1/favorite', input)
  }

  /**
   * A public link to media made in Studio: outputs of the caller's finished generations, by media id. One output is its
   * generation's link, opened at that output (a generation keeps one link); several are a new link to them as a set,
   * leaving out any that cannot be shared (`mediaIds` in the answer says which are in). `shared: false` stops sharing a
   * generation's link (one media id) or any media link (`shareUrl`): it never opens again. Requires `studio:write`.
   */
  async shareMedia(input: ShareMediaInput): Promise<MediaShare> {
    return this.request<MediaShare>('POST', '/api/v1/media/share', input)
  }

  /**
   * Archive an asset. Requires the `favorites:write` scope.
   *
   * Pass `{ assetType, id }` for a top-level asset (post, brand_kit,
   * brand_kit_section, project), or `{ id, variationIndex }` to archive a single
   * studio output variation slot. Archiving a post sets its status to 'archived'.
   *
   * `archived` defaults to true; pass false to RESTORE (a post goes back to 'draft'). That boolean is what
   * replaced the separate `unarchive` method. Idempotent in both directions.
   */
  async archive(input: ArchiveInput): Promise<void> {
    await this.request<{ archived: boolean }>('POST', '/api/v1/archive', input)
  }

  // -------------------------------------------------------------------------
  // Editor / canvas ops (programmatic parity with the manual UI + in-app agent)
  // -------------------------------------------------------------------------

  /**
   * List the caller's projects (both editor + canvas) as lightweight summaries. Filter by archived /
   * favorited state, by `type`, or by a title search, sorted by `sort` and `order`, a page at a time. Requires the
   * `editor:read` scope.
   */
  async listProjects(input: ListProjectsInput = {}): Promise<ProjectListResult> {
    const q = new URLSearchParams()
    if (input.filter) q.set('filter', input.filter)
    // One field on the wire: `type`, with the deprecated aliases folded into it here. Until sdk 0.4.16 this sent only
    // `kind`, so a `surface` filter was silently dropped and every caller got both types back.
    const type = input.type ?? input.surface ?? input.kind
    if (type) q.set('type', type)
    if (input.search) q.set('search', input.search)
    setSort(q, input)
    setPage(q, input)
    return this.request<ProjectListResult>('GET', `/api/v1/projects${queryOf(q)}`)
  }

  /**
   * Read a single project (metadata + composition `state` + `revision`), to read-before-write. Pass the returned
   * `revision` back as `applyEditorOps`'s `expectedRevision`. By DEFAULT `state` is a lightweight SUMMARY (per-clip
   * / per-layer structure, heavy payloads dropped); pass `detail:'full'` for the complete composition. For a
   * timeline, `fromFrame`/`toFrame` (+ `trackId`) scope the read to the clips overlapping that frame window; for a
   * canvas, `slideId` scopes it to a single slide, and applies to `detail:'full'` too so asking for one slide's
   * detail does not pay for the whole deck. A canvas summary echoes each text layer's `text` (truncated), which is
   * what identifies it. Requires the `editor:read` scope.
   */
  async getProject(
    projectId: string,
    options: {
      detail?: 'summary' | 'full'
      fromFrame?: number
      toFrame?: number
      trackId?: string
      slideId?: string
    } = {},
  ): Promise<ProjectDetail> {
    const params = new URLSearchParams()
    if (options.detail === 'full') params.set('detail', 'full')
    if (typeof options.fromFrame === 'number') params.set('fromFrame', String(options.fromFrame))
    if (typeof options.toFrame === 'number') params.set('toFrame', String(options.toFrame))
    if (options.trackId) params.set('trackId', options.trackId)
    if (options.slideId) params.set('slideId', options.slideId)
    const qs = params.toString() ? `?${params.toString()}` : ''
    const { project } = await this.request<{ project: ProjectDetail }>(
      'GET',
      `/api/v1/projects/${encodeURIComponent(projectId)}${qs}`,
    )
    return project
  }

  /**
   * Read the LIVE context of what the user is currently viewing in the open app: the active surface + focus +
   * selection, so an agent can operate on "what the user is looking at" like the internal assistant does. Fast
   * and structured by default. Pass `capture: true` to also ping the live tab for a fresh viewport screenshot
   * (returned as a short-lived `snapshotUrl`) when you need the user's screen as shown. To see the COMPOSED
   * OUTPUT itself, pass `render: true` with the frames to draw, or `sound: true` to measure a range's mix
   * (`GetContextInput`); the render is a job whose answer carries its images inline as data URLs and a `renderId`
   * to read the rest with. It is ephemeral and does not need a live tab. Returns the most-recent-active session's
   * context plus the full live participant set. Optionally scope to one project. Requires the `context:read` scope.
   */
  async getContext(input: GetContextInput = {}): Promise<LiveContextResult> {
    const params = new URLSearchParams()
    if (input.projectId) params.set('projectId', input.projectId)
    if (input.capture) params.set('capture', 'true')
    if (input.render) params.set('render', 'true')
    if (typeof input.frame === 'number') params.set('frame', String(input.frame))
    if (input.slideId) params.set('slideId', input.slideId)
    if (typeof input.slideIndex === 'number') params.set('slideIndex', String(input.slideIndex))
    if (typeof input.fromFrame === 'number') params.set('fromFrame', String(input.fromFrame))
    if (typeof input.toFrame === 'number') params.set('toFrame', String(input.toFrame))
    if (typeof input.count === 'number') params.set('count', String(input.count))
    if (input.frames?.length) params.set('frames', input.frames.join(','))
    if (typeof input.perSecond === 'number') params.set('perSecond', String(input.perSecond))
    if (input.layout) params.set('layout', input.layout)
    if (input.sound) params.set('sound', 'true')
    if (input.renderId) params.set('renderId', input.renderId)
    if (typeof input.page === 'number') params.set('page', String(input.page))
    if (typeof input.wait === 'number') params.set('wait', String(input.wait))
    if (typeof input.width === 'number') params.set('width', String(input.width))
    if (input.region) {
      const { x, y, width, height } = input.region
      params.set('region', `${x},${y},${width},${height}`)
    }
    // Canonical URI encoding: URLSearchParams renders a space as '+', which is x-www-form-urlencoded, not the
    // RFC-3986 query encoding; emit %20 so the URL is canonical (both decode to a space server-side).
    const query = params.toString().replace(/\+/g, '%20')
    const qs = query ? `?${query}` : ''
    return this.request<LiveContextResult>('GET', `/api/v1/context${qs}`)
  }

  /**
   * Create a project. All fields optional; the server applies the same defaults as the in-app new-project
   * flow (16:9 landscape, `editor` kind). A new canvas starts with one empty slide; a new editor starts with
   * an empty timeline. Returns the full detail (with its id + starting revision) so you can immediately apply
   * ops. Requires the `editor:write` scope.
   */
  async createProject(input: CreateProjectInput = {}): Promise<ProjectDetail> {
    const { project } = await this.request<{ project: ProjectDetail }>('POST', '/api/v1/projects', input)
    return project
  }

  /**
   * Import a PowerPoint / Google Slides file (by URL) or a Canva design (by id) into a NEW canvas project
   * with editable layers, returning the created project's full detail. The Canva source uses the caller's
   * Canva connection (a ConflictError-like 400 with code 'canva_not_connected' if not connected). Structured
   * import can take a while (export + convert + parse). Requires the `editor:write` scope.
   */
  async importProject(input: ImportProjectInput): Promise<ProjectDetail> {
    const { project } = await this.request<{ project: ProjectDetail }>('POST', '/api/v1/projects/import', input)
    return project
  }

  /**
   * PERMANENTLY delete a project (irreversible hard delete, distinct from the reversible archive). The
   * `?confirm=true` opt-in is sent for you. To reversibly hide a project instead, use `archive`. Requires
   * the `editor:write` scope.
   */
  async deleteProject(projectId: string): Promise<void> {
    await this.request<{ success: boolean }>(
      'DELETE',
      `/api/v1/projects/${encodeURIComponent(projectId)}?confirm=true`,
    )
  }

  /**
   * Change a project's own fields: rename it, resize it, choose its brand kit, choose or frame its cover. A PATCH: a
   * field left out is left alone, and `brandKitId` / `coverPosition` take `null` to clear them. Returns the project's
   * summary as it now stands. Requires the `editor:write` scope.
   */
  async updateProject(projectId: string, input: UpdateProjectInput): Promise<ProjectSummary> {
    const { project } = await this.request<{ project: ProjectSummary }>(
      'PATCH',
      `/api/v1/projects/${encodeURIComponent(projectId)}`,
      input,
    )
    return project
  }

  /**
   * Copy a project: the same type, size, composition and brand kit, titled as the editor titles a copy. Returns the
   * new project. Requires the `editor:write` scope.
   */
  async duplicateProject(projectId: string): Promise<ProjectSummary> {
    const { project } = await this.request<{ project: ProjectSummary }>(
      'POST',
      `/api/v1/projects/${encodeURIComponent(projectId)}/duplicate`,
    )
    return project
  }

  /**
   * Make a project's public live link, or revoke it with `shared: false` (a revoked link stays dead). The link shows the
   * project as it is now, and a project has one: sharing a shared project returns its link. Idempotent both ways.
   * `getProject` reads the link too. Requires `editor:write`.
   */
  async shareProject(projectId: string, input: ShareProjectInput = {}): Promise<ProjectShare> {
    return this.request<ProjectShare>('POST', `/api/v1/projects/${encodeURIComponent(projectId)}/share`, input)
  }

  /** A video project's timeline settings for the caller, as the editor's timeline settings menu holds them. Requires `editor:read`. */
  async getTimelineSettings(projectId: string): Promise<TimelineSettings> {
    const { settings } = await this.request<{ settings: TimelineSettings }>(
      'GET',
      `/api/v1/projects/${encodeURIComponent(projectId)}/settings`,
    )
    return settings
  }

  /** Change some of a video project's timeline settings; returns all of them. Requires `editor:write`. */
  async updateTimelineSettings(projectId: string, change: TimelineSettingsChange): Promise<TimelineSettings> {
    const { settings } = await this.request<{ settings: TimelineSettings }>(
      'PATCH',
      `/api/v1/projects/${encodeURIComponent(projectId)}/settings`,
      change,
    )
    return settings
  }

  // ─── Version history (premium, as in the editor) ───────────────────────────

  /** A project's saved versions, newest first, a page at a time. Requires `editor:read`. */
  async listProjectVersions(projectId: string, options: PageOptions = {}): Promise<ProjectVersionListResult> {
    const q = new URLSearchParams()
    setPage(q, options)
    return this.request<ProjectVersionListResult>(
      'GET',
      `/api/v1/projects/${encodeURIComponent(projectId)}/versions${queryOf(q)}`,
    )
  }

  /** Save the project's current state as a version, optionally named. Requires `editor:write`. */
  async saveProjectVersion(projectId: string, options: { label?: string } = {}): Promise<SavedProjectVersion> {
    const { version } = await this.request<{ version: SavedProjectVersion }>(
      'POST',
      `/api/v1/projects/${encodeURIComponent(projectId)}/versions`,
      options.label !== undefined ? { label: options.label } : {},
    )
    return version
  }

  /**
   * Put a version back into its project. The current state is saved as a version first, so the restore can itself be
   * restored. Returns the project's new revision. Requires `editor:write`.
   */
  async restoreProjectVersion(projectId: string, versionId: string): Promise<RestoredProjectVersion> {
    return this.request<RestoredProjectVersion>('POST', versionPath(projectId, versionId), { action: 'restore' })
  }

  /** Make a new project from a version. Returns the new project. Requires `editor:write`. */
  async copyProjectVersion(projectId: string, versionId: string): Promise<ProjectSummary> {
    const { project } = await this.request<{ project: ProjectSummary }>('POST', versionPath(projectId, versionId), {
      action: 'copy',
    })
    return project
  }

  /** Name a version; an empty label clears its name. Requires `editor:write`. */
  async renameProjectVersion(projectId: string, versionId: string, label: string): Promise<{ id: string; label: string | null }> {
    const { version } = await this.request<{ version: { id: string; label: string | null } }>(
      'PATCH',
      versionPath(projectId, versionId),
      { label },
    )
    return version
  }

  /** Remove a version. Requires `editor:write`. */
  async deleteProjectVersion(projectId: string, versionId: string): Promise<void> {
    await this.request<{ deleted: boolean }>('DELETE', versionPath(projectId, versionId))
  }

  // ─── Undo and redo (the editor's own) ──────────────────────────────────────

  /**
   * Reverse the project's most recent edit, or `revision`. An undo is itself an edit with its own revision; pass
   * `expectedRevision` to be refused with a 409 ConflictError when the project has moved since. Requires
   * `editor:write`.
   */
  async undo(projectId: string, input: UndoInput = {}): Promise<UndoResult> {
    return this.request<UndoResult>('POST', `/api/v1/projects/${encodeURIComponent(projectId)}/undo`, input)
  }

  /** Re-apply the edit most recently undone. Same concurrency check as `undo`. Requires `editor:write`. */
  async redo(projectId: string, input: RedoInput = {}): Promise<UndoResult> {
    return this.request<UndoResult>('POST', `/api/v1/projects/${encodeURIComponent(projectId)}/redo`, input)
  }

  /**
   * Apply a batch of ops to a project's composition (canvas slides or editor timeline) and persist
   * atomically. The project's `type` selects the op vocabulary; the ops run through the same reducers the manual
   * UI and in-app agent use. Requires the `editor:write` scope.
   *
   * Optimistic concurrency: pass `expectedRevision` (from `getProject`) to fail with a 409 ConflictError if
   * a concurrent edit landed, instead of clobbering it. Returns the new revision and the per-op results (a
   * bad op is reported, never throws).
   *
   * Each op is given a client-generated `opId` (uuid) here if it does not already have one, so the op has a
   * stable identity from the point of intent: resending the same batch is idempotent (the server dedupes by
   * opId), and a live editor sees the edit as an attributed collaborator change keyed by that id. The
   * assigned id is echoed back on each result's `opId`.
   */
  async applyEditorOps(input: ApplyEditorOpsInput): Promise<ApplyEditorOpsResult> {
    const ops = input.ops.map((op) =>
      typeof op.opId === 'string' && op.opId ? op : { ...op, opId: globalThis.crypto.randomUUID() },
    )
    return this.request<ApplyEditorOpsResult>('POST', '/api/v1/editor/ops', { ...input, ops })
  }

  /**
   * Start an export (render) of a project's saved composition. `mp4` returns a job with status 'rendering'
   * (poll with getExport or use exportProjectAndWait); canvas still/document formats (png/jpg/pdf/pptx) run
   * synchronously and return 'completed' with the outputUrl. Requires the `editor:write` scope.
   */
  async startExport(projectId: string, input: StartExportInput = {}): Promise<ExportJob> {
    return this.request<ExportJob>('POST', `/api/v1/projects/${encodeURIComponent(projectId)}/export`, input)
  }

  /**
   * A project's exports, newest first, a page at a time: every finished one with its file and share page, and the ones
   * still running, each with its `status` (poll one with `getExport`). A failed export is not listed. Requires
   * `editor:read`.
   */
  async listProjectExports(projectId: string, options: PageOptions = {}): Promise<ProjectExportListResult> {
    const q = new URLSearchParams()
    setPage(q, options)
    return this.request<ProjectExportListResult>(
      'GET',
      `/api/v1/projects/${encodeURIComponent(projectId)}/exports${queryOf(q)}`,
    )
  }

  /** Poll an export job by id. Requires the `editor:read` scope. */
  async getExport(exportId: string, init: { signal?: AbortSignal } = {}): Promise<ExportJob> {
    return this.request<ExportJob>('GET', `/api/v1/exports/${encodeURIComponent(exportId)}`, undefined, init)
  }

  /**
   * The authoring guide for a clip's code: what the sandbox has, the composition's units, the brand prop names, the
   * size limit, the workflow and examples, built by the app from the sandbox's own manifest. Read it before writing
   * code. Requires the `editor:read` scope.
   */
  async getCodeGuide(): Promise<CodeGuide> {
    return this.request<CodeGuide>('GET', '/api/v1/editor/code-guide')
  }

  /**
   * Every effect code or a video or image clip can use, by group: what it does, where code imports it, and
   * whether a clip can carry it. Requires the `editor:read` scope.
   */
  async listEffects(): Promise<EffectList> {
    return this.request<EffectList>('GET', '/api/v1/editor/effects')
  }

  /**
   * One effect in full: its parameters with their ranges and defaults, and which of them keyframe on a clip. Requires the
   * `editor:read` scope.
   */
  async getEffect(name: string): Promise<EffectDetail> {
    return this.request<EffectDetail>('GET', `/api/v1/editor/effects?name=${encodeURIComponent(name)}`)
  }

  /** The link contract: the grammar, nouns and sections of app addresses, and the origin. Any valid key reads it. */
  async getLinkFormats(): Promise<LinkFormats> {
    return this.request<LinkFormats>('GET', '/api/v1/link-formats')
  }

  /** The kind-aware catalog of export formats + their options. Requires the `editor:read` scope. */
  async getExportFormats(): Promise<ExportFormatCatalog> {
    return this.request<ExportFormatCatalog>('GET', '/api/v1/export-formats')
  }

  /**
   * Start an export and poll until it completes. Resolves with the completed job (outputUrl set), throws
   * `GenerationFailedError` on failure, or `GenerationTimeoutError` if it does not finish within `timeoutMs`
   * (the server job may still complete; re-poll with getExport).
   */
  async exportProjectAndWait(
    projectId: string,
    input: StartExportInput = {},
    options: WaitOptions = {},
  ): Promise<ExportJob> {
    const job = await this.startExport(projectId, input)
    if (job.status === 'completed' || job.status === 'failed') {
      if (job.status === 'failed') throw new GenerationFailedError(job.exportId, job.errorMessage ?? 'Export failed')
      return job
    }
    return this.waitForExport(job.exportId, options)
  }

  /** Poll an export job to a terminal state, within the same deadline rule as `waitForGeneration`. */
  async waitForExport(exportId: string, options: WaitOptions = {}): Promise<ExportJob> {
    return this.#pollWithin(
      (signal) => this.getExport(exportId, { signal }),
      (job) => {
        if (job.status === 'completed') return true
        if (job.status === 'failed') throw new GenerationFailedError(exportId, job.errorMessage ?? 'Export failed')
        return false
      },
      options,
      () => new GenerationTimeoutError(exportId),
    )
  }

  /**
   * The canvas schema, so you know what `update_canvas` ops can create and edit, in two steps, as the timeline's. With no
   * name, the index: every op with its shape, every layer type, and the rules every op follows. With `name`, one entry in
   * full: an op, or a layer type with its fields and the shared groups it has (`jsonSchema` adds its JSON Schema). With
   * `detail: 'full'`, the whole schema in one read. Requires the `editor:read` scope.
   */
  async getLayerTypes(options: EditorSchemaOptions & { detail: 'full' }): Promise<LayerTypeCatalog>
  async getLayerTypes(options: EditorSchemaOptions & { name: string }): Promise<LayerSchemaEntry>
  async getLayerTypes(options?: TypeCatalogOptions): Promise<LayerSchemaIndex>
  async getLayerTypes(options: EditorSchemaOptions): Promise<LayerSchemaIndex | LayerSchemaEntry | LayerTypeCatalog>
  async getLayerTypes(options: EditorSchemaOptions = {}): Promise<LayerSchemaIndex | LayerSchemaEntry | LayerTypeCatalog> {
    return this.request('GET', `/api/v1/editor/layer-types${schemaQuery(options)}`)
  }

  /**
   * The editor timeline schema, so you know what `update_timeline` ops can create and edit, in two steps. With no name,
   * the index: every op with its shape, every clip and track type, and the rules every op follows. With `name`, one entry in full: an op, a clip
   * type with its fields and the shared groups it has (`jsonSchema` adds its JSON Schema), or `animations`, the
   * presets. With `detail: 'full'`, the whole schema in one read. Requires the `editor:read` scope.
   */
  async getTimelineTypes(options: EditorSchemaOptions & { detail: 'full' }): Promise<TimelineTypeCatalog>
  async getTimelineTypes(options: EditorSchemaOptions & { name: string }): Promise<TimelineSchemaEntry>
  async getTimelineTypes(options?: TypeCatalogOptions): Promise<TimelineSchemaIndex>
  async getTimelineTypes(options: EditorSchemaOptions): Promise<TimelineSchemaIndex | TimelineSchemaEntry | TimelineTypeCatalog>
  async getTimelineTypes(options: EditorSchemaOptions = {}): Promise<TimelineSchemaIndex | TimelineSchemaEntry | TimelineTypeCatalog> {
    return this.request('GET', `/api/v1/editor/timeline-types${schemaQuery(options)}`)
  }

  /**
   * Read an editor project's transcript mapped to its timeline clips. Returns one segment per transcribable
   * primary-track clip, in timeline order, carrying the words spoken within it plus its current enabled/disabled
   * state, so you can read what is said, see which parts are already cut, and target exact clipIds with
   * update_timeline (disable_ranges / set_disabled / delete_ranges). Scope with `search` (substring) or
   * `startMs`/`endMs` (source-media time) to fetch only the part you need. Pass `granularity: 'word'` for
   * word-level timing (with absolute timeline frames), per-word confidence + speaker, derived silence gaps, and
   * non-speech audio events. `paceThresholdMs` (minimum pause to report as silence) and `paddingStartMs` /
   * `paddingEndMs` (breathing room kept around speech; negative tightens) tune the silence detection and default
   * to the project's saved pace/padding. Requires the `editor:read` scope.
   */
  async getTranscript(
    projectId: string,
    options: {
      search?: string
      startMs?: number
      endMs?: number
      granularity?: 'clip' | 'word'
      paceThresholdMs?: number
      paddingStartMs?: number
      paddingEndMs?: number
    } = {},
  ): Promise<TranscriptResult> {
    const params = new URLSearchParams({ projectId })
    if (options.search) params.set('search', options.search)
    if (options.startMs !== undefined) params.set('startMs', String(options.startMs))
    if (options.endMs !== undefined) params.set('endMs', String(options.endMs))
    if (options.granularity) params.set('granularity', options.granularity)
    if (options.paceThresholdMs !== undefined) params.set('paceThresholdMs', String(options.paceThresholdMs))
    if (options.paddingStartMs !== undefined) params.set('paddingStartMs', String(options.paddingStartMs))
    if (options.paddingEndMs !== undefined) params.set('paddingEndMs', String(options.paddingEndMs))
    return this.request<TranscriptResult>('GET', `/api/v1/editor/transcript?${params.toString()}`)
  }

  /** Issue an authenticated request and map non-2xx responses to typed errors. `signal` cuts it (a wait's deadline). */
  private async request<T>(method: string, path: string, body?: unknown, init: { signal?: AbortSignal } = {}): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json'

    // Release tracking (NOT a presence ping): presence is lit server-side, but the CLI still needs to clear its
    // badge promptly on exit, so record any project this client mutates by id. Local only, no extra request; the
    // activity endpoint manages its own lease and is skipped.
    if (body && typeof body === 'object' && !Array.isArray(body) && path !== '/api/v1/editor/activity') {
      const pid = (body as { projectId?: unknown }).projectId
      if (typeof pid === 'string' && pid) this.activityPingedAt.set(pid, Date.now())
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...(init.signal ? { signal: init.signal } : {}),
    })

    const text = await response.text()
    let data: unknown = undefined
    let nonJson = false
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = text
        nonJson = true
      }
    }

    if (!response.ok) {
      throw errorFromResponse(response.status, data, { requestId: response.headers.get('x-vercel-id') ?? undefined, nonJson })
    }
    return data as T
  }
}

/** Read an env var without assuming `process` exists (keeps non-Node bundles happy). */
/** A page's two parameters on a listing's query: the ONE place every paged listing writes them. */
function setPage(q: URLSearchParams, page: PageOptions): void {
  if (page.limit != null) q.set('limit', String(page.limit))
  if (page.cursor) q.set('cursor', page.cursor)
}

/** A sort's two parameters on a listing's query: the ONE place every sortable listing writes them. */
function setSort(q: URLSearchParams, sort: SortOptions<string>): void {
  if (sort.sort) q.set('sort', sort.sort)
  if (sort.order) q.set('order', sort.order)
}

/** One saved version's path. */
function versionPath(projectId: string, versionId: string): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(versionId)}`
}

/** A listing's query string, with its `?`, or nothing when it has no parameters. */
function queryOf(q: URLSearchParams): string {
  const qs = q.toString()
  return qs ? `?${qs}` : ''
}

function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env
  return env?.[name]
}

/**
 * A signal that aborts at `deadline` or when `outer` does, whichever is first. `expired` says the deadline was the
 * cause; `release` clears the timer. Written out rather than `AbortSignal.any`, which Node 20.0 to 20.2 lack.
 */
function deadlineSignal(deadline: number, outer?: AbortSignal): { signal: AbortSignal; expired: () => boolean; release: () => void } {
  const controller = new AbortController()
  let expired = false
  const timer = setTimeout(() => {
    expired = true
    controller.abort()
  }, Math.max(0, deadline - Date.now()))
  const onOuter = () => controller.abort()
  if (outer?.aborted) controller.abort()
  else outer?.addEventListener('abort', onOuter, { once: true })
  return {
    signal: controller.signal,
    expired: () => expired,
    release: () => {
      clearTimeout(timer)
      outer?.removeEventListener('abort', onOuter)
    },
  }
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

/**
 * The finished import a settled generation describes: the new item when it completed, or the one that already held
 * these bytes when it ended `abandoned`. `shortId` is the import's own, from `startImport`, since a generation
 * carries only its link. The one mapping, so `importMedia` and anything reading an import's status agree.
 */
export function importedMediaFrom(gen: Generation, shortId: string | null): ImportedMedia {
  const dup = gen.alreadyExisted
  if (gen.status === 'abandoned' && dup) {
    return {
      outputId: dup.outputId,
      url: dup.url,
      appUrl: dup.appUrl,
      shortId: dup.shortId,
      alreadyExisted: true,
      existing: { objectName: dup.objectName, role: dup.role, ownedBy: dup.ownedBy },
    }
  }
  return {
    outputId: gen.outputId,
    url: gen.outputs[0]?.url ?? '',
    appUrl: gen.appUrl,
    shortId,
    alreadyExisted: false,
    contentType: gen.contentType,
  }
}

/** A schema read's query, timeline or canvas: the catalog's own option, then the entry or the whole schema. */
function schemaQuery(options: EditorSchemaOptions): string {
  const parts = [
    ...(options.jsonSchema ? ['include=jsonSchema'] : []),
    ...(options.name !== undefined ? [`name=${encodeURIComponent(options.name)}`] : []),
    ...(options.detail !== undefined ? [`detail=${encodeURIComponent(options.detail)}`] : []),
  ]
  return parts.length ? `?${parts.join('&')}` : ''
}
