/**
 * One generate tool per medium: which tool runs which model, and how a model's operation shapes the request.
 *
 * The registry's `OperationKind` decides what a model does. An agent surface (the MCP, the CLI) has one tool per
 * medium for the Studio picker's work, so this module is the single place that maps a model's `(contentType, kind)`
 * to its tool, refuses the fields a model's operation does not take, and builds the request for every operation
 * that is not a plain generation. It reads the model from the registry at call time (`getModel`); nothing here names
 * a model id.
 *
 * `MODEL_KINDS` mirrors the registry's `OperationKind` (apps/web/lib/studio/model-registry/capability-schema.ts).
 * A test in the app holds the two lists equal, and `HOMES` is typed `Record<ModelKind, ...>`, so a kind added to
 * the registry fails a build or a test until it has a home here.
 */
import { NotFoundError, ValidationError } from './errors.js'
import type { ToolInput } from './contract.generated.js'
import type { GenerateBoardRequest, GenerateRequest, ModelInfo } from './types.js'

/** Every operation a registry model can perform. */
export const MODEL_KINDS = [
  'generate',
  'upscale',
  'lip-sync',
  'voice',
  'background-removal',
  'enhance',
  'layer-separation',
  'stem-separation',
] as const

export type ModelKind = (typeof MODEL_KINDS)[number]

export type Medium = 'image' | 'video' | 'audio'

/** The agent tool that runs a model of a given medium and operation. */
export type MediumTool = 'generate_image' | 'generate_video' | 'generate_audio' | 'edit_audio' | 'transcribe'

/**
 * Where each operation lives, per medium. `null` means no agent tool runs that pair: the operation does not exist
 * for the medium, or (voice) it is a voice flow outside the generate tools.
 */
export const HOMES: Record<ModelKind, Record<Medium, MediumTool | null>> = {
  generate: { image: 'generate_image', video: 'generate_video', audio: 'generate_audio' },
  upscale: { image: 'generate_image', video: 'generate_video', audio: null },
  'background-removal': { image: 'generate_image', video: 'generate_video', audio: null },
  'layer-separation': { image: 'generate_image', video: null, audio: null },
  'lip-sync': { image: null, video: 'generate_video', audio: null },
  voice: { image: null, video: null, audio: null },
  enhance: { image: null, video: null, audio: 'edit_audio' },
  'stem-separation': { image: null, video: null, audio: 'edit_audio' },
}

/** The operations `edit_audio` performs, as the registry names them (`ModelInfo.editOperation`). */
const EDIT_AUDIO_OPERATIONS: readonly string[] = ['isolate', 'enhance', 'split']

type ToolSubject = Pick<ModelInfo, 'contentType' | 'kind'> & { editOperation?: ModelInfo['editOperation']; capabilities?: Pick<ModelInfo['capabilities'], 'outputType'> }

/**
 * The tool for a model, or null when no agent tool runs it. An audio model routes by what the registry says it does,
 * the way `edit_audio` resolves a model: its edit operation, or a text output (speech to text, which `transcribe`
 * runs), before its kind, because a model's kind alone does not say which audio tool runs it.
 */
export function toolForModel(model: ToolSubject): MediumTool | null {
  const medium = model.contentType as Medium
  if (medium === 'audio') {
    if (model.editOperation && EDIT_AUDIO_OPERATIONS.includes(model.editOperation)) return 'edit_audio'
    if (model.capabilities?.outputType === 'text') return 'transcribe'
  }
  return HOMES[model.kind as ModelKind]?.[medium] ?? null
}

/** What `getMediumModel` reads from a client: the lookup, and the listing it falls back on. */
export interface ModelReader {
  getModel(modelId: string): Promise<ModelInfo>
  listModels(options?: { contentType?: Medium }): Promise<ModelInfo[]>
}

/**
 * A model for a generate tool of `medium`, by id. An id the registry does not serve (unknown, disabled or hidden) is
 * answered with the models that tool runs, by id, read from the same listing `list_models` shows, so a wrong id is
 * corrected in one step. The listing is read only on that failure: a good id costs one request.
 */
export async function getMediumModel(client: ModelReader, modelId: string, medium: 'image' | 'video'): Promise<ModelInfo> {
  try {
    return await client.getModel(modelId)
  } catch (e) {
    if (!(e instanceof NotFoundError)) throw e
    const tool: MediumTool = medium === 'image' ? 'generate_image' : 'generate_video'
    const available = (await client.listModels({ contentType: medium })).filter((m) => toolForModel(m) === tool).map((m) => m.modelId)
    throw new NotFoundError(
      `Model '${modelId}' not found. ${tool} runs these models: ${available.length ? available.join(', ') : 'none are available'}.`,
      { status: e.status, body: e.body, requestId: e.requestId },
    )
  }
}

/** True for the reference board pipeline, which the registry lists as a generation but which runs its own route. */
export function isBoardModel(model: Pick<ModelInfo, 'boardTypes'>): boolean {
  return Array.isArray(model.boardTypes)
}

/** What a model does, in words. */
const WORK: Record<ModelKind, string> = {
  generate: 'generation',
  upscale: 'upscaling',
  'background-removal': 'background removal',
  'layer-separation': 'layer separation',
  'lip-sync': 'lip sync',
  voice: 'voice',
  enhance: 'enhancement',
  'stem-separation': 'stem separation',
}

/**
 * The inputs a model's operation takes, as its tool's field names, or null for a plain generation (whose fields are
 * the model's request shape) and for a model no tool runs.
 */
export function operationInputs(model: Pick<ModelInfo, 'contentType' | 'kind' | 'boardTypes'>): string[] | null {
  if (isBoardModel(model)) return [...BOARD_TAKES]
  const taken = TAKES[model.kind as ModelKind]?.[model.contentType as Medium]
  return taken ? [...taken] : null
}

/** The sentence a model's description ends with: which tool runs it. */
export function matchingToolSentence(model: ToolSubject & Pick<ModelInfo, 'boardTypes'>): string {
  const tool = toolForModel(model)
  const work = isBoardModel(model) ? 'reference board' : tool === 'transcribe' ? 'transcription' : WORK[model.kind as ModelKind] ?? model.kind
  return tool
    ? `Runs with ${tool} (${work}).`
    : `No agent tool runs this model (${work}).`
}

/** The flat inputs of the two generate tools that this module reads. Field names are the contract's. */
export type MediumInput = Partial<ToolInput<'generate_image'>> & Partial<ToolInput<'generate_video'>>

/** Fields every operation accepts. */
const ANY: readonly string[] = ['modelId', 'getCost']
/** Fields that place the result on a project. */
const PLACE: readonly string[] = ['projectId', 'placement', 'playheadFrame']

/**
 * The inputs an operation takes besides `ANY`, by medium. A generation takes everything the tool declares except
 * the fields listed in `FOREIGN_TO_GENERATE`, so it has no entry here.
 */
const TAKES: Partial<Record<ModelKind, Partial<Record<Medium, readonly string[]>>>> = {
  upscale: { image: ['referenceImages', 'upscaleFactor'], video: ['referenceVideos', 'upscaleFactor', 'sourceDurationSeconds'] },
  'background-removal': {
    image: ['referenceImages', ...PLACE],
    video: ['referenceVideos', 'sourceDurationSeconds', 'outputFormat', ...PLACE],
  },
  'layer-separation': { image: ['referenceImages', 'prompt'] },
  'lip-sync': {
    video: [
      'prompt', 'resolution', 'referenceImages', 'referenceVideos', 'referenceAudio', 'script', 'voiceId',
      'voiceName', 'audioDurationSeconds', ...PLACE,
    ],
  },
}

const BOARD_TAKES: readonly string[] = ['boardType', 'boardName', 'prompt', 'referenceImages', 'numImages', 'avatarId']

/** Fields only another operation takes; a plain generation refuses them. */
const FOREIGN_TO_GENERATE: readonly string[] = [
  'upscaleFactor', 'sourceDurationSeconds', 'script', 'voiceId', 'voiceName', 'audioDurationSeconds', 'boardType', 'boardName',
]

function present(v: unknown): boolean {
  return v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)
}

/**
 * Refuses a field the model's operation does not take, naming the model, what it does and what it takes. A field
 * that is silently ignored is a lie about what ran, so every mismatch is an error.
 */
function refuseForeign(model: ModelInfo, input: MediumInput, medium: Medium): void {
  const board = isBoardModel(model)
  const kind = model.kind as ModelKind
  const set = Object.keys(input).filter((k) => present((input as Record<string, unknown>)[k]))
  let bad: string[]
  let takes: string[] | null
  if (board) {
    takes = [...ANY, ...BOARD_TAKES]
    bad = set.filter((k) => !takes!.includes(k))
  } else if (kind === 'generate') {
    takes = null
    bad = set.filter((k) => FOREIGN_TO_GENERATE.includes(k))
  } else {
    takes = [...ANY, ...(TAKES[kind]?.[medium] ?? [])]
    bad = set.filter((k) => !takes!.includes(k))
  }
  if (bad.length === 0) return
  const what = board ? 'a reference board' : WORK[kind] ?? kind
  throw new ValidationError(
    `${model.modelId} is a model for ${medium} work that does ${what}. It does not take ${bad.join(', ')}. ` +
      (takes ? `It takes: ${takes.join(', ')}.` : 'get_model lists the fields it takes.'),
  )
}

function need(model: ModelInfo, what: string, input: unknown): void {
  if (!present(input)) throw new ValidationError(`${model.modelId} needs ${what}.`)
}

function oneOf(model: ModelInfo, field: string, list: string[] | undefined): string {
  if (!list || list.length !== 1) {
    throw new ValidationError(`${model.modelId} takes exactly one source in ${field}${list?.length ? `, got ${list.length}` : ''}.`)
  }
  return list[0]!
}

/** What a medium call resolves to once the model's operation is known. */
export type MediumPlan =
  /** A plain generation: the caller builds the request from the tool's full field set, as it always did. */
  | { route: 'generate' }
  /** Any other operation that runs through the generate route, with the request ready. */
  | { route: 'operation'; request: GenerateRequest }
  /** The reference board pipeline: its own route, which waits. */
  | { route: 'board'; request: GenerateBoardRequest }

/**
 * Checks a model against the tool its medium calls and the fields passed, and builds the request for every
 * operation that is not a plain generation. Throws a `ValidationError` naming the model on any mismatch.
 */
export function planMediumCall(model: ModelInfo, medium: 'image' | 'video', input: MediumInput): MediumPlan {
  const kind = model.kind as ModelKind
  const home = toolForModel(model)
  const tool: MediumTool = medium === 'image' ? 'generate_image' : 'generate_video'
  if (model.contentType !== medium || home !== tool) {
    const where = home ? `Use ${home}.` : 'No agent tool runs it.'
    throw new ValidationError(`${model.modelId} is a model for ${model.contentType} work that does ${WORK[kind] ?? kind}, not ${medium} work through ${tool}. ${where}`)
  }
  refuseForeign(model, input, medium)

  if (isBoardModel(model)) {
    need(model, 'boardType', input.boardType)
    if (!present(input.referenceImages) && !present(input.prompt)) {
      throw new ValidationError(`${model.modelId} needs referenceImages, a prompt, or both.`)
    }
    return {
      route: 'board',
      request: compactOf<GenerateBoardRequest>({
        boardType: input.boardType as GenerateBoardRequest['boardType'],
        prompt: input.prompt,
        referenceImages: input.referenceImages,
        numImages: input.numImages,
        boardName: input.boardName,
        avatarId: input.avatarId,
      }),
    }
  }

  const base = { contentType: medium, modelId: model.modelId, kind } as const
  const video = medium === 'video'
  switch (kind) {
    case 'generate':
      return { route: 'generate' }
    case 'upscale': {
      need(model, 'upscaleFactor', input.upscaleFactor)
      if (video) need(model, 'sourceDurationSeconds (the source video length, for pricing)', input.sourceDurationSeconds)
      const source = oneOf(model, video ? 'referenceVideos' : 'referenceImages', video ? input.referenceVideos : input.referenceImages)
      return {
        route: 'operation',
        request: compactOf<GenerateRequest>({
          ...base,
          upscaleFactor: input.upscaleFactor,
          duration: video ? input.sourceDurationSeconds : undefined,
          references: video ? { videos: [source] } : { images: [source] },
        }),
      }
    }
    case 'background-removal': {
      if (video) need(model, 'sourceDurationSeconds (the source video length, for pricing)', input.sourceDurationSeconds)
      const source = oneOf(model, video ? 'referenceVideos' : 'referenceImages', video ? input.referenceVideos : input.referenceImages)
      return {
        route: 'operation',
        request: compactOf<GenerateRequest>({
          ...base,
          duration: video ? input.sourceDurationSeconds : undefined,
          parameters: video && input.outputFormat !== undefined ? { outputFormat: input.outputFormat } : undefined,
          references: video ? { videos: [source] } : { images: [source] },
          projectId: input.projectId,
          placement: input.placement as GenerateRequest['placement'],
          playheadFrame: input.playheadFrame,
        }),
      }
    }
    case 'layer-separation': {
      const source = oneOf(model, 'referenceImages', input.referenceImages)
      return {
        route: 'operation',
        request: compactOf<GenerateRequest>({ ...base, prompt: input.prompt, references: { images: [source] } }),
      }
    }
    case 'lip-sync': {
      if (input.referenceAudio && input.referenceAudio.length > 1) {
        throw new ValidationError(`${model.modelId} takes at most one speech clip in referenceAudio, got ${input.referenceAudio.length}.`)
      }
      return {
        route: 'operation',
        request: compactOf<GenerateRequest>({
          ...base,
          prompt: input.prompt,
          text: input.script,
          voiceId: input.voiceId,
          voiceName: input.voiceName,
          resolution: input.resolution,
          durationSeconds: input.audioDurationSeconds,
          references: compactOf({
            images: input.referenceImages,
            videos: input.referenceVideos,
            audio: input.referenceAudio,
          }),
          projectId: input.projectId,
          placement: input.placement as GenerateRequest['placement'],
          playheadFrame: input.playheadFrame,
        }),
      }
    }
    default:
      throw new ValidationError(`No agent tool runs ${model.modelId} (${WORK[kind] ?? kind}).`)
  }
}

function compactOf<T>(o: Record<string, unknown>): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) if (present(v)) out[k] = v
  return out as T
}
