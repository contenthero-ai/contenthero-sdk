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
 * output id, its short id or its first 8 characters, any with a `-N` variation suffix
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
   * Kling elements (Kling 3.0), each addressable in the prompt as @name. Requires
   * a startFrame alongside them. See get_model's promptReferences for which models
   * support them.
   */
  klingElements?: ReferenceKlingElement[]
  /** @deprecated Alias for `klingElements`, accepted for one release window. `klingElements` wins if both are set. */
  elements?: ReferenceKlingElement[]
}

/**
 * A Kling element in a generation: a named group of reference images, addressable
 * in the prompt as @name (Kling 3.0). Provide EITHER a saved Kling element by
 * `klingElementId`, OR define one inline with `name` + `images`.
 */
export interface ReferenceKlingElement {
  /** Reference a saved Kling element by id (resolves to its name + images). */
  klingElementId?: string
  /** @deprecated Alias for `klingElementId`, accepted for one release window. `klingElementId` wins if both are set. */
  elementId?: string
  /** Inline: referenced in the prompt as @name. */
  name?: string
  /** Inline: what the Kling element represents (passed to the provider for conditioning). */
  description?: string
  /** Inline: supporting image URLs or output-id tokens for this Kling element. */
  images?: string[]
}

/** @deprecated Use `ReferenceKlingElement`. */
export type ReferenceElement = ReferenceKlingElement

/**
 * A saved Kling element in the account's library (the persistent form): Kling 3.0's reusable reference for a
 * character, location or prop. Named `KlingElement` since 2026-10-04, because "element" alone also names the
 * editor's Elements panel; `Element` stays as an alias so no import breaks.
 */
export interface KlingElement {
  id: string
  /** The item's 8-character public id, used in app links and shown to people; `id` stays the UUID. */
  shortId: string
  /** This item in the app: open it in the browser. Built from the id alone: the API path on the app host. */
  appUrl: string
  name: string
  /** 'auto' | 'character' | 'location' | 'prop'. */
  category: string
  description: string | null
  /** The Kling element's supporting image URLs. */
  inputUrls: string[]
  /** A single supporting video URL (alternative to images), if any. */
  inputVideoUrl: string | null
  /** A representative image/video URL for previews. */
  previewUrl: string
  createdAt: string
  updatedAt?: string
}

/** @deprecated Use `KlingElement`. */
export type Element = KlingElement

/** Result of `listKlingElements`: a page of the account's saved Kling elements, newest first. */
export interface KlingElementListResult extends Paged {
  klingElements: KlingElement[]
}

/** Create a Kling element from 2-4 images (or 1 video). Inputs may be URLs or output-id tokens. */
export interface CreateKlingElementRequest {
  name: string
  description: string
  /** 'auto' | 'character' | 'location' | 'prop' (default 'auto'). */
  category?: string
  /** 2-4 image URLs or output-id tokens (one of images/video is required). */
  images?: string[]
  /** A single video URL or output-id token (alternative to images). */
  video?: string
}

/** @deprecated Use `CreateKlingElementRequest`. */
export type CreateElementRequest = CreateKlingElementRequest

// ---------------------------------------------------------------------------
// Paging: the one shape every paged listing takes and returns
// ---------------------------------------------------------------------------

/**
 * A page of a listing: how many, and where the page before ended. A cursor is opaque and belongs to the listing and
 * the filters that produced it; one passed with other filters or another sort is refused.
 */
export interface PageOptions {
  /** How many to return. The server sets the default and the maximum. */
  limit?: number
  /** The `nextCursor` of the page before. Omitted, the first page. */
  cursor?: string
}

/** What every paged listing returns beside its items. */
export interface Paged {
  /** Pass as `cursor` for the next page; null on the last. */
  nextCursor: string | null
}

// ---------------------------------------------------------------------------
// Sorting: the one shape every sortable listing takes
// ---------------------------------------------------------------------------

/**
 * Every field each sortable listing orders by, as the API declares them (the app's `LIST_SORTS`). A sort value is the
 * name of the response field it orders by. ONE declaration: the SDK's option types, the MCP tool schemas and the CLI's
 * `--sort` choices all read from here, so a field cannot reach one surface and not the others.
 *
 * `relevance` orders a search's results, and the server refuses it without a search. `fileName` orders media by a name a
 * person gave, so the server refuses it for creations, which have none. A card's `position` is one stage's own order,
 * top first, so it needs a stage.
 */
export const LIST_SORTS = {
  cards: ['updatedAt', 'createdAt', 'scheduledAt', 'title', 'position'],
  projects: ['updatedAt', 'createdAt', 'title'],
  spaces: ['updatedAt', 'name', 'cardCount'],
  content: ['relevance', 'outlierScore', 'publishedAt', 'viewCount', 'engagementRate'],
  media: ['createdAt', 'fileName', 'sizeBytes'],
} as const

/** A listing that sorts. */
export type SortableList = keyof typeof LIST_SORTS

/** The fields one listing sorts by. */
export type SortFieldOf<L extends SortableList> = (typeof LIST_SORTS)[L][number]

export type CardSort = SortFieldOf<'cards'>
export type ProjectSort = SortFieldOf<'projects'>
export type SpaceSort = SortFieldOf<'spaces'>
export type ContentSort = SortFieldOf<'content'>
export type MediaSort = SortFieldOf<'media'>

// ---------------------------------------------------------------------------
// Placement: how every hand-arranged list moves an item
// ---------------------------------------------------------------------------

/** The two ends of a hand-arranged list. */
export const PLACEMENT_ENDS = ['top', 'bottom'] as const
export type PlacementEnd = (typeof PLACEMENT_ENDS)[number]

/**
 * Where an item lands in a hand-arranged list: after a named neighbor, before one, between two, or at an end. Never a
 * number: the server derives the place from the neighbors as they are. Neighbors and `position` together are refused,
 * since they can disagree. Naming none leaves the item where it is.
 */
export interface Placement {
  /** The item it lands immediately after, from the same list. */
  afterId?: string
  /** The item it lands immediately before, from the same list. */
  beforeId?: string
  /** An end of the list, instead of a neighbor. */
  position?: PlacementEnd
}

/** The direction of every sort: one word, two values. */
export const SORT_ORDERS = ['asc', 'desc'] as const
export type SortOrder = (typeof SORT_ORDERS)[number]

/**
 * How a sortable listing is ordered: a field of that listing and a direction. Either may be omitted and the server
 * fills in its default; an order named alone applies to the default field. A value the listing does not have is
 * refused, never ignored.
 */
export interface SortOptions<F extends string> {
  sort?: F
  order?: SortOrder
}

// ---------------------------------------------------------------------------
// Templates (the editor's Elements: reusable code, shapes and animated emoji)
// ---------------------------------------------------------------------------

/** What a template draws: code (which may play a Lottie file), a shape, or an animated emoji. */
export type TemplateKind = 'code' | 'shape' | 'emoji'

/** Whose templates: ContentHero's, the caller's own, or both. */
export type TemplateScope = 'system' | 'user' | 'all'

/**
 * A template in a list: everything but its code. ContentHero's (`scope: 'system'`) are read-only; the caller's own
 * (`'user'`) can be changed and deleted. A placed copy is a snapshot: changing a template never changes a clip.
 */
export interface TemplateSummary {
  id: string
  scope: 'system' | 'user'
  kind: TemplateKind
  category: string
  name: string
  description: string | null
  /** What it makes: a video, or a shape (with the shape's name); an animated emoji's video names its emoji. */
  skeleton: { type: 'video' | 'shape'; shape?: string; emoji?: string } | null
  /** Its default box: the whole frame, or a fraction of the canvas on each axis. */
  coverage: 'full' | 'partial'
  /** `scale` keeps its proportions in any box; `reflow` lays out again in the box it is given. */
  resize: 'scale' | 'reflow'
  widthFraction: number | null
  heightFraction: number | null
  /** Its own width over height, for `resize: 'scale'`. */
  aspect: number | null
  /**
   * The coordinate space its artwork is drawn in, and the rectangle of it (`content`) that is the element; null when
   * the artwork draws to its box. Nested the way a write sends it.
   */
  artboard: TemplateArtboard | null
  /** Moves when its code, props or controls change; a rename leaves it. Pass it back as `expectedVersion`. */
  version: number
  /** Its props as placed, before the brand kit's values fill the props it binds. */
  props: Record<string, unknown>
  /** Each prop's control (`control`, `label`, `default`, and `brand`, the brand value it takes when placed). */
  propsSchema: Record<string, unknown> | null
  thumbnailUrl: string | null
  previewUrl: string | null
  durationFrames: number
  tags: string[] | null
  groupKey: string | null
  subgroupKey: string | null
  archivedAt: string | null
  /** Lineage: the template it was saved from, and that template's version then. */
  sourceTemplateId: string | null
  sourceTemplateVersion: number | null
  /** How it was made: through `app`, `api`, `mcp` or `cli`, by a `person` or an `agent`. */
  channel: string | null
  actor: string | null
  /** Its code's md5: equal codes, equal fingerprints. Null for a template with no code. */
  codeMd5: string | null
  createdAt: string
  updatedAt: string
}

/** A template's artboard: its size, and the rectangle of it that is the element. */
export interface TemplateArtboard {
  width: number
  height: number
  content: { x: number; y: number; width: number; height: number }
}

/** One template, whole: with its code (null for a shape, which draws without one). */
export interface Template extends TemplateSummary {
  code: string | null
}

export interface ListTemplatesOptions extends PageOptions {
  /** `all` (the default), `system` (ContentHero's) or `user` (the caller's own). */
  scope?: TemplateScope
  kind?: TemplateKind
  /** One category or several. */
  category?: string | string[]
  /** Every word, in any order, in the name or the tags. */
  search?: string
  /** `only` lists archived templates, to restore one; they are left out otherwise. */
  archived?: 'only'
}

export interface TemplateListResult extends Paged {
  templates: TemplateSummary[]
}

/** Options for `listTemplateCategories`. */
export interface ListTemplateCategoriesOptions extends PageOptions {
  scope?: TemplateScope
}

/** Result of `listTemplateCategories`: a page of the categories in use, with how many templates each holds. */
export interface TemplateCategoryListResult extends Paged {
  categories: Array<{ category: string; count: number }>
}

/**
 * A template's fields as a write takes them. On a create, exactly one of `code`, `lottie`, `emoji` or `shape` says
 * what it draws, unless it is saved from an item or copied from a template.
 */
export interface TemplateFields {
  name?: string
  category?: string
  description?: string | null
  tags?: string[]
  /** The code: checked as it is written, refused when it does not compile. */
  code?: string
  /** A Lottie file of ours, and the colors in it that take props (each `role` is a prop name). */
  lottie?: { url: string; recolor?: Array<{ from: string; role: string }> }
  /** An animated emoji's name, as the animated emoji list names it. */
  emoji?: string
  /** A shape's name, as the shape layer type lists them in get_schema kind 'layer'. */
  shape?: string
  props?: Record<string, unknown>
  propsSchema?: Record<string, unknown> | null
  durationFrames?: number
  coverage?: 'full' | 'partial'
  /** Its default box, a fraction of the canvas on each axis, for `coverage: 'partial'`. */
  widthFraction?: number | null
  heightFraction?: number | null
  resize?: 'scale' | 'reflow'
  aspect?: number | null
  artboard?: { width: number; height: number; content: { x: number; y: number; width: number; height: number } } | null
  thumbnailUrl?: string | null
  previewUrl?: string | null
  /** Lineage, which `fromItem` and `fromTemplateId` set for you: kept only for a template the caller can see. */
  sourceTemplateId?: string | null
  sourceTemplateVersion?: number | null
}

/**
 * Save a template, from exactly one source: its fields; `fromItem`, a code clip, code layer or shape placed on a
 * project (its code, props, controls and box, as fractions of that canvas); or `fromTemplateId`, a copy (with its
 * lineage). Fields given beside `fromItem` or `fromTemplateId` override what it carries.
 */
export type CreateTemplateRequest = Placement &
  (
    | TemplateFields
    | (TemplateFields & { fromItem: { projectId: string; itemId: string } })
    | (TemplateFields & { fromTemplateId: string })
  )

/** A write's result: the template as stored, and what the checks warned about (written anyway). */
export interface TemplateWriteResult {
  template: Template
  warnings: string[]
}

/**
 * A generation request. `modelId` is always required. For image/video the
 * `prompt` and typed-core fields apply; for audio (ElevenLabs) the audio fields
 * apply. Anything a specific model supports beyond the typed core can be passed
 * through `parameters`.
 */
export interface GenerateRequest {
  /** Media kind. Optional: inferred from the model when omitted; when given, a model of another medium is refused. */
  contentType?: 'image' | 'video' | 'audio'
  /**
   * The work this call asks for, in the registry's words (a model's `kind` in `listModels`). Optional; when given,
   * the server refuses a model that does other work and names the models that do this work, instead of running
   * whatever the model does.
   */
  kind?: 'generate' | 'upscale' | 'lip-sync' | 'background-removal' | 'layer-separation'
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
  /**
   * Video edit only, on models that offer it: keep the input video's full length instead of a set `duration`
   * (pass one or the other). Charged for that length, as measured by the server.
   */
  keepInputLength?: boolean
  /** Enable generated audio on video models that support it. */
  audioEnabled?: boolean
  negativePrompt?: string
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
   * also know the id up front and can poll `getStatus` immediately.
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
  /** Optional interactive-fallback playhead frame (echo one from view for playhead-relative placement). */
  playheadFrame?: number
}

/**
 * A Reference Board type: one of the `boardTypes` that `getModel('reference-boards')` lists.
 *
 * A string, not a union: the server's list is the only one, and a copy here would fall behind it. The server
 * refuses a type it does not know, naming the valid ones.
 */
export type BoardType = string

/** One board type as `getModel('reference-boards')` lists it. */
export interface BoardTypeInfo {
  boardType: BoardType
  label: string
  /** What the type is for. */
  summary: string
}

/**
 * A Reference Board generation request. A board is a dense multi-panel reference
 * sheet built from a source image and/or a written description, on a fixed
 * pipeline (3:4 / 4K). Provide at least one of `referenceImages` or `prompt`.
 */
export interface GenerateBoardRequest {
  /** One of the board types `getModel('reference-boards')` lists. Required. */
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

/**
 * Lifecycle state of a generation.
 *
 * `abandoned` is terminal and NOT a failure: the row was set aside with no output of its own. An import whose bytes
 * were already in the account ends this way (see `Generation.alreadyExisted`), as does a discarded voice variant.
 */
export type GenerationStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'abandoned'

/**
 * What a paid call cost: the receipt on every paid response and status read (one shape everywhere).
 *
 * - `charged`: `credits` is what was charged, in total (the sum of this item's ledger rows, refunds included).
 * - `pending`: still running; `held` is what is set aside for it, charged when it finishes (per output landed).
 * - `free`: nothing was charged (it already existed, or cost nothing).
 *
 * `balanceAfter` is the account balance right after the last charge for this item, when there was one.
 */
export interface Charge {
  credits: number
  held: number
  state: 'charged' | 'pending' | 'free'
  balanceAfter: number | null
}

/**
 * One output of a generation, in slot order, named by its media reference.
 *
 * Replaces the index-aligned `outputUrls`, `appUrls`, `previewUrls`, `visionUrls` and `partialUrls`. `output_urls`
 * closes up around a failed output, so an index meant "output" in one array and "nth landed file" in another, and
 * output 4 of a generation with a failed output was linked and named `-3`. Each output now carries its own name,
 * file and links, so nothing is paired by index and no caller numbers anything.
 */
export interface GenerationOutput {
  /** This output's media reference (`a1B2c3D4-2`, or `a1B2c3D4` when its generation has one output): pass it anywhere one output is wanted. */
  mediaId: string
  /** Its own outcome: `succeeded`, `failed` or `pending` (the generation's status when none is recorded per output). */
  status: string
  /** Its file once it lands; null while pending and for a failed output. A running generation fills these in one at a time. */
  url: string | null
  /** This output in the app. */
  appUrl: string
  /**
   * The small `preview.webp` of `url`, or null where none exists. Read this, not the master, when showing a model:
   * a master is routinely 1.7 to 2.6 MB and cannot be inlined in a 1 MB tool result.
   *
   * ⛔ NEVER DERIVE THIS FROM `url` BY REWRITING THE PATH. These are capability URLs whose token names ONE object;
   * a rewritten path is refused with 403. The server mints this against a derivative it confirmed exists.
   * Present on a status read (`getGeneration`).
   */
  previewUrl?: string | null
  /** The 512px derivative of `url`, for inlining bytes; prefer it over `previewUrl` when attaching. Null where none. */
  visionUrl?: string | null
}

/**
 * Result of submitting a generation. Image/video return `status: 'processing'`
 * (poll with `getStatus`, or use `generateAndWait`). Audio is synchronous
 * and returns `status: 'completed'` with `outputs` already populated.
 */
export interface GenerateResult {
  outputId: string
  /**
   * Its short id: the id `getStatus` and `get_status` follow it by with no kind (the UUID needs kind `'output'`).
   * Absent from an older server.
   */
  shortId?: string
  /** This generation in the app (its first output, or its pending state while it runs). */
  appUrl: string
  status: 'processing' | 'completed'
  /** What it cost: held while it runs, charged per output when it finishes. */
  charge?: Charge
  /** Present when the result is already complete (audio, or a replayed id): its outputs in slot order. */
  outputs?: GenerationOutput[]
  /** Present when the result is already complete (audio): the model that produced it. */
  modelId?: string
  /**
   * How to show the model, from the registry, on every submit: the same fields a generation's status carries (see
   * `Generation.modelDisplayName`), so a card can name the model from its first frame without any copy of the model
   * list on the client. Null means show nothing; never substitute the id.
   */
  modelDisplayName?: string | null
  modelBrandColor?: string | null
  modelIconKey?: string | null
  /**
   * The shape ("W:H") the output was recorded at on submit, the value every surface draws its placeholder from. It
   * follows the driving input on a model whose output does, whatever ratio was asked for. Null when not yet known.
   */
  displayAspect?: string | null
  /** True when a client-supplied `outputId` matched an existing job (no new work was started). */
  idempotentReplay?: boolean
  /** Where the asset is being placed (present only when `projectId` was supplied). Lets a caller chain further
   *  ops onto the placed clip/layer without a view hop, and see any placement warnings. */
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
  /** 'canvas' when placed as a layer on a slide, 'editor' when placed as a clip on a track: the project's type. */
  projectType?: ProjectType
  /** @deprecated Alias for `projectType`, still emitted for one release window. */
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

/** What `editAudio` does: isolate the voice, or enhance (level loudness and clean up noise). */
export type EditAudioOperation = 'isolate' | 'enhance'

export interface EditAudioRequest {
  /**
   * The operation to perform. The server picks the model that performs it from its registry, so the caller never
   * names a vendor. Omitted: `enhance` in in-place mode, else `isolate`.
   */
  operation?: EditAudioOperation
  /** A model id instead of an operation; it resolves to the operation that model performs. Prefer `operation`. */
  modelId?: string
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
  /** Optional interactive-fallback playhead frame (echo one from view for playhead-relative placement). */
  playheadFrame?: number
  /**
   * IN-PLACE mode: enhance the audio OF EXISTING CLIPS on `projectId`, rather than processing a standalone file.
   *
   * Requires `projectId`; the operation is `enhance` (implied). Omitting `clipIds` while passing
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
  /**
   * Its short id: the id `getStatus` and `get_status` follow it by with no kind (the UUID needs kind `'output'`).
   * Absent from an older server.
   */
  shortId?: string
  /** This job's result in the app. Absent from an older server. */
  appUrl?: string
  /** What this job cost (held while it runs). */
  charge?: Charge
  /** Every clip this job's pieces will be applied to. */
  clipIds: string[]
  /** How many distinct windows were concatenated into this job. */
  windows: number
}

/**
 * The result of `editAudio`, which serves two shapes.
 *
 * FILE mode returns the `GenerateResult` fields. IN-PLACE mode returns `jobs`, one per source, and echoes
 * the first on `outputId` so a single-source project can be awaited without unpacking the list. `status` is
 * `'noop'` when the selection contained no audible audio, which is deliberately distinguishable from a failure.
 */
export interface EditAudioResult extends Omit<GenerateResult, 'status'> {
  status: 'processing' | 'completed' | 'noop'
  /** In-place mode only: one job per source. (`outputs` names a generation's own outputs, as in file mode.) */
  jobs?: EnhanceClipsJob[]
  /** In-place mode only: the project the pieces are applied to. */
  projectId?: string
  /** In-place mode only: selected clips skipped because they are silenced. */
  silencedClipsExcluded?: number
  /** Present with `status: 'noop'`, explaining why nothing ran. */
  note?: string
}

/** A generation record as returned by `getGeneration` and `generateAndWait`, and as an output's `JobStatus.detail`. */
export interface Generation {
  outputId: string
  /**
   * Its short id: the id `getStatus` and `get_status` follow it by with no kind (the UUID needs kind `'output'`).
   * Null while an editor effect's job has not yet written its record; absent from an older server.
   */
  shortId?: string | null
  /** This generation in the app (its first output, or its pending state while it runs). */
  appUrl: string
  status: GenerationStatus
  contentType: 'image' | 'video' | 'audio'
  modelId: string
  /**
   * Its outputs in slot order, each with its name, its file once it lands, its links and its previews. A running
   * generation fills these in one at a time; `status` remains the only terminal signal.
   */
  outputs: GenerationOutput[]
  /** Error detail when `status` is 'failed', otherwise null. */
  error: string | null
  /** What it was made FROM (its input references). Absent on the submit response and on an older server. */
  references?: GenerationReference[]
  /** What it cost: held while it runs, charged per output that landed. Absent on an older server. */
  charge?: Charge
  /** Present when an import ended `abandoned` because the account already held these exact bytes: where they are. */
  alreadyExisted?: ImportDuplicate
  createdAt: string
  completedAt: string | null
  /** The terminal signal to await when a generation carries a project PLACEMENT (a fresh asset placed on a canvas
   *  / timeline, or an in-place background removal): true once the output exists AND its placement side-effect
   *  (the placeholder->asset swap, the cutout, a background promotion) has been applied to the project. `status`
   *  flips to 'completed' when the asset exists and billing settles, which can precede the swap; an output's
   *  `JobStatus.state` is 'completed' only once this is true, so "done" always implies the visible composition change
   *  is in. Outputs with no placement are settled as soon as they complete. */
  settled?: boolean
  /** Where the asset was placed (present only when `projectId` was supplied to generate). Carried from the submit
   *  response through `generateAndWait` so a caller gets the placement outcome alongside the finished asset. */
  placement?: PlacementResult
  /** The prompt this generation was made from, VERBATIM. Some are JSON-shaped because the person authored a
   *  structured prompt and the model received that object; it is not a wrapper to unwrap. Absent on the submit
   *  response and on older servers. */
  prompt?: string | null
  /** The output's canonical aspect ratio as `"W:H"` (e.g. `"9:16"`). Null for audio, which has no shape.
   *  Absent on the submit response and on older servers. */
  displayAspect?: string | null
  /**
   * What a person should read for the model, resolved server-side from the registry.
   *
   * ⛔ **NULL MEANS SHOW NOTHING. NEVER SUBSTITUTE `modelId`.** A model id reads enough like a label that
   * printing one turns a resolution failure into a cosmetic inconsistency nobody can diagnose.
   *
   * ⚠️ It is not always this generation's own model: a look assembled from an existing output names the
   * model that produced the SOURCE, and an upload or import names what it is rather than a model.
   */
  modelDisplayName?: string | null
  /** Brand accent (hex) for the model, from the registry. Null when there is no model to brand. */
  modelBrandColor?: string | null
  /** Stable brand family key (e.g. `"openai"`) for mapping to an icon. NOT the model id. */
  modelIconKey?: string | null
}

/** Subscription tiers the API normalizes balances against. */
export type SubscriptionTier = 'mortal' | 'hero' | 'champion' | 'legend'

/** Your ContentHero account, as `getAccount` returns it (not a tracked social account: `TrackedAccountDetail`). */
export interface Account {
  balance: number
  /** What can be spent now: the balance less `held`. */
  available: number
  /** Credits set aside for work still running (charged when it finishes, returned if it fails). */
  held: number
  /** Credits charged this calendar month (UTC). */
  spentThisMonth: number
  /** The account's monthly spend cap, or null when none is set (no cap). */
  spendCap: { limit: number; remaining: number; resetsAt: string } | null
  tier: SubscriptionTier
  autoTopupEnabled: boolean
}

/** The fields `updateAccount` can change; only those passed change. */
export interface AccountUpdate {
  /** The monthly spend cap in credits, or null for no cap. Needs `billing:write` and the account's owner. */
  spendCap?: number | null
}

/** Options for `generateAndWait`'s polling behavior. */
export interface WaitOptions {
  /** Milliseconds between status polls. Default 3000. */
  pollIntervalMs?: number
  /**
   * Give up after this many milliseconds. Default 600000 (10 minutes). The wait never runs past it: a status read
   * still in flight at the deadline is cut, and the last pause is shortened to fit, so a caller with its own time
   * limit (an MCP host's 60 seconds) can rely on it. The timeout error carries the last status read.
   */
  timeoutMs?: number
  /** Abort the wait (does not cancel the server-side job). */
  signal?: AbortSignal
  /** Called with every status read, so a caller can show progress: a generation's outputs land one at a time. */
  onPoll?: (generation: Generation) => void
}

/**
 * The kinds of background job `getStatus` reads. An id alone names most jobs; the kind is needed only for a full
 * UUID, for the kinds in `KINDS_NAMED_BY_KIND`, or when the server says an id is ambiguous.
 */
export const JOB_KINDS = ['output', 'export', 'brand_kit', 'avatar', 'content', 'scenes', 'transcript'] as const
export type JobKind = (typeof JOB_KINDS)[number]

/**
 * The kinds whose id is something else's, so the id alone names a different job: a post's scene map and a transcript
 * are read by the post's (or the media's) id, which alone names the post's analysis. Waiting on one passes its kind.
 */
export const KINDS_NAMED_BY_KIND: readonly JobKind[] = ['scenes', 'transcript']

/**
 * How `getStatus` follows a job, from the handle the call that started it returned: its short id alone, with its kind
 * only where the id names something else's job (`KINDS_NAMED_BY_KIND`); otherwise its full id with its kind, since a
 * UUID alone names no table. The one rule every surface prints its wait from.
 */
export function statusTarget(job: { id: string; shortId?: string | null; kind: JobKind }): { id: string; kind?: JobKind } {
  if (job.shortId) return KINDS_NAMED_BY_KIND.includes(job.kind) ? { id: job.shortId, kind: job.kind } : { id: job.shortId }
  return { id: job.id, kind: job.kind }
}

/** A full id: the UUID shape, which names no table alone. */
const FULL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * How to read a job's status again from a status already read: its `id` is its short id where it has one, and a full
 * id (a job whose record is not yet written) needs its kind, as in `statusTarget`.
 */
export function statusTargetOf(status: { id: string; kind: JobKind }): { id: string; kind?: JobKind } {
  return statusTarget({ id: status.id, shortId: FULL_ID.test(status.id) ? null : status.id, kind: status.kind })
}

/** Where a background job is. `completed` and `failed` are terminal; the other two mean it is still going. */
export type JobState = 'queued' | 'processing' | 'completed' | 'failed'

/** One named step of a job that runs in stages (a brand kit's website read and its analysis). */
export interface JobStep {
  name: string
  state: JobState
  /** Why the step failed, null otherwise. */
  reason: string | null
}

/** What a transcript job carries: its own status and the media or post it belongs to. */
export interface TranscriptJobDetail {
  status: string
  mediaId: string
}

/** The fields every job status has; `detail` is the kind's own resource body. */
interface JobStatusOf<K extends JobKind, D> {
  kind: K
  /** The job's public id (its short id where it has one). */
  id: string
  state: JobState
  /** Why it failed, null otherwise. */
  reason: string | null
  appUrl: string | null
  /** 0 to 1 where the kind reports progress (exports), null otherwise. */
  progress: number | null
  /** The named steps, for a kind that runs in stages (a brand kit). */
  steps?: JobStep[]
  detail: D
}

/**
 * One background job's status, as `getStatus` and `waitForStatus` return it. `kind` says which resource `detail` is:
 * an output's is the generation itself, so a finished output is `state: 'completed'` only once it has settled.
 */
export type JobStatus =
  | JobStatusOf<'output', Generation>
  | JobStatusOf<'export', ExportJob>
  | JobStatusOf<'brand_kit', BrandKit>
  | JobStatusOf<'avatar', Avatar>
  | JobStatusOf<'content', ContentAnalysis>
  | JobStatusOf<'scenes', ContentScenes>
  | JobStatusOf<'transcript', TranscriptJobDetail>

/**
 * An id a status read could not answer for, in that id's place: it names nothing in the caller's account, names
 * something with no background job, is not an id, needs its kind, needs a scope the key lacks, or its read failed on
 * the server. A read of several ids answers each one, so one such id never hides the others. `reason` is the server's
 * own words; `httpStatus` is the status it answered with (404 when the id names no job of the caller's).
 */
export interface JobStatusUnanswered {
  kind: null
  /** The id exactly as it was asked for. */
  id: string
  state: 'unanswered'
  reason: string
  httpStatus: number
  appUrl: null
  progress: null
  detail: null
}

/** One id's answer in a read of several: its job's status, or why there is none. */
export type JobStatusResult = JobStatus | JobStatusUnanswered

/** A job to wait on: its id, or its id with the kind when the id alone does not name it. */
export type JobTarget = string | { id: string; kind?: JobKind }

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
  /** Its stored record's short id and app link. Absent when no record was kept (the account's own key paid). */
  shortId?: string
  appUrl?: string
  transcript: string
  language: string
  wordCount: number
  /** Source audio length in seconds, when known. */
  durationSeconds: number | null
  /**
   * What the run cost. `free` only when the user's own ElevenLabs key covered it, in which case the provider
   * billed them directly.
   */
  charge?: Charge
}

/** An avatar as returned by `listAvatars` (the list projection). */
export interface AvatarSummary {
  id: string
  /** The item's 8-character public id, used in app links and shown to people; `id` stays the UUID. */
  shortId: string
  /** This item in the app: open it in the browser. Built from the id alone: the API path on the app host. */
  appUrl: string
  name: string
  /** The avatar's base image (profile photo); the default look for lip-sync. */
  imageUrl: string | null
  defaultVoiceId: string | null
  isDefault: boolean
  status: string
}

/** Result of `listAvatars`: a page of the account's avatars. */
export interface AvatarListResult extends Paged {
  avatars: AvatarSummary[]
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
  /** What it cost: the first look, held now and charged when it finishes. */
  charge?: Charge
}

/** Fields `updateAvatar` can change, and where it moves among the caller's avatars. Omitted fields are left alone. */
export interface UpdateAvatarRequest extends Placement {
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
  /** This item in the app: open it in the browser. Built from the id alone: the API path on the app host. */
  appUrl: string
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
export interface ListVoicesOptions extends PageOptions {
  /** When true, return only favorited voices. */
  favorited?: boolean
}

/** Result of `listVoices`: a page of the account's saved voices. */
export interface VoiceListResult extends Paged {
  voices: VoiceSummary[]
}

/** A brand kit as returned by `listBrandKits` (the list projection). */
export interface BrandKitSummary {
  id: string
  /** The item's 8-character public id, used in app links and shown to people; `id` stays the UUID. */
  shortId: string
  /** This item in the app: open it in the browser. Built from the id alone: the API path on the app host. */
  appUrl: string
  name: string
  isDefault: boolean
  isActive: boolean
  isFavorited: boolean
  isArchived: boolean
  createdAt: string | null
}

/** Options for `listBrandKits`. */
export interface ListBrandKitsOptions extends PageOptions {
  /** When true, return only favorited brand kits. */
  favorited?: boolean
  /** When true, return only archived brand kits (default excludes archived). */
  archived?: boolean
}

/** Result of `listBrandKits`: a page of the account's brand kits, default first. */
export interface BrandKitListResult extends Paged {
  brandKits: BrandKitSummary[]
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

/**
 * One section of a brand kit: a free-form Markdown document (brand-kit-foundation-v1, Revision 7). Every kit starts
 * with eight: about, audience, offer and content_strategy (tab `overview`), voice_and_tone, writing_style and
 * speaking_style (tab `voice`), and design_guidelines (tab `visual`). The user may rename them and add their own.
 */
export interface BrandKitSection {
  id: string
  /** Stable and never renamed: address a section by key. A starter section's key is its role; an added one is `custom_<id>`. */
  key: string
  /** What a starter section MEANS, the same in every kit whatever the user renamed it to; null for one the user added. */
  role: string | null
  /** 'overview', 'voice' or 'visual'. */
  tab: string
  /** The display name. The user's to rename. */
  sectionName: string
  /** 'full' or 'half': how wide the section's card is on the brand page. */
  width: string
  /** Increments on every body change. Send it back as `expectedVersion` to write safely. */
  version: number
  /** The section's content, in Markdown. */
  body: string
  updatedAt: string | null
  /** Earlier versions, newest first. Present only on a filtered read that asked for `history`. */
  revisions?: BrandKitSectionRevision[]
}

/** One entry of a section's history. */
export interface BrandKitSectionRevision {
  version: number
  body: string
  /** Who wrote it: 'user', 'agent', 'api', 'extraction' or 'migration'. */
  bodySource: string
  createdAt: string
}

/** A section in the summary: everything but the body, plus its length and its own headings. */
export interface BrandKitSummarySection extends Omit<BrandKitSection, 'body' | 'revisions'> {
  charCount: number
  /** The section's own `##` headings, in order: what it covers, without loading it. */
  outline: string[]
}

/** Every section of a kit without bodies. The cheap first read: decide what to load, then load just that. */
export interface BrandKitSummaryRead {
  id: string
  name: string
  sections: BrandKitSummarySection[]
}

/** What a filtered `getBrandKit` returns: the kit's id and name, and just the sections asked for, with bodies. */
export interface BrandKitSectionsRead {
  id: string
  name: string
  sections: BrandKitSection[]
}

/** Scopes a section read. Each is a list; the filters combine with AND. */
export interface BrandKitSectionFilter {
  /** Section keys. */
  keys?: string[]
  /** Starter roles, e.g. 'voice_and_tone'. */
  roles?: string[]
  /** 'overview', 'voice' or 'visual'. */
  tabs?: string[]
}

/**
 * One section write in `updateBrandKit({ sections })`. Name only the sections you are changing.
 *
 * With a `key`, it edits that section: a new `body`, `revertTo` an earlier version (which lands as a NEW version),
 * a new `sectionName`, or a new `width`. Without a key, it ADDS a section of your own, and `sectionName` and `tab`
 * are required. To remove a section, archive it (`archive` with assetType `brand_kit_section`).
 *
 * A placement (`afterId`, `beforeId`, `position`) moves the section within its tab; its neighbors are section ids.
 */
export interface BrandKitSectionWrite extends Placement {
  key?: string
  sectionName?: string
  tab?: string
  /** Markdown. Replaces the section's whole body. */
  body?: string
  width?: 'full' | 'half'
  /**
   * The `version` you read. If the section changed since, the WHOLE write is refused with a `ConflictError` whose
   * `conflicts` lists each stale section's current `{ key, version, body }`, and nothing is written.
   */
  expectedVersion?: number
  /** Restore this earlier version's body, as a new version. Not combined with `body`. */
  revertTo?: number
}

/** A knowledge-base item (body truncated to a preview), as embedded in `getBrandKit`. */
export interface BrandKitKnowledge {
  id: string
  /** The item's 8-character public id, used in app links and shown to people; `id` stays the UUID. */
  shortId: string
  /** This knowledge item in the app. */
  appUrl: string
  title: string | null
  sourceType: string | null
  sourceUrl: string | null
  contentPreview: string | null
}

/** A knowledge-base item in the dedicated list/get surface (metadata). */
export interface BrandKnowledgeItem {
  id: string
  /** The item's 8-character public id, used in app links and shown to people; `id` stays the UUID. */
  shortId: string
  /** This item in the app: open it in the browser. Built from the id alone: the API path on the app host. */
  appUrl: string
  title: string | null
  sourceType: string | null
  sourceUrl: string | null
  createdAt: string | null
  updatedAt: string | null
}

/** Result of `addBrandKnowledge`: the item, and what adding it cost (images, audio and video are metered). */
export interface AddBrandKnowledgeResult {
  item: BrandKnowledgeItem
  charge?: Charge
}

/** A knowledge item with its stored body (a capped anchor; use search for depth). */
export interface BrandKnowledgeDetail extends BrandKnowledgeItem {
  content: string | null
}

/** Result of `listBrandKnowledge`: a page of items, how many there are in all, and the next page's cursor. */
export interface BrandKnowledgeListResult extends Paged {
  items: BrandKnowledgeItem[]
  total: number
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
  /** The brand's websites, in order. The first is the primary site, where logos, colors and fonts come from. */
  websiteUrls: string[]
  /**
   * Where VISUAL extraction (logos, colors, fonts, from the first website) has got to: 'idle', 'extracting',
   * 'reviewing', 'complete', 'failed'. Poll it after `createBrandKit({ extract: true })` or `extractBrandKit`.
   */
  extractionStatus?: string | null
  /**
   * Where the ANALYSIS has got to: the job that reads every website and the kit's own YouTube and Instagram posts
   * and writes its empty sections. 'queued' includes waiting for new accounts' posts and transcripts; null means
   * the kit has never been analyzed. Poll it alongside `extractionStatus`.
   */
  analysisStatus?: 'queued' | 'running' | 'done' | 'failed' | null
  /** The user-facing reason the last extraction failed, when it did. */
  extractionError?: string | null
  sourceType: string | null
  /** The kit's logos, in the kit's order. */
  logos: BrandKitLogo[]
  brandColors: BrandColor[]
  /** The kit's fonts; null when none is set. */
  typography: BrandTypography | null
  socialAccounts: BrandKitSocialAccount[]
  /** The kit's other brand media, in the kit's order. */
  assets: BrandKitAsset[]
  sections: BrandKitSection[]
  brandAccounts: BrandKitAccount[]
  inspirationAccounts: BrandKitAccount[]
  knowledge: BrandKitKnowledge[]
}

/** How a logo is laid out, and the colors it is drawn in. */
export type LogoLayout = 'horizontal' | 'stacked' | 'icon' | 'wordmark'
export type LogoColorMode = 'full_color' | 'light' | 'dark' | 'grayscale'

/** A kit's logo, as a full read carries it. Its place among the others is the list's order. */
export interface BrandKitLogo {
  id?: string
  url: string
  name?: string
  /** The kit's cover: exactly one logo is primary. */
  isPrimary: boolean
  /** The logo chosen for compact places (the kit's header, tiles); at most one per kit. */
  isDisplay?: boolean
  /** @deprecated Use `layout` and `colorMode`. */
  type?: 'full' | 'icon' | 'wordmark'
  layout?: LogoLayout
  colorMode?: LogoColorMode
  width?: number
  height?: number
  aspectRatio?: string
  isFavorited?: boolean
  /** Where the artwork sits inside the file, in file pixels, when the file has empty margins. Read only. */
  contentBox?: { x: number; y: number; width: number; height: number; fileWidth: number; fileHeight: number }
}

/** A kit's other brand media, as a full read carries it. */
export interface BrandKitAsset {
  id?: string
  /** The stored file's short id; absent for an asset with no stored file (an outside url). */
  shortId?: string
  url: string
  name?: string
  type?: string
  width?: number
  height?: number
  aspectRatio?: string
  /** A video's poster frame. */
  thumbnailUrl?: string
  isFavorited?: boolean
}

/** A social account the kit names. */
export interface BrandKitSocialAccount {
  platform: string
  handle?: string
  url?: string
  accountId?: string
  accountName?: string
  /** The account's current picture. */
  avatarUrl?: string
  followerCount?: number
}

/**
 * A logo as written: its media by `url`, or by `outputId` to bring in something not in the kit yet (the server copies
 * its bytes into the kit's storage). One of the two is required.
 */
export interface BrandKitLogoInput {
  url?: string
  outputId?: string
  name?: string
  isPrimary?: boolean
  isDisplay?: boolean
  layout?: LogoLayout
  colorMode?: LogoColorMode
  width?: number
  height?: number
  aspectRatio?: string
}

/** An asset as written, by `url` or `outputId` as a logo is. */
export interface BrandKitAssetInput {
  url?: string
  outputId?: string
  name?: string
  type?: string
  width?: number
  height?: number
  aspectRatio?: string
}

/** The roles a palette names. A color without one is an extra swatch. */
export type BrandColorRole = 'primary' | 'secondary' | 'tertiary' | 'accent'

/** One palette color. `hex` is six-digit `#RRGGBB`; the server stores it uppercase. */
export interface BrandColor {
  hex: string
  name?: string
  role?: BrandColorRole
}

/** A kit's fonts, by family name. A font that is not set is absent. */
export interface BrandTypography {
  titleFont?: string
  bodyFont?: string
}

/** Identity fields writable via `updateBrandKit` (allow-listed server-side). */
export interface UpdateBrandKitInput {
  name?: string
  /** The brand's websites, primary first. REPLACES the list; `[]` clears it. Stored only: pass `extract` to import. */
  websiteUrls?: string[]
  /** The palette. REPLACES the list: send every color, `[]` to clear. Each role is held by at most one color. */
  brandColors?: BrandColor[]
  /**
   * The fonts. MERGES: a font left out keeps its value, `null` or `''` clears that font, and `typography: null`
   * clears both, so setting the title font alone keeps the body font.
   */
  typography?: { titleFont?: string | null; bodyFont?: string | null } | null
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
   * Logos also carry `name`, `isPrimary`, `isDisplay`, `layout` and `colorMode`. Exactly one logo ends up primary: it
   * is the kit's cover, so if a list names none, the first wins. The list's order is the kit's order.
   */
  logos?: BrandKitLogoInput[]
  assets?: BrandKitAssetInput[]
  /**
   * Section content: the sections you name, and only those. ALL OR NOTHING and written before anything else in the
   * patch, so a stale `expectedVersion` refuses the whole patch. Read the keys and versions with
   * `getBrandKit(id, { detail: 'summary' })` or a filtered read.
   */
  sections?: BrandKitSectionWrite[]
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
  /**
   * Re-run the import after applying this patch: visuals from the first website, and the analysis of every website
   * and the kit's own accounts, which writes only into sections still empty.
   */
  extract?: boolean
}

/** Fields accepted when creating a brand kit. */
export interface CreateBrandKitInput extends UpdateBrandKitInput {
  /** Optional when a website or a social profile is given: it then defaults to the first site's hostname or the @handle. */
  name?: string
  /** Caller-minted id, so a create can be made idempotent. Must be a UUID. */
  id?: string
  /** Free-text provenance ('manual', 'wizard', 'mcp', ...). Defaults to 'manual'. */
  sourceType?: string
  /**
   * Import the kit right away from its websites and its own YouTube and Instagram accounts. Returns at once; poll
   * `extractionStatus` and `analysisStatus`.
   */
  extract?: boolean
}

/** What happened to one queued job. `deduped` means an identical job was already running, not a failure. */
export type JobEnqueueOutcome =
  | { status: 'enqueued'; msgId: number }
  | { status: 'deduped' }
  | { status: 'unconfigured' }

/**
 * What an import started. `extract` is null when the kit has no website; `synthesis` is null when it has nothing to
 * analyze (no website, no own YouTube or Instagram account). `error` is set when the kit was created but its import
 * could not be queued; retry with `extractBrandKit`.
 */
export interface BrandImportOutcome {
  extract: JobEnqueueOutcome | null
  synthesis: JobEnqueueOutcome | null
  error?: string
}

/** An account to link: an existing tracked-account id, or a profile to ADD by handle or url. */
export type BrandKitAccountInput = string | { platform?: string; handleOrUrl: string }

/** A media item's type. A transcript is not a library file, so a listing refuses it (read it with `getTranscript`). */
export type MediaType = 'image' | 'video' | 'audio' | 'doc' | 'other' | 'transcript'

/** The types a media listing filters by. */
export const MEDIA_LIST_TYPES = ['image', 'video', 'audio', 'doc', 'other'] as const
export type MediaListType = (typeof MEDIA_LIST_TYPES)[number]

/**
 * The parts a media listing reads the library's files in: every file (`all`, the default), or one partition of them:
 * `creations` (studio generations), `uploads` (files the user uploaded), `exports` (renders of their projects). Each
 * listed item names the partition it is in, in its `source`.
 */
export const MEDIA_LIST_SOURCES = ['all', 'creations', 'uploads', 'exports'] as const
export type MediaListSource = (typeof MEDIA_LIST_SOURCES)[number]

/**
 * Where a media item lives: a listing's partitions, and for a single read `stock` (stock media the user has used)
 * and `files` (any stored file the library shows). A get without a source finds the item in whichever library holds
 * it.
 */
export type MediaSource = MediaListSource | 'stock' | 'files'

/** One variation (output) of a studio generation. */
export interface MediaVariation {
  /** This output's media reference (`a1B2c3D4-2`): pass it anywhere one output is wanted. */
  mediaId: string
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
 * not a whole generation: a studio generation with N variations lists as N items sharing one `id`, each with
 * its own `mediaId`.
 */
export interface MediaSummary {
  id: string
  /** The item's 8-character public id, used in app links and shown to people; `id` stays the UUID. */
  shortId: string
  /** This item in the app: open it in the browser. Built from the id alone: the API path on the app host. */
  appUrl: string
  type: MediaType
  model: string | null
  prompt: string | null
  status: string
  createdAt: string | null
  /**
   * THE reference to this item, and the one to pass back anywhere: the short id, plus `-<n>` for output n of a
   * generation with several (`a1B2c3D4-2`). Nothing takes or prints a 0-based slot.
   */
  mediaId: string
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
  /** Which part of the library this item is in; self-describing. */
  source: MediaSource
  /** The file's name, which a download saves under: one a person gave, or one made for a creation. */
  fileName: string | null
  /** The file's size in bytes, as the library shows it and the storage meter counts it; listings only. */
  sizeBytes?: number
  /** Duration in seconds for a single-file item (uploads video/audio); null otherwise. */
  durationSeconds: number | null
  /**
   * The asset this item's file belongs to: the same id `getProject` reports as a clip's `sourceId`, so a clip can be
   * matched to the library item it was cut from, and `getMedia` / `getMediaBatch` accept it as a `mediaId`. Null when
   * the file is not one of our registered objects; absent from a server that predates it.
   */
  assetId?: string | null
  /**
   * The smallest copy the library keeps of this image, for drawing it small; null when it keeps none. Present only
   * when the listing was asked for small copies (`smallCopies`). Never a substitute for `url` when the file itself is
   * wanted: to download, deliver or show it large.
   */
  smallUrl?: string | null
}

/**
 * One input a generation was made FROM: what Studio lists under "References" for it, read by the same rule. Pass
 * `url` back as a reference to make another like it.
 */
export interface GenerationReference {
  /** What the input was to the generation, in the app's words: "Reference 1", "Start frame", "Audio", an element's name. */
  label: string
  type: 'image' | 'video' | 'audio'
  /** Its role (`reference`, `subject`, `first_frame`, `last_frame`, `motion`, `audio`, ...); null on an older row. */
  role: string | null
  /** The file, as a url you can fetch. */
  url: string
}

/** Full studio output detail as returned by `getMedia`. */
export interface MediaItem extends MediaSummary {
  script: string | null
  aspectRatio: string | null
  resolution: string | null
  duration: number | null
  /** What it cost, for a studio output; null for anything that was not charged as a generation (an upload). */
  charge: Charge | null
  /** The generation's outputs, or only the one a `-<n>` reference named; each carries its own `mediaId`. */
  variations: MediaVariation[]
  /** Output-level representative still (video poster / optimized image preview), or null. */
  thumbnailUrl: string | null
  /** What it was made FROM (its input references). Present on a creation; absent on an upload, stock, or an older server. */
  references?: GenerationReference[]
}

/**
 * ZOOM: a rectangle in an image's own pixels to cut from the original and return at the detail it has, never
 * enlarged. Clamped to the file, so "the right half" needs no exact size. A clip's frames, and a region of them, are
 * seen with `view`.
 */
export interface MediaRegion {
  x: number
  y: number
  width: number
  height: number
}

/** One requested item for `getMediaBatch`: a raw URL, or a media reference; either a region. */
export type MediaBatchItem = ({ url: string } | { mediaId: string }) & { region?: MediaRegion }

/**
 * One resolved item from `getMediaBatch`, uniform across the url and mediaId
 * paths. `url` is the single thing to fetch (the MCP turns it into an image
 * block); `ok` is false with an `error` when the item could not be resolved.
 */
export interface ResolvedMediaBatchItem {
  ok: boolean
  /** Where this item opens in the app. Absent for a url that is not one of the account's media items. */
  appUrl?: string
  /** The item's 8-character public id. Absent for a url that is not one of the account's media items. */
  shortId?: string
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
  /**
   * The same picture as `imageUrl` as its small pre-generated `preview.webp` derivative, when one exists.
   *
   * ⭐⭐⭐ **FETCH THIS BEFORE `imageUrl`, AND NEVER COMPUTE IT.** A master is routinely two to three
   * megabytes, which no inline-image budget can admit against a 1 MB host result ceiling, so reading the
   * master is how an agent ends up with no vision at all. Deriving the path yourself does not work either:
   * these are capability URLs whose token names ONE object, so a rewritten path is refused with 403. The
   * server mints this against a derivative it has confirmed exists.
   *
   * Null when no derivative has been written, in which case `imageUrl` is the only answer.
   */
  previewUrl: string | null
  /**
   * The same picture at 512px, for a caller inlining bytes under a token ceiling.
   *
   * ⭐ PREFER THIS OVER `previewUrl` WHEN YOU ARE ATTACHING BYTES. A 1600px preview encodes to roughly
   * 500 KB against a ~900 KB allowance for an entire tool result, so exactly one fits and everything
   * after it is dropped. Measured on a real four-variation generation: the model saw one of four pictures
   * the person could see.
   *
   * ⚠️ Null for anything generated before the vision pipeline shipped. Fall back to `previewUrl`.
   */
  visionUrl: string | null
  /**
   * Which library this item came from: `creations`, `uploads` or `stock`. Null when nothing maps.
   *
   * ⭐ Resolved from the storage spine, so a raw `{ url }` item carries it too. A consumer needs it to decide
   * whether "generate this again" is a sensible offer: only a creation was ever generated.
   */
  source: 'creations' | 'uploads' | 'stock' | null
  /**
   * The model's DISPLAY NAME and brand marks, resolved from the registry.
   *
   * ⛔ `model` below is a RAW ID. Never render it as a label: `gpt-image-2.5-flare` reads enough like one
   * that substituting it turns a lookup failure into a cosmetic bug nobody can diagnose, which is exactly
   * how the generation chip came to flicker between kebab case and title case.
   *
   * ⭐ Null means RENDER NO CHIP. An upload, a browser-side operation with no registry row, and any
   * sentinel the resolver has not been taught all land here; a missing chip is visibly missing where a
   * wrong one is not.
   */
  modelName: string | null
  modelBrandColor: string | null
  modelIconKey: string | null
  type: MediaType | null
  model: string | null
  prompt: string | null
  /**
   * The reference of exactly what this item shows: the output's full `<id>-<n>` when its generation has several,
   * so sending it back names the same output. A bare id for a generation resolves to its primary output, named
   * here in full. Null for a url that is not one of the account's items.
   */
  mediaId: string | null
  /** The references of the generation's other outputs, when a bare id resolved to its primary. */
  otherMediaIds: string[]
  /** What the generation was made FROM (its input references), when the item is a creation. */
  references?: GenerationReference[]
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
  /**
   * The asked-for `region`, cut from the original image: `dataUrl` is the crop (`data:image/webp;base64`).
   * `pixelsPerSourcePixel` is 1 at full detail, less when the region was too large to return whole: a source point x
   * lies at (x - region.x) * it.
   */
  crop?: { dataUrl?: string; width: number; height: number; region: MediaRegion; pixelsPerSourcePixel: number }
  /** Why the region could not be cut, when the item itself resolved. */
  cropError?: string
  error?: string
}

/** Result of `getMediaBatch`: one resolved entry per requested item, in order. */
export interface MediaBatchResult {
  items: ResolvedMediaBatchItem[]
}

/** Options for `listMedia`. */
export interface ListMediaOptions extends PageOptions, SortOptions<MediaSort> {
  /** Which part of the library to read; every file when omitted. */
  source?: MediaListSource
  /** One type, or several (sent comma-separated). */
  contentType?: MediaListType | MediaListType[]
  /** A listed file exists once its generation completed, so this takes only `completed`. */
  status?: 'completed'
  /** Creations only: the generation's class. */
  kind?: 'creation' | 'board' | 'look'
  /** When true, only favorited files that are not archived. */
  favorited?: boolean
  /** When true, only archived files. */
  archived?: boolean
  /** Give each image its `smallUrl`: the smallest copy the library keeps, for drawing it small. */
  smallCopies?: boolean
}

/** Result of `listMedia`: a page of the library's files, in the order asked for. */
export interface MediaListResult extends Paged {
  media: MediaSummary[]
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
  /** The asset's media reference: pass it to getMedia, favorite, a folder, anywhere one item is wanted. Null when it could not be named. */
  mediaId: string | null
  /** This asset in the app, when it could be named. */
  appUrl?: string
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
  /**
   * The smallest copy the library keeps of this image, for drawing it small; null when it keeps none. Present only
   * when the listing was asked for small copies (`smallCopies`). Never a substitute for `url` when the file itself is
   * wanted: to download, deliver or show it large.
   */
  smallUrl?: string | null
}

/** Options for searchMedia. */
export interface SearchMediaOptions extends PageOptions {
  /** Restrict results to these media kinds. Omit to search all kinds. */
  kinds?: MediaKind[]
  /** Give each image its `smallUrl`: the smallest copy the library keeps, for drawing it small. */
  smallCopies?: boolean
}

/** Result of `searchMedia`: a page of matches, most relevant first. */
export interface SearchMediaPage extends Paged {
  results: SearchMediaResult[]
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
  /** The item's 8-character public id, used in app links and shown to people; `id` stays the UUID. */
  shortId: string
  /** This item in the app: open it in the browser. Built from the id alone: the API path on the app host. */
  appUrl: string
  name: string
  type: FolderType
  query: SmartFolderQuery | null
  parentId: string | null
  icon: string | null
  color: string | null
  createdAt: string
  updatedAt: string
}

/** A built-in derived folder (recents, favorites, edits, canvas, posts). */
export interface DerivedFolder {
  key: string
  name: string
}

/**
 * Result of `listFolders`: a page of the account's own folders, and the built-in derived folders beside it (a fixed
 * set, the same on every page).
 */
export interface FolderListResult extends Paged {
  folders: Folder[]
  derived: DerivedFolder[]
}

/** One item inside a folder: media (variation-atomic) or an entity (project/post, manual folders only). */
export type FolderItem =
  | {
      type: 'media'
      kind: MediaKind | null
      mediaId: string | null
      appUrl?: string
      url: string | null
      /** The smallest copy kept of an image, when the folder was read with `smallCopies`; as on `MediaSummary`. */
      smallUrl?: string | null
      summary: string | null
      isFavorited: boolean
      relevance?: number
    }
  | { type: 'project' | 'card'; id: string; name: string; subtype: string | null }

/** Options for `getFolder`. */
export interface GetFolderOptions extends PageOptions {
  /** Give each image its `smallUrl`: the smallest copy the library keeps, for drawing it small. */
  smallCopies?: boolean
}

/** Result of `getFolder`: the folder (null for a derived key) and a page of its contents. */
export interface FolderContents extends Paged {
  folder: Folder | null
  items: FolderItem[]
}

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
  /**
   * File these items. A DELTA, not a list to replace: folder membership is many-to-many, so a declarative
   * list would silently unfile everything absent from it.
   */
  addItems?: FolderItemRef[]
  /** Unfile these items. Only the pointer goes; the asset is never touched. */
  removeItems?: FolderItemRef[]
  /** Move one item within this manual folder: after or before another of its items, or to an end. */
  moveItem?: FolderItemMove
  /** Apply this patch to several folders. Attribute fields (name, query, icon, color) need one. */
  folderIds?: string[]
}

/**
 * An item to file into (or out of) a manual folder, named the way it is named everywhere else: a media item by its
 * `mediaId` (`a1B2c3D4-2` for one output of several), a project or a card by its id.
 */
export type FolderItemRef = { mediaId: string } | { projectId: string } | { cardId: string }

/** A move within a manual folder: the item, and the items it lands after or before (each named as `addItems` names one), or an end. */
export interface FolderItemMove {
  item: FolderItemRef
  after?: FolderItemRef
  before?: FolderItemRef
  position?: PlacementEnd
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

/**
 * An import that has been accepted and is running. The server fetches the url in a background job, so the answer
 * arrives through the generation status: `importMedia` waits for it, `startImport` hands this back at once.
 */
export interface ImportStarted {
  outputId: string
  status: 'processing'
  shortId: string
  appUrl: string
}

/** Where an import's bytes already live, when the account already held them. */
export interface ImportDuplicate {
  /** The library item holding them, or null when they belong to something that is not one (an export, a look). */
  outputId: string | null
  shortId: string | null
  appUrl: string | null
  url: string
  objectName: string
  role: string | null
  ownedBy: string | null
}

/** A finalized upload/import: a first-class media output (referenceable by outputId). */
export interface UploadedMedia {
  outputId: string
  /** The upload's 8-character public id, used in app links and shown to people; `outputId` stays the UUID. */
  shortId: string
  url: string
  /** Where the upload opens in the app. */
  appUrl: string
  /**
   * What the bytes ARE: `'image' | 'video' | 'audio' | 'document'`.
   *
   * ⚠️ Without this a caller cannot tell an mp4 from a png, so anything wanting to SHOW what landed has to
   * guess from the url's extension, and that guess renders a video as a broken image. Absent from older
   * servers, which is why it is optional rather than required.
   */
  contentType?: string
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
  /** Where the item opens in the app; null exactly when `outputId` is. */
  appUrl: string | null
  /** The item's 8-character public id; null exactly when `outputId` is. */
  shortId: string | null
  /** True when nothing was created because the account already held these exact bytes. NOT an error. */
  alreadyExisted: boolean
  /** What the bytes already ARE, when `alreadyExisted`, so a caller can say which thing rather than "duplicate". */
  existing?: { objectName: string; role: string | null; ownedBy: string | null }
  /**
   * What the bytes ARE: `'image' | 'video' | 'audio' | 'document'`.
   *
   * ⚠️ ABSENT ON THE DUPLICATE PATH. Nothing was created, so the bytes may belong to something that is not
   * a library item at all, and asserting a type for a thing we did not make would be a guess. Also absent
   * from older servers.
   */
  contentType?: string
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
  /**
   * How to write this model's prompt text, in principles. For a speech model it is how to direct delivery
   * inside the script. Read it before writing text for the model; absent means the model has no guidance
   * beyond its request shape.
   */
  promptGuide?: string
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
  /**
   * Brand accent (hex) and the stable brand-family key that maps to an icon.
   *
   * ⭐ THEY TRAVEL WITH THE NAME because every consumer that renders one renders all three: a chip is a
   * glyph, an accent and a label. `displayName` was public and these were not, so a caller could name a
   * model and could not draw it.
   *
   * ⚠️ `iconKey` IS A BRAND FAMILY, NOT A MODEL ID. Four GPT Image models share `openai`. Null means
   * render no glyph rather than guess one.
   */
  brandColor: string | null
  iconKey: string | null
  description: string | null
  contentType: 'image' | 'video' | 'audio'
  kind: ModelKind
  tags: string[]
  /** True for the default model of its content type. */
  isDefault?: boolean
  capabilities: ModelCapabilities
  /** How to address references in the prompt (present on getModel; optional on list items). */
  promptReferences?: PromptReferences
  /** The board pipeline only (`getModel('reference-boards')`): every board type `generateBoard` takes. */
  boardTypes?: BoardTypeInfo[]
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
  /** The item's 8-character public id, used in app links and shown to people; `id` stays the UUID. */
  shortId: string
  /** This item in the app: open it in the browser. Built from the id alone: the API path on the app host. */
  appUrl: string
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
  cardCount?: number
}

/** Options for `listSpaces`. */
export interface ListSpacesOptions extends PageOptions, SortOptions<SpaceSort> {
  /** `true` lists ONLY archived spaces. Archived spaces are excluded by default, matching the grid. */
  archived?: boolean
  /** Only favorited spaces. */
  favorited?: boolean
  /** A space name search. */
  search?: string
}

/** Result of `listSpaces`: a page of the account's spaces, each with its live card count. */
export interface SpaceListResult extends Paged {
  spaces: Space[]
}

export interface Stage {
  id: string
  /** The item's 8-character public id, used in app links and shown to people; `id` stays the UUID. */
  shortId: string
  /** This item in the app: open it in the browser. Built from the id alone: the API path on the app host. */
  appUrl: string
  name: string
  slug: string | null
  color: string | null
}

/**
 * ⛔ `isDefault` WAS REMOVED FROM `Stage`, AND IT NEVER MEANT "THE DEFAULT STAGE".
 *
 * It meant "came from the seeded stage set", so it was true on 5 of 5 stages in one space, 6 of 6 in
 * another and 77 of 79 in a third, and a CLI column headed DEFAULT told users every column was the default
 * one. The underlying `stages.is_default` was nullable, defaulted to false and carried no unique
 * constraint, so nothing ever stopped them all being true.
 *
 * Nothing branched on it in either repository. The rule it appeared to describe, which stage a card lands
 * in when none is named, is answered by ORDER: the server returns the first stage in board order.
 */

/** A post as returned by `listCards` (the list projection). */
export interface CardSummary {
  id: string
  /** The item's 8-character public id, used in app links and shown to people; `id` stays the UUID. */
  shortId: string
  /** This item in the app: open it in the browser. Built from the id alone: the API path on the app host. */
  appUrl: string
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
  /**
   * An inspiration post's tracked-content id: what `getContent` takes, and the same `contentId` that attached it.
   * Null for every other kind.
   */
  contentId: string | null
  /** A linked project's id: what `getProject` takes, and the same `projectId` that attached it. Null otherwise. */
  projectId: string | null
  /**
   * @deprecated The id an attachment points at under one name for every kind (a content id, a project id, a media
   * object id). Read `contentId` or `projectId`, which match the field that attached it. Emitted for one window.
   */
  assetId: string | null
  assetUrl: string | null
  /**
   * Where the attached thing opens in the app: an inspiration post's page, a project's editor or canvas, a file's media
   * page. Link a reference by this. Null for an outside link, and on an older server.
   */
  appUrl?: string | null
  displayName: string | null
  /**
   * For an `inspiration` asset: every scalar triage fact the tracked post carries, so ten linked
   * outliers can be ranked without a `getContent` per link. Null for every other asset kind.
   */
  inspiration?: CardAssetInspiration | null
}

/** Scalar triage facts for an inspiration (tracked post) attached to a card. */
export interface CardAssetInspiration {
  platform: string | null
  contentType: string | null
  creator: string | null
  handle: string | null
  publishedAt: string | null
  durationSeconds: number | null
  viewCount: number | null
  likeCount: number | null
  commentCount: number | null
  /** Instagram-only in practice; null is honest absence, not zero. */
  shareCount: number | null
  playCount: number | null
  followerCount: number | null
  outlierScore: number | null
  engagementRate: number | null
  /** Whether `getContent` with a transcript grain will return anything. */
  hasTranscript: boolean
  /** Whether THIS account holds a Break It Down analysis for the post. Null when unknown. */
  hasBreakdown: boolean | null
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
  notes: string | null
  /**
   * The value to hand back as `expectedRevision` when writing `notes`.
   *
   * ⭐⭐⭐ **A CARD'S NOTES HAVE FOUR INDEPENDENT WRITERS** (the board's panel, this SDK, the CLI, and the
   * in-app agent), and each of them reads the document, edits it, and writes it back WHOLE. Whoever wrote
   * last used to win, silently, with a success response: measured 2026-09-19 with two writers holding one
   * read, and the first writer's paragraph was simply gone while both calls returned 200.
   *
   * Read this, compose the new notes from what you read, and send it back. The write lands only if the
   * card still carries it. If it does not, the server answers **409** with the current `notes` and
   * `revision` in the body, which is everything needed to merge and retry without a second fetch.
   *
   * ⛔ **NEVER INFER THE NEXT VALUE BY ADDING ONE.** The revision advances only when `notes` actually
   * changes, so a title edit or an identical save leaves it alone and a caller counting for itself would
   * be permanently one ahead.
   */
  revision: number
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
  /** The item's 8-character public id, used in app links and shown to people; `id` stays the UUID. */
  shortId: string
  /** This item in the app: open it in the browser. Built from the id alone: the API path on the app host. */
  appUrl: string
  name: string
  isDefault: boolean
  isSystem: boolean
}

/** Result of `listTags`: a page of the account's tags, by name. */
export interface TagListResult extends Paged {
  tags: Tag[]
}

/** The space a scoped read resolved to. */
export interface ResolvedSpace {
  id: string
  name: string
}

/** Result of `listCards`: a page of cards, how many there are in all, the next page's cursor, and the SCOPE it answers about. */
export interface CardListResult extends Paged {
  /** ⚠️ `cards`, NOT `posts`. This has always held CARDS. `Post` now means a publish DESTINATION,
   *  and the stale name is what let an app-side realtime binding subscribe to the wrong table. */
  cards: CardSummary[]
  total: number
  /**
   * ⭐⭐⭐ THE SPACE THIS LIST IS AN ANSWER ABOUT. This read is scoped to ONE space and falls back to the
   * account's default when none is named, so without this a list of the wrong board is indistinguishable
   * from a list of the right one. Measured 2026-09-14: a caller passing `space_id` where the parameter is
   * `spaceId` got a complete-looking list of a different board and concluded the filter was ignored.
   *
   * Null when every space was asked for (`spaceId: 'all'`).
   */
  space: ResolvedSpace | null
}

/**
 * Result of `listStages`: a space's stages in order, and the SCOPE they belong to.
 *
 * ⭐⭐⭐ THIS USED TO BE A BARE `Stage[]`. A bare array has nowhere to say which board it came from, and
 * this read falls back to the account's default space when none is named, so both surfaces rendered stages
 * with no indication of whose they were.
 *
 * ⚠️ THE NAME CANNOT BE DERIVED FROM THE ROWS. A `Stage` carries its `spaceId`, so a populated list could
 * have been labeled from its first row. An EMPTY list carries nothing, and the empty case is the one that
 * misleads, so the scope is returned alongside rather than inferred from them.
 */
export interface StageListResult extends Paged {
  stages: Stage[]
  space: ResolvedSpace
}

/** Options for `listCards`. */
export interface ListCardsOptions extends PageOptions, SortOptions<CardSort> {
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
  /** Only cards carrying this tag. */
  tag?: string
  search?: string
  /**
   * Which SPACE's board to list, or `'all'` for every space. Omitted means the account's DEFAULT space, not
   * every space.
   *
   * ⚠️ A LIST WITHOUT THIS IS SCOPED, NOT COMPLETE. Cards on any other board are absent with nothing in the
   * response saying so, and `search` misses them too. Get an id from `listSpaces()`.
   */
  spaceId?: string
}

/** Options for {@link ContentHeroClient.listStages}. */
export interface ListStagesOptions extends PageOptions {
  /**
   * Which SPACE's stages. Omitted means the account's default space. Stages are
   * per-space, so two spaces can each have a stage called "Published" with
   * different ids.
   */
  spaceId?: string
}

/**
 * Fields to create a post. `stage` accepts a stage id, slug, or name. A placement (`afterId`, `beforeId`, `position`)
 * puts it in its column.
 */
export interface CreateCardInput extends Placement {
  title: string
  platform: PostPlatform
  /**
   * Which board the card is created on. Omitted means the account's DEFAULT space.
   *
   * 🚨 **THIS WAS MISSING WHILE EVERY OTHER SPACE-AWARE CALL HAD IT**, so the one write that PLACES a
   * card was the one that could not choose where. `listCards`, `listStages`, `createStage` and
   * `updateCard` all take a space; a card created through the SDK, the MCP or the CLI silently landed
   * on the default board. `updateCard` could then MOVE it, which is what made the gap read as closed.
   *
   * ⚠️ The stage decides the space when `stage` is a stage ID, and the server rejects a `spaceId` that
   * disagrees with it rather than picking one.
   */
  spaceId?: string | null
  stage?: string | null
  /** A public URL for the post cover (the card thumbnail). */
  coverUrl?: string | null
  /** A media token (short id, output id or first 8 characters, optionally with "-N") for the cover; resolved to its URL. */
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
/**
 * One entry in a card's declarative `assets` list: `{ id }` keeps an existing asset at this position; anything else
 * ADDS one, naming EXACTLY ONE reference.
 */
export interface CardAssetInput {
  /** Keep an existing asset, at this position in the order. */
  id?: string
  /**
   * Add media in ContentHero by its output id: a generation, a file uploaded from a device (`uploadMedia`), or
   * one imported from a url (`importMedia`). "<id>-2" is variation 2 of a batch.
   */
  outputId?: string
  /** Add a link by its url. Nothing is copied; to keep a copy of a file on the web, import it and add its `outputId`. */
  assetUrl?: string
  /**
   * Add an inspiration post, shown on the card's Inspiration tab: a tracked post's content id, as `listContent` and
   * `getContent` use it, and as `getCard` returns an inspiration asset's `assetId`.
   */
  contentId?: string
  /** Add a link to an editor or canvas project: its project id. */
  projectId?: string
  /** Accepted and not needed: the kind is read from what the entry points at. Never `inspiration` or a project type: the server refuses it, naming `contentId` or `projectId`. */
  assetType?: string
  displayName?: string
  metadata?: Record<string, unknown> | null
}

/**
 * One in-place edit to a card's notes, for `UpdateCardInput.notesEdits`. `append` adds its text to the
 * end exactly as given (no separator is inserted); `find` must match exactly one place, and `replace`
 * swaps that occurrence (`""` deletes it).
 */
export type NotesEdit = { append: string } | { find: string; replace: string }

/**
 * A change to a card. A placement (`afterId`, `beforeId`, `position`) moves it within its column, or within the column
 * it is moving to when `stage` changes too.
 */
export interface UpdateCardInput extends Placement {
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
  /** A media token (short id, output id or first 8 characters, optionally with "-N") for the cover; resolved to its URL. */
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
  notes?: string | null
  /**
   * The `revision` you read from `getCard` before composing `notes`. **REQUIRED whenever `notes` is
   * present**, and the request is refused outright without it rather than defaulting to "whatever is
   * there now", because a caller that cannot name a revision has not read the document.
   *
   * On a mismatch the server answers **409** carrying the current `notes` and `revision`, so the retry
   * needs no extra fetch: merge your change onto what came back, then send it with the revision that
   * came back.
   *
   * Only `notes` is guarded. Every other field on this input is last-write-wins, which is correct for a
   * title or a status and wrong for a document people append to.
   *
   * Optional with `notesEdits`: given, the edits land only on that revision (a mismatch is the same 409);
   * absent, they apply to the notes as they are when the call arrives.
   */
  expectedRevision?: number
  /**
   * Change `notes` in place without resending them. Each edit is `{ append }`, which adds to the end, or
   * `{ find, replace }`, where `find` must match exactly one place in the current notes. Edits apply in
   * order, all or none, and the server refuses the whole call naming the failing edit when one cannot
   * apply. Cannot be combined with `notes`.
   */
  notesEdits?: NotesEdit[]
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
  /** The item's 8-character public id, used in app links and shown to people; `id` stays the UUID. */
  shortId: string
  /** This item in the app: open it in the browser. Built from the id alone: the API path on the app host. */
  appUrl: string
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

/** Result of `listTrackedAccounts`: a page of the accounts the caller tracks. */
export interface TrackedAccountListResult extends Paged {
  trackedAccounts: TrackedAccount[]
}

/** A piece of tracked content: the list projection. */
export interface ContentSummary {
  id: string
  /** The item's 8-character public id, used in app links and shown to people; `id` stays the UUID. */
  shortId: string
  /** This item in the app: open it in the browser. Built from the id alone: the API path on the app host. */
  appUrl: string
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
  /** Always present: availability at minimum, plus `data` when analysis content was requested. */
  analysis: ContentAnalysis
  /** Whether the post's scenes exist (`analyzeContent` kind `scenes`). Availability only. Absent on older servers. */
  scenes?: ContentScenes
}

/**
 * Whether a post's scenes (its scene map and a frame per scene) exist. `complete` when stored, `running` while
 * being prepared, `failed` when the last run gave up (`error` says why), `unavailable` when the post cannot have
 * them (`reason` says why: no video, or longer than the 4-hour limit), `absent` when none was asked for.
 */
export type ContentScenes =
  | { status: 'complete'; sceneCount: number; detail?: ContentScenesDetail }
  | { status: 'running' }
  | { status: 'failed'; error: string }
  | { status: 'unavailable'; reason: string }
  | { status: 'absent' }

/** A post's scenes, when `getContent` was asked for them with `scenes: 'map'` or `'frames'`. */
export interface ContentScenesDetail {
  /** What the whole post shows, in a sentence or two. */
  summary: string | null
  /** False when the post has no timed transcript, so every scene's `said` is null ("unknown", not "silent"). */
  timedTranscript: boolean
  /**
   * How finely `said` is placed: `word` places each word in the scene it was said in; `phrase` places each caption
   * phrase (a few seconds each) in the one scene holding its midpoint, so a scene shorter than a phrase can read as
   * having nothing said. Null without a timed transcript.
   */
  saidTiming: 'word' | 'phrase' | null
  /** True when `startMs`/`endMs` narrowed the list; `sceneCount` is always the whole post's. */
  windowed: boolean
  scenes: ContentScene[]
}

/** One scene: its range, what happens in it, what is said, and its frame when one is stored. */
export interface ContentScene {
  index: number
  startMs: number
  endMs: number
  description: string
  /** What is said in this scene, joined; null without a timed transcript (see `saidTiming`). */
  said: string | null
  frameUrl?: string
}

/** What `analyzeContent` makes: `breakdown` (the default), or `scenes`. */
export type ContentAnalysisKind = 'breakdown' | 'scenes'

/** Result of `analyzeContent` with `kind: 'scenes'`. The scenes themselves are read with `getContent`. */
export interface ContentScenesResult {
  contentId: string
  /**
   * The post's short id, which `getStatus` follows this job by (with its kind), and its page in the app. Absent from an
   * older server.
   */
  shortId?: string
  appUrl?: string
  kind: 'scenes'
  scenes: ContentScenes
  /** What it cost: held while the scenes are made, charged once when stored, free when they already existed. */
  charge?: Charge
}

/**
 * A post's Break It Down analysis (one per post, read by everyone). Availability is always reported; the
 * content is opt-in (a full analysis is ~60KB). `transcriptSegments` is excluded from `analysis: 'full'`
 * because the transcript has its own opt-in surface with windowing and search; name it explicitly to pull it.
 */
export interface ContentAnalysis {
  /**
   * `complete` when stored, `running` while one is being made, `failed` when the last run gave up (`error`
   * says why), `absent` when none was asked for. `analyzeContent` creates one.
   */
  status: 'complete' | 'running' | 'failed' | 'absent'
  /** Only when `failed`. */
  error?: string
  analyzedAt?: string
  model?: string | null
  /** The section names `analysisSections` accepts. Listed even when data was not requested. */
  sections?: string[]
  /** The requested sections, keyed by name. */
  data?: Record<string, unknown>
}

/** Result of `analyzeContent`: the post's analysis with every section, or `status: 'running'` while it is made. */
export interface ContentAnalysisResult {
  contentId: string
  /**
   * The post's short id, which `getStatus` follows this job by (with its kind), and its page in the app. Absent from an
   * older server.
   */
  shortId?: string
  appUrl?: string
  analysis: ContentAnalysis
  /** What it cost: held while it runs, charged once when stored, free when it already existed. */
  charge?: Charge
}

/** One tracked account with its performance. */
export interface TrackedAccountDetail {
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
export interface ListContentOptions extends PageOptions, SortOptions<ContentSort> {
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
  /**
   * Finds posts by meaning and keyword; results are only the posts judged relevant, ranked by relevance. Any other
   * `sort` reorders the same relevant set.
   */
  search?: string
  /** Tracked-account ids. Ids the caller does not own resolve to nothing rather than widening the query. */
  accountIds?: string[]
  /** Only the one-off posts the caller saved by url. */
  addedByYou?: boolean
  /** Scope to the accounts linked to this brand kit. */
  brandKitId?: string
  favorited?: boolean
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
  /** `none` (default) reports availability only; `full` returns every section except `transcriptSegments`. */
  analysis?: 'none' | 'full'
  /** Return only these analysis sections (see `ContentAnalysis.sections` for what exists). */
  analysisSections?: string[]
  /**
   * The post's scenes (made by `analyzeContent` kind `scenes`). `none` (default) reports availability; `map` adds
   * each scene's range, what happens, what is said and its frame's url; `frames` is the same data for a caller
   * that will show the frames. `startMs`/`endMs` narrow the scenes (and then do not imply transcript segments).
   */
  scenes?: 'none' | 'map' | 'frames'
}

/** Options for `listTrackedAccounts`. */
export interface ListTrackedAccountsOptions extends PageOptions {
  /** Narrow to one tier. Omitted, both come back. */
  accountType?: 'inspiration' | 'brand'
  /** Scope to the accounts linked to this brand kit. */
  brandKitId?: string
}

/** Result of `listContent`: a page of content, how many there are in all, and the next page's cursor. */
export interface ContentListResult extends Paged {
  content: ContentSummary[]
  total: number
  /**
   * Each `accountIds` entry that named none of your tracked accounts in this view, with the server's reason. The list
   * answers with what the others matched; absent when every id named an account (and from an older server).
   */
  accountIdsNotFound?: AccountIdNotFound[]
}

/** An `accountIds` filter entry that named no account. */
export interface AccountIdNotFound {
  id: string
  reason: string
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
  /** The item's 8-character public id, used in app links and shown to people; `id` stays the UUID. */
  shortId: string
  /** This item in the app: open it in the browser. Built from the id alone: the API path on the app host. */
  appUrl: string
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

/** Result of `listConnectedAccounts`: a page of the account's connected social accounts, default first. */
export interface ConnectedAccountListResult extends Paged {
  connectedAccounts: ConnectedAccount[]
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
 * A publish target in the catalog (an item of get_schema kind 'platform'): the platform, its
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
  | 'caption-template'
  | 'template'
  | 'space'

/** The asset types that can be archived. */
export type ArchiveAssetType = 'card' | 'brand_kit' | 'brand_kit_section' | 'project' | 'space' | 'template'

/**
 * The target of a favorite / unfavorite call: a media item by its `mediaId` (one output, `a1B2c3D4-2`, an upload,
 * stock), or any other item by its `assetType` and `id`. A bare id for a generation with several outputs is refused
 * with the outputs listed, because it names none of them.
 */
export type FavoriteInput = ({ mediaId: string } | { assetType: FavoriteAssetType; id: string }) & {
  /** Defaults to true. Pass false to clear the favorite. */
  favorited?: boolean
}

/** The kinds `share` names by `assetType` and `id`. Media is named by its media ids instead. */
export type ShareAssetType = 'project'

/** Make an item's public link, or revoke it (`share`), named by its `assetType` and `id`. Today a project's live link. */
export interface ShareItemInput {
  assetType: ShareAssetType
  /** The item's id. */
  id: string
  /** Defaults to true. Pass false to revoke the link; a revoked link stays dead. */
  shared?: boolean
}

/** A project's public live link as it now stands. */
export interface ProjectShare {
  shared: boolean
  /** The public address, which shows the project as it is now; null when it is not shared. */
  shareUrl: string | null
}

/** Share media made in Studio as one public link (`share`). */
export interface ShareMediaInput {
  /**
   * One or more outputs of the caller's finished generations, by the media ids every media read prints. One output
   * is its generation's link, opened at that output; several are a new link to them as a set. To stop sharing, one id
   * names its generation's link.
   */
  mediaIds?: string[]
  /** A title for a set of two or more. */
  title?: string
  /** Defaults to true. Pass false to stop sharing: one media id, or the link as `shareUrl`. A stopped link never opens again. */
  shared?: boolean
  /** With `shared: false`, the media link to stop: a generation's page or a set's. */
  shareUrl?: string
}

/** The target of a `share` call: media by its media ids (or a media link to stop), or any other item by `assetType` and `id`. */
export type ShareInput = ShareMediaInput | ShareItemInput

/** A public link to media made in Studio, or that it stopped. */
export interface MediaShare {
  shared: boolean
  /** The public page; null once it is no longer shared. */
  shareUrl: string | null
  /** The media the page shows, in order: every one named, less any that could not be shared. None once stopped. */
  mediaIds: string[]
}

/**
 * The target of an archive / unarchive call: a generated output by its `mediaId` (`a1B2c3D4-2`), or any other item
 * by its `assetType` and `id`.
 */
export type ArchiveInput = ({ mediaId: string } | { assetType: ArchiveAssetType; id: string }) & {
  /** Defaults to true. Pass false to restore. */
  archived?: boolean
}

// ---------------------------------------------------------------------------
// Editor / canvas ops (programmatic parity with the manual UI + in-app agent)
// ---------------------------------------------------------------------------

/** Which write model a project's composition uses: 2D canvas layers or a 1D editor timeline. */
export type EditorSurface = 'canvas' | 'editor'

/** One op in the shared editor/canvas op vocabulary. Opaque here: shaped by the reducer for the
 *  project's type (canvas layer/slide ops, or timeline clip ops). Every op has an `op` name. */
export interface EditorOp {
  op: string
  /**
   * Optional client-generated stable id (uuid) for this op. When omitted, `applyEditorOps` generates one
   * for you before sending. It is the op's identity across its whole lifecycle: the server persists it, the
   * unique-per-project constraint makes a retried op idempotent, and a live editor client uses it to ignore
   * the broadcast echo of its own edit.
   */
  opId?: string
  [key: string]: unknown
}

/** Input to `applyEditorOps`. */
export interface ApplyEditorOpsInput {
  /** The project to edit. Its `type` selects the op vocabulary (canvas layers vs timeline clips). */
  projectId: string
  /** The ops to apply, in order. */
  ops: EditorOp[]
  /** Optimistic-concurrency token from a prior read. When omitted, the server uses the current revision. */
  expectedRevision?: number
  /** A short human intent for the edit (attribution + observability). */
  userIntent?: string
  /*
    ⛔ `includeRenderUrl` WAS RETIRED ON 2026-10-04, with `renderUrl` on the result and on ProjectDetail.
    It made an edit (and a read) render and SAVE a cover, and the url it returned was the stored address, which an
    API key cannot download. See the result with `view({ projectId, render: true })`.
  */
}

/**
 * A finding from the compiler about one clip's or layer's code. The app compiles the code whenever an op writes it:
 * an error refuses the op, and a warning lets it apply while naming what may go wrong. Code an op only carries (an
 * undo puts it back) applies either way, with its findings, so an undo never fails over code the project already held.
 */
export interface CodeDiagnostic {
  /** The clip on a timeline, or the layer on a canvas, whose code it is. */
  itemId: string
  severity: 'error' | 'warning'
  /** The kind of finding, for a caller that branches on it. The app can add kinds; `message` always explains. */
  code: string
  /** The finding, written for the code's author. */
  message: string
  /** 1-based. Absent for a finding about the code as a whole. */
  line?: number
  /** 1-based. */
  column?: number
  /** The author's line as written, indentation kept so `column` points into it. */
  snippet?: string
}

/** The per-op outcome (type-agnostic; created ids normalized across project types). */
export interface EditorOpResult {
  op: string
  /** The op's stable id (the one you sent, or the one generated for you), echoed back for every op. */
  opId: string
  ok: boolean
  error?: string
  warnings?: string[]
  createdIds?: string[]
  /** For an async effect op (remove_background, separate_layers): the studio_outputs id of the dispatched job. Wait
   *  on it with `getStatus` and kind `'output'` (its record, and so its short id, is written when the job runs).
   *  Present only on a successfully-dispatched async op. */
  generatingOutputId?: string
  /** That job's result in the app, beside `generatingOutputId`. Absent from an older server. */
  generatingAppUrl?: string
  /** The compiler's findings for code this op wrote or carried. An error among them is why `ok` is
   *  false; warnings ride on an op that applied. */
  diagnostics?: CodeDiagnostic[]
}

/** Result of `applyEditorOps`: the new revision + per-op results. */
export interface ApplyEditorOpsResult {
  // No `surface`: it equaled the project's `kind` once the vocabularies converged, and returning the same
  // value under two names is what this change removed.
  revision: number
  results: EditorOpResult[]
}

/**
 * A project's type: an editor project (video timeline) or a canvas project (slides and layers).
 *
 * Named `type` since sdk 0.4.16 (2026-09-27). It was `kind`, then `surface`; neither read as what it is.
 * `ProjectKind` and `ProjectSurface` stay as aliases so no import breaks.
 */
export type ProjectType = 'editor' | 'canvas'
/** @deprecated Use `ProjectType`. */
export type ProjectKind = ProjectType
/** @deprecated Use `ProjectType`. */
export type ProjectSurface = ProjectType

/** Lightweight project list item (spans both types), from `listProjects`. */
export interface ProjectSummary {
  id: string
  /** The item's 8-character public id, used in app links and shown to people; `id` stays the UUID. */
  shortId: string
  /** This item in the app: open it in the browser. Built from the id alone: the API path on the app host. */
  appUrl: string
  /** 'editor' or 'canvas'. */
  type: string
  /** @deprecated Alias for `type`, still emitted for one release window. */
  surface: string
  /** @deprecated Alias for `type`, still emitted for one release window. */
  kind: string
  title: string
  orientation: string
  width: number
  height: number
  thumbnailUrl: string | null
  /** How the cover is chosen: 'auto' follows the composition, 'frame' is a chosen moment, 'upload' an image. */
  coverSource: 'auto' | 'frame' | 'upload'
  /** The chosen frame when `coverSource` is 'frame' (a canvas slide's index among its visible slides); else null. */
  coverFrame: number | null
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

export interface ProjectDetail extends ProjectSummary, ProjectSettings {
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
  /** The project's public live link, which shows the project as it is now; null when it is not shared (`share`). */
  shareUrl: string | null
  favoritedAt: string | null
  archivedAt: string | null
  /**
   * The scope the read applied, present only when `state` is PART of the document: a timeline's frame window and
   * track (`fromFrame`/`toFrame`/`trackId`, for the summary and `detail: 'full'` alike), or the one canvas slide it
   * found (`slideId`). Never write a scoped `state` back as if it were the whole composition.
   */
  scope?: ProjectReadScope
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


/** What a `getProject` read was narrowed to (see `ProjectDetail.scope`). */
export interface ProjectReadScope {
  fromFrame?: number
  toFrame?: number
  trackId?: string
  slideId?: string
}

/** One live participant in `view`: who is present and on what surface/scope. */
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

/**
 * The result of `view`: the most-recent-active session's live context, the full participant set, and whatever was
 * rendered.
 */
export interface ViewResult {
  /**
   * The most-recent-active session's context: a discriminated `{ surface, ...surfaceState }` object carrying
   * the focus (e.g. `focusedSlideId`, `playheadFrame`) and current selection. A short-lived `snapshotUrl` of
   * the live viewport is included ONLY when the read was made with `capture: true`. It may also carry:
   * - `rendered`: the picture or sound job answer, when the read rendered or read a render.
   * - `renderedSound`: when `video` was asked on a surface that cannot take video, the range's frames come back in
   *   `rendered` and its sound measurement here, a sound answer of the same shape as a sound `rendered`.
   * - `clip`: a raw source clip named by `assetId` or `mediaUrl`: `{ url, type: 'video' | 'image', fromSec?, toSec?,
   *   durationSeconds?, keyframes?: [{ atSec, dataUrl }], keyframeError?, crop?, cropError?, error?: { code, message } }`.
   * With no live tab it holds only what was rendered. Null when no session is live and nothing was rendered.
   */
  context: Record<string, unknown> | null
  /** Metadata for that default participant, or null when no one is live. */
  participant: LiveContextParticipant | null
  /** Every currently-live participant, most-recent first, for multi-human callers. */
  participants: LiveContextParticipant[]
}

/** Options for `view`. */
export interface ViewInput {
  /** Scope to a specific project's presence (editor/canvas). Omit for the caller's most-recent surface anywhere. */
  projectId?: string
  /**
   * Opt in to vision: also ping the live tab for a fresh viewport screenshot at read time, returned as a
   * short-lived `snapshotUrl`. Default false = structured-only (fast, never touches the live page). To see the
   * COMPOSED OUTPUT (not the user's screen) use `render` instead.
   */
  capture?: boolean
  /**
   * Opt in to a render of your work so you can verify it while iterating, without exporting. `true` renders the
   * current focus point as one image. For an editor timeline, name several frames as a list (`frames`), as a rate over
   * a range (`perSecond` with `fromFrame`/`toFrame`), or as a count spread over a range (`count`); you get exactly the
   * frames you name. Frames that fit one response come back one by one; more come back as contact sheets, each frame
   * numbered under its tile, split into pages. Set `sound` to render a range's mix and measure it instead. A render is a
   * job: the answer carries `rendered.renderId`, what finished within the wait, and which pages are ready; read the
   * rest with `renderId` and `page`. Ephemeral (counts against no quota) and does not need a live tab. To see a RAW
   * source clip rather than your edit, name it with `assetId` or `mediaUrl`.
   */
  render?: boolean
  /** Editor: which single timeline frame. Omit to render the current playhead frame. */
  frame?: number
  /** Canvas: which slide (id). Omit to render the focused slide. */
  slideId?: string
  /** Canvas: which slide (1-based index; alternative to `slideId`). */
  slideIndex?: number
  /** Start timeline frame of the range (edit space), for several frames, sound or video. Omit to start at the beginning. */
  fromFrame?: number
  /** End timeline frame of the range. Omit to run to the end. */
  toFrame?: number
  /**
   * How many frames to spread evenly across the range, or across a clip's window. Omit for one frame at the focus
   * point, or about one a second of a range.
   */
  count?: number
  /** Editor: exactly these timeline frames, in this order. */
  frames?: number[]
  /** How many frames to take per second of the range, up to every frame. */
  perSecond?: number
  /** `frames` returns each frame as its own image; `sheets` tiles them into contact sheets. Omit to choose by how many fit one response. */
  layout?: 'frames' | 'sheets'
  /**
   * Render the range's sound (`fromFrame` to `toFrame`, the whole timeline when neither is named) instead of its
   * picture, mixed as an export mixes it, and measure it: integrated loudness, true peak, loudness range, sample peak,
   * where sounds start, stereo width and band balance, with a waveform and spectrogram picture and a link to the audio
   * that expires with the render.
   */
  sound?: boolean
  /**
   * Watch the range (`fromFrame` to `toFrame`) play with its sound, to judge motion, timing, transitions and pacing,
   * or a clip's window. Where video cannot be received, the range's frames come back in `rendered` and its sound
   * measurement in `renderedSound`.
   */
  video?: boolean
  /** Read a render already started, by the `rendered.renderId` it returned. Pass only `page` (and `wait`) with it. */
  renderId?: string
  /** Which page of a render to read, starting at 1. */
  page?: number
  /** How long to wait for results before answering, in seconds. What is not ready by then is read later with `renderId`. */
  wait?: number
  /**
   * The width in pixels to render at, or of a clip's frames, to check legibility at the size it will be seen (a
   * thumbnail, a feed card). Height follows the aspect ratio. The size used is reported in `rendered`.
   */
  width?: number
  /**
   * Render only this rectangle, in composition units (`ProjectDetail.compositionSpace`), to inspect
   * detail at full resolution. Without `width`, it renders at native scale; `rendered` reports
   * `pixelsPerCompositionUnit`. For a source clip, the rectangle is in the clip's own pixels, and each of its frames
   * is cut to it.
   */
  region?: CompositionRegion
  /** A raw source clip to see, by its asset id, rather than your edit. Or pass `mediaUrl`. */
  assetId?: string
  /** A raw source clip to see, by its media URL, rather than your edit. Or pass `assetId`. */
  mediaUrl?: string
  /** Start of the clip's window, in its own seconds. Omit to start at its beginning. */
  fromSec?: number
  /** End of the clip's window, in its own seconds. Omit to run to its end. */
  toSec?: number
}

/** A rectangle in composition units: the space layer geometry is expressed in (`ProjectDetail.compositionSpace`). */
export interface CompositionRegion {
  x: number
  y: number
  width: number
  height: number
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

/**
 * ⛔ `LiveContextRender` WAS DELETED HERE ON 2026-09-21. DO NOT RE-ADD IT.
 *
 * It described the `rendered` key inside `ViewResult.context` (then named `LiveContextResult`), which is deliberately typed
 * `Record<string, unknown>` because the context is discriminated by surface. So the interface could
 * never be referenced by anything: git history confirms it was introduced in ONE commit (the
 * visual-preview surface) and `rendered?: LiveContextRender` never existed in any commit. It was
 * BORN ORPHANED, not replaced and not broken by a later edit.
 *
 * ⭐⭐⭐ AND BEING UNREFERENCED IS EXACTLY WHY IT WENT STALE. It still said the render tier was
 * `'still' | 'filmstrip'` two days after that pair was renamed to `'image' | 'video'` on the
 * REQUEST side of this same file (see `GetLiveContextOptions.render.mode`), because no compiler and
 * no test could disagree with it. **AN UNENFORCEABLE MIRROR OF A SERVER SHAPE IS NOT
 * DOCUMENTATION, IT IS A SECOND SOURCE OF TRUTH THAT NOTHING KEEPS HONEST.**
 *
 * The render payload's real shape is owned by the server (`lib/context/live-context-render.ts`),
 * and the MCP formatter reads it STRUCTURALLY (`dataUrl` for one frame, `frames[]` for several)
 * rather than by any declared tier field, so nothing needed this type to begin with. If `context`
 * is ever narrowed into a real discriminated union, type the render key THERE, as a member of that
 * union, where the compiler can hold it to the server.
 */

/** Filters for `listProjects`. */
export interface ListProjectsInput extends PageOptions, SortOptions<ProjectSort> {
  /** 'archived' -> only archived; 'favorited' -> favorited + not archived; omitted -> not archived. */
  filter?: 'archived' | 'favorited'
  /** Restrict to one type. Omitted returns both. */
  type?: ProjectType
  /** @deprecated Alias for `type`, accepted for one release window. `type` wins if both are set. */
  surface?: ProjectType
  /** @deprecated Alias for `type`, accepted for one release window. `type` wins if both are set. */
  kind?: ProjectType
  /** Case-insensitive title search. */
  search?: string
}

/** Result of `listProjects`: a page of project summaries. */
export interface ProjectListResult extends Paged {
  projects: ProjectSummary[]
}

/** Input to `createProject`. All optional; the server applies the same defaults as the in-app new-project
 *  flow (16:9 landscape, an `editor` project, an empty composition the app lazy-inits). */
export interface CreateProjectInput {
  type?: ProjectType
  /** @deprecated Alias for `type`, accepted for one release window. */
  surface?: ProjectType
  /** @deprecated Alias for `type`, accepted for one release window. */
  kind?: ProjectType
  title?: string
  orientation?: string
  width?: number
  height?: number
  /** Frames per second for an editor project: 24, 25, 30, 50 or 60. Defaults to 30. */
  fps?: 24 | 25 | 30 | 50 | 60
  brandKitId?: string
  /**
   * The card this project is for: the new project is linked to it in the same call, so the card opens the edit from
   * the moment it exists. Also needs the `planner:write` scope; a card that is not the caller's fails the call before
   * any project is made.
   */
  cardId?: string
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
  /** The card this project is for: linked to it in the same call (needs `planner:write` too). */
  cardId?: string
}

/**
 * How a project's cover is chosen: `'auto'` follows the composition, `{ frame }` is a chosen moment (a canvas
 * slide's index among its visible slides), `{ mediaId }` an image from the library.
 */
export type ProjectCoverChoice = 'auto' | { frame: number } | { mediaId: string }

/**
 * A change to a project's own fields, for `updateProject`. A PATCH: a field left out is left alone. `brandKitId` and
 * `coverPosition` take `null` to clear them.
 */
export interface UpdateProjectInput {
  title?: string
  orientation?: string
  width?: number
  height?: number
  /** The caller's own brand kit to associate, or null for none. */
  brandKitId?: string | null
  /** Where the cover is framed, as percentages of its width and height, or null for the default framing. */
  coverPosition?: { x: number; y: number } | null
  cover?: ProjectCoverChoice
  /** Video projects: the frame rate. Every frame number in the timeline converts with it, so clips keep their timing. */
  fps?: 24 | 25 | 30 | 50 | 60
  /** Video projects: the delivery loudness. */
  loudness?: Loudness
  /** Video projects: the magnetic main track. Turning it on closes the main track's gaps in the same edit. */
  magneticTrack?: boolean
  /** Video projects: whether other tracks follow the main track's ripple and delete. */
  linkage?: boolean
  /** Video projects: which kinds of track linkage reaches; a kind left out is left alone. */
  linkedTracks?: Partial<LinkedTracks>
}

/**
 * A video project's settings besides its canvas size (which is `width`, `height` and `orientation`), as `getProject`
 * reads them and `updateProject` returns them. They belong to the project, not the caller: every collaborator and every
 * export follows them, they travel with versions and duplicates, and changing one is an edit that undo reverses.
 * Absent on a canvas project.
 */
export interface ProjectSettings {
  /** The frame rate. Every frame number in the timeline counts at it. */
  fps?: number
  /** The delivery loudness, heard in the editor and followed by its exports. */
  loudness?: Loudness
  /** The magnetic main track: moving, trimming or deleting a clip on the main track closes the gap it leaves. */
  magneticTrack?: boolean
  /** Whether other tracks follow the main track's ripple and delete. */
  linkage?: boolean
  /** Which kinds of track linkage reaches. */
  linkedTracks?: LinkedTracks
}

/** A project as `updateProject` returns it: its summary and its settings, as they now stand. */
export type ProjectWithSettings = ProjectSummary & ProjectSettings

/** Which kinds of track a linked edit reaches. */
export interface LinkedTracks {
  media: boolean
  audio: boolean
  text: boolean
}

/**
 * A delivery loudness: a target integrated loudness in LUFS, or 'off' to keep the mix as it was mixed. The server
 * refuses a number outside the range it accepts, and its refusal states that range.
 */
export type Loudness = number | 'off'


/** A saved version of a project, as the version history lists it and a save returns it. */
export interface ProjectVersion {
  id: string
  /** The document shape the version holds. */
  kind: 'tracks' | 'slides'
  createdBy: string | null
  /** The display name of whoever saved it. */
  authorName: string | null
  label: string | null
  /** What saved it (`manual` for a save someone asked for). */
  triggerReason: string
  sizeBytes: number | null
  /** The project revision the version was taken at. */
  revision: number | null
  createdAt: string
}

/** Result of `listProjectVersions`: a page of a project's saved versions, newest first. */
export interface ProjectVersionListResult extends Paged {
  versions: ProjectVersion[]
}

/** One export of a project, as `listExports` gives it. */
export interface ProjectExport {
  exportId: string
  /** The export's 8-character public id; `exportId` stays the UUID. */
  shortId: string
  /** This export in the app (it opens its project). */
  appUrl: string
  /** 'completed', or a status the server is still working through ('pending' | 'rendering' | 'transferring'). */
  status: string
  exportType: string | null
  title: string | null
  /** The delivered file; null until the export completes. */
  outputUrl: string | null
  /** The export's poster; for a running export, its project's current cover. */
  thumbnailUrl: string | null
  fileSizeBytes: number | null
  durationSeconds: number | null
  /** Where it is delivered, as it was asked for. */
  destination: string | null
  shareId: string | null
  /** Its public share page, once it has completed. */
  shareUrl: string | null
  createdAt: string
  /** How its loudness came out. Absent or null until it finishes, and for an export with no mix (a still, a package, a subtitle file). */
  loudness?: ExportLoudness | null
}

/** A page of a project's exports, newest first. */
export interface ExportListResult extends Paged {
  exports: ProjectExport[]
}

/** The version `createProjectVersion` stored, in the shape a list gives it. */
export type CreatedProjectVersion = ProjectVersion

/** Result of `restoreProjectVersion`: the project's new revision, and the document shape restored. */
export interface RestoredProjectVersion {
  revision: number
  kind: string
}

/** Input to `undo`. Both optional. */
export interface UndoInput {
  /** The revision the caller last saw: the undo is refused with a 409 when the project has moved since. */
  expectedRevision?: number
  /** A specific revision to reverse. Omitted, the most recent edit. */
  revision?: number
}

/** Input to `redo`. */
export interface RedoInput {
  /** The revision the caller last saw: the redo is refused with a 409 when the project has moved since. */
  expectedRevision?: number
}

/** Result of `undo` or `redo`: an undo is itself an edit, with its own revision. */
export interface UndoResult {
  /** The revision the undo or redo created. */
  revision: number
  /** The revision it reversed. */
  undidRevision: number
  label: string
}

/** Options for starting a project export. All optional; defaults: format 'mp4', 720p, watermark on. */
export interface StartExportInput {
  /** A format the export catalog lists (`getExportFormats`): video, stills, documents, and for an editor project its sound, subtitles and transcript. */
  format?: string
  /** Video resolution (mp4): '480p'|'720p'|'1080p'|'2k'|'4k'. 1080p+ is plan-gated. */
  resolution?: string
  /** Video quality (mp4): 'low'|'recommended'|'high'. */
  quality?: string
  /** Keep the watermark. Removing it is plan-gated. Defaults true. */
  watermark?: boolean
  /** Editor still (png/jpg) only: the timeline frame to render. Clamped to the composition length. Defaults 0. */
  frame?: number
  /** Subtitles (srt, vtt) only: the longest a line may be, 20 to 80 characters. Defaults 42. */
  maxCharsPerLine?: number
  /** Subtitles (srt, vtt) only: lines per subtitle card, 1 to 4. Defaults 2. */
  maxLinesPerCard?: number
  /** Subtitles (srt, vtt) only: name who speaks, when the captions hold more than one speaker. Defaults false. */
  showSpeakers?: boolean
  /** Transcripts (txt, docx, rtf, md, html) only: start each paragraph with its timecode. */
  timecodes?: boolean
  /** Rendered exports (video and sound) only: this export's loudness, in place of the project's own. Omitted, the project's. */
  loudness?: Loudness
}

/** How an export's loudness came out, once it has finished. */
export interface ExportLoudness {
  /** What the export was asked to deliver at. */
  target: Loudness
  /** 'leveled': gain was applied to reach the target; 'unchanged': nothing was changed, because the mix already met the target or had no sound to level; 'off': no target was asked for. */
  outcome: 'leveled' | 'unchanged' | 'off'
  /** The gain applied, in dB, when leveled. */
  gainDb: number | null
  /** How far the limiter pulled peaks down, in dB, when it had to. */
  peakReductionDb: number | null
  deliveredLufs: number | null
  deliveredTruePeakDbtp: number | null
  /** The one line the app shows people about it. */
  summary: string
}

/** An export job. `mp4` starts as 'rendering' (poll it); canvas still/doc formats return 'completed'. */
export interface ExportJob {
  exportId: string
  /** The export's 8-character public id, used in app links and shown to people; `exportId` stays the UUID. */
  shortId: string
  /** This export in the app (it opens its project). */
  appUrl: string
  /** 'pending' | 'rendering' | 'transferring' | 'completed' | 'failed'. */
  status: string
  /** The final file URL, present when status is 'completed'. */
  outputUrl?: string | null
  /** The export's public share page, present once status is 'completed'. Every export has one. */
  shareUrl?: string | null
  errorMessage?: string | null
  /** The item that stopped a failed export, when one did: `errorMessage` names it for a person, without its id. */
  itemId?: string
  /** Overall progress, 0 to 1, across every stage of the export. Never lower than an earlier read. */
  progress?: number
  /** The stage that progress was reached in, a label beside the number. */
  stage?: string | null
  /**
   * What the code warned about: the compiler's findings before the render, and what the render itself found. A
   * warning stops nothing; the code drew, though perhaps not as its author meant. Absent when nothing did.
   */
  warnings?: CodeDiagnostic[]
  /** How its loudness came out. Absent or null until it finishes, and for an export with no mix (a still, a package, a subtitle file). */
  loudness?: ExportLoudness | null
}

/** One format in the export catalog. */
export interface ExportFormatSpec {
  format: string
  /** The project types that can export this format. */
  projectTypes: ProjectType[]
  /** @deprecated Alias for `projectTypes`, still emitted for one release window. */
  surfaces: string[]
  /** true = async render job (poll it); false = returned completed immediately. */
  async: boolean
  description: string
  options: string[]
}

/** What a tab's `{item}` segment names, in the link contract. */
export interface LinkTabItem {
  id: string
  /** Allowed values, when the item is a fixed view rather than an id. */
  values?: string[]
}

/** A query parameter a page reads from a link, in the link contract. */
export interface LinkParam {
  /** What it does for the person. */
  means: string
  /** The values it accepts; absent when it takes a free value (described in `value`). */
  values?: string[]
  value?: string
}

/** One linkable noun: `{origin}/{noun}/{id}[/{tab}[/{item}]]`. */
export interface LinkNoun {
  noun: string
  /** The API resource whose items it addresses: an item's `id` or `shortId` fits `{id}`. */
  resource: string
  /** What `{id}` accepts. */
  id: string
  /** What the address opens. */
  opens: string
  /** The page's tabs in order; the first is the default, which is the bare address. Absent: no tabs. */
  tabs?: string[]
  tabItems?: Record<string, LinkTabItem>
  /** Query parameters the page reads. */
  params?: Record<string, LinkParam>
}

/** One section page: `{origin}/{section}[/{tab}[/{item}]]`. */
export interface LinkSection {
  section: string
  opens: string
  tabs: string[]
  /** The tab the bare path shows; null when it shows the tab last used (then spell the tab). */
  defaultTab: string | null
  tabItems?: Record<string, LinkTabItem>
  /** Query parameters the page reads. */
  params?: Record<string, LinkParam>
}

/**
 * The authoring guide for a clip's code, from `getCodeGuide`: what the sandbox has, the composition's units, the brand
 * prop names, the size limit, the workflow and examples. The app builds it from the sandbox's own manifest, so it
 * cannot teach what the sandbox lacks. `markdown` is the whole guide as one document; the other fields are the same
 * facts, structured.
 */
export interface CodeGuide {
  /** Changes whenever anything in the guide does, so two readings can be told apart. */
  version: string
  markdown: string
  /** The composition's longest edge, in the units a clip's box is measured in. */
  compositionLongestEdge: number
  /** The largest code accepted, in UTF-8 bytes. */
  maxCodeBytes: number
  /** What each importable module provides: its names, or `any` for a package whose every export is open. */
  modules: Array<{ module: string; names: string[] | 'any' }>
  /** Names code can use without importing them, with the module each comes from (null for the sandbox's own). */
  noImportNeeded: Array<{ name: string; module: string | null }>
  /** Globals and APIs code cannot use, with why. */
  notAvailable: Array<{ name: string; module: string | null; reason: string }>
  /** Calls the compiler warns about, with what to use instead. */
  clockCalls: Array<{ call: string; instead: string }>
  /** Brand prop names, and the brand value each takes. */
  brandProps: Array<{ prop: string; takes: string }>
  examples: Array<{ name: string; title: string; description: string; code: string }>
}

/** One effect, as `listEffects` lists it (motion graphics 7.25, 7.37). */
export interface EffectSummary {
  /** The effect's function name, as code imports it and a clip stores it. */
  name: string
  /** Its group: Color, Blur & Shadow, Reveal, Transform, Distort, Stylize, Generate. */
  group: string
  description: string
  /** Where code imports it from. */
  importPath: string
  /** Whether a video or image clip can carry it. */
  onClips: boolean
  /** When a clip cannot: the grading control that already does its job. */
  gradedBy?: string
}

/** Every effect of `@remotion/effects` the app has, from `listEffects`. */
export interface EffectList {
  effects: EffectSummary[]
  /** The elements code gives `effects` to. */
  codeHosts: string[]
}

/** One parameter of an effect, as the effect's own schema states it. */
export interface EffectParamSchema {
  type: string
  default?: unknown
  min?: number
  max?: number
  step?: number
  description?: string
  [field: string]: unknown
}

/** One effect in full, from `getEffect`. */
export interface EffectDetail extends EffectSummary {
  backend: string
  documentation: string | null
  params: Record<string, EffectParamSchema>
  /** Parameters that draw something sensible as they are; some effects draw nothing, or refuse, without them. */
  defaults: Record<string, unknown>
  /** On a clip, the parameters that keyframe, at `effects.<id>.<param>`. */
  keyframeable: string[]
}

/** The link contract, from `getLinkFormats`: how to build any address in the app from a noun and an id. */
export interface LinkFormats {
  /** The app's origin, for `{origin}`. */
  origin: string
  grammar: string[]
  nouns: LinkNoun[]
  sections: LinkSection[]
}

/** The export-format catalog, from `getExportFormats`. */
export interface ExportFormatCatalog {
  formats: ExportFormatSpec[]
  resolutions: string[]
  qualities: string[]
}

/** Who normally writes a field. `editable` fields have an inspector control; `system` fields are written by the
 *  engine or set on create (media, generation markers, provenance); `structural` fields (timing, grouping, cut
 *  state) are owned by their ops. Any declared field except `id` and `type` is accepted by an update op. */
export type EditorFieldClass = 'editable' | 'system' | 'structural' | 'transient'

/** One field on a layer/clip type (from the type-discovery catalogs, generated from the editor's document schemas). */
export interface EditorTypeProp {
  name: string
  /** A human-readable type hint (e.g. 'string', 'number', "'left' | 'center' | 'right'"). */
  type: string
  description?: string
  class?: EditorFieldClass
  /** A create must carry it. */
  required?: boolean
  /** The control's range; a value outside it is refused. */
  min?: number
  max?: number
  /** The only values accepted; any other is refused. */
  options?: (string | number)[]
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
  /** The stored item's full JSON Schema, control ranges included. Present only when asked for (`{ jsonSchema: true }`). */
  jsonSchema?: Record<string, unknown>
}

/** What a type-catalog read may add. */
export interface TypeCatalogOptions {
  /** Include each type's full JSON Schema. Most of the catalog's size, so off by default. */
  jsonSchema?: boolean
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
  /** Entrance and exit animations. */
  animation?: EditorTypeProp[]
  /** Template provenance and artboard geometry. */
  template?: EditorTypeProp[]
  transform: EditorTypeProp[]
  decoration: EditorTypeProp[]
  adjust: EditorTypeProp[]
}

/** The whole canvas schema, from `getLayerTypes({ detail: 'full' })`. Makes `update_canvas` self-describing. */
export interface LayerTypeCatalog {
  projectType: 'canvas'
  /** @deprecated Alias for `projectType`, still emitted for one release window. */
  surface: 'canvas'
  description: string
  sharedProps: EditorSharedProps
  layerTypes: EditorTypeSpec[]
  /** The update_canvas op vocabulary: every layer + slide op an agent can emit, with its field signature. */
  ops?: EditorCreationSpec
}

/** The whole editor timeline schema, from `getTimelineTypes({ detail: 'full' })`. Makes `update_timeline`
 *  self-describing. */
export interface TimelineTypeCatalog {
  projectType: 'editor'
  /** @deprecated Alias for `projectType`, still emitted for one release window. */
  surface: 'editor'
  description: string
  sharedProps: EditorSharedProps
  clipTypes: EditorTypeSpec[]
  trackTypes: EditorTrackSpec[]
  /** How to CREATE clips + tracks (add_item, insert_track, insert_prebuilt_track), using each clipType `example`. */
  creation?: EditorCreationSpec
  /** The EDIT ops of update_timeline (move_clip, trim_clip, disable_ranges, ...), with each field signature. */
  editOps?: EditorCreationSpec
  /** The presets add_animation, add_transition and apply_combo accept. */
  animations?: AnimationCatalog
}

/** A preset add_animation, add_transition or apply_combo accepts. */
export interface AnimationPreset {
  presetKey: string
  name: string
  /** How long it runs when applied without a length, in seconds; null for a move that runs to the end of its clips. */
  defaultDurationSeconds: number | null
}

/** The presets by where they apply. */
export interface AnimationCatalog {
  description: string
  in: AnimationPreset[]
  out: AnimationPreset[]
  transition: AnimationPreset[]
  combo: AnimationPreset[]
}

/** One update_timeline op as the schema's index lists it. */
export interface TimelineOpIndexEntry {
  op: string
  shape: string
  /** Whether the op creates clips and tracks or edits them. */
  use: 'create' | 'edit'
}

/**
 * The INDEX of the editor timeline schema, from `getTimelineTypes()`: every update_timeline op with its shape, and every
 * clip and track type. Small enough to read whole; read one entry in full with `{ name }`, or everything with
 * `{ detail: 'full' }`. The whole schema is larger than one MCP tool result carries, which is why it reads in two steps.
 */
export interface TimelineSchemaIndex {
  projectType: 'editor'
  /** @deprecated Alias for `projectType`, still emitted for one release window. */
  surface: 'editor'
  description: string
  /** What holds for every op, so one op read in full is enough to use it. */
  rules: string[]
  clipTypes: Array<Pick<EditorTypeSpec, 'type' | 'description' | 'supports'>>
  trackTypes: EditorTrackSpec[]
  ops: TimelineOpIndexEntry[]
}

/** One op in full, from `getTimelineTypes({ name })`. */
export interface TimelineOpEntry extends TimelineOpIndexEntry {
  entry: 'op'
  description: string
}

/** One clip type in full, with the shared field groups it has, from `getTimelineTypes({ name })`. */
export interface TimelineClipTypeEntry {
  entry: 'clipType'
  clipType: EditorTypeSpec
  sharedProps: Partial<EditorSharedProps>
}

/** The presets, from `getTimelineTypes({ name: 'animations' })`. */
export interface TimelineAnimationsEntry extends AnimationCatalog {
  entry: 'animations'
}

/** One entry of the timeline schema, by name. */
export type TimelineSchemaEntry = TimelineOpEntry | TimelineClipTypeEntry | TimelineAnimationsEntry

/** One update_canvas op as the schema's index lists it. */
export interface LayerOpIndexEntry {
  op: string
  shape: string
}

/**
 * The INDEX of the canvas schema, from `getLayerTypes()`: every update_canvas op with its shape, every layer type, and
 * the rules every op follows. Read one entry in full with `{ name }`, or everything with `{ detail: 'full' }`.
 */
export interface LayerSchemaIndex {
  projectType: 'canvas'
  /** @deprecated Alias for `projectType`, still emitted for one release window. */
  surface: 'canvas'
  description: string
  /** What holds for every op, so one op read in full is enough to use it. */
  rules: string[]
  layerTypes: Array<Pick<EditorTypeSpec, 'type' | 'description' | 'supports'>>
  ops: LayerOpIndexEntry[]
}

/** One canvas op in full, from `getLayerTypes({ name })`. */
export interface LayerOpEntry extends LayerOpIndexEntry {
  entry: 'op'
  description: string
}

/** One layer type in full, with the shared field groups it has, from `getLayerTypes({ name })`. */
export interface LayerTypeEntry {
  entry: 'layerType'
  layerType: EditorTypeSpec
  sharedProps: Partial<EditorSharedProps>
}

/** One entry of the canvas schema, by name. */
export type LayerSchemaEntry = LayerOpEntry | LayerTypeEntry

/**
 * What a schema read asks for, timeline or canvas alike: the index (nothing), one entry (`name`), or the whole schema
 * (`detail`).
 */
export interface EditorSchemaOptions extends TypeCatalogOptions {
  /** One op or type to read in full; for the timeline, `animations` reads the presets. */
  name?: string
  /** `full`: the whole schema in one read. */
  detail?: 'full'
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
