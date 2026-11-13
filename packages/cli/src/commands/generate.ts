/**
 * `contenthero generate <type>` - the generation hero path.
 *   generate image     everything the Studio image picker runs: generation, upscale, background removal,
 *                      layer separation, Reference Boards
 *   generate video     everything the Studio video picker runs: generation, lip-sync, upscale, background removal
 *   generate audio     ElevenLabs TTS / music / sfx (synchronous)
 *
 * The model's registry kind decides what runs, resolved at call time and planned by the SDK's `planMediumCall`,
 * the same function the MCP tools use, so the CLI, SDK, and MCP submit identical payloads and refuse the same
 * fields. Shared async flags (--cost / --wait / --no-wait /
 * --timeout) come from runOptions; audio is synchronous so it only takes --cost.
 *
 * `--avatar` on `image` files the result against an avatar. The API has accepted this since the
 * avatar work landed and no client exposed it, so generating a new LOOK for a character had no path outside
 * the browser even though the server was ready for one.
 */

import { Option, type Command } from 'commander'
import {
  optionFromContract,
  getMediumModel,
  planMediumCall,
  type ContentHero,
  type GenerateRequest,
  type MediumInput,
  type ModelInfo,
} from '@contenthero/sdk'
import { makeClient, type Context } from '../context.js'
import { runGeneration, runBoard, compact, references, type RunOptions, DEFAULT_TIMEOUT_SEC } from '../generation.js'
import { collect, collectJson, toVoice, toFloat, toInt, toJson } from '../args.js'



/** The Kling elements of one call: saved ones by id, then the ones defined in the call. Undefined when there are none. */
export function klingElementsFrom(
  saved: string[] | undefined,
  inline: object[] | undefined,
): NonNullable<GenerateRequest['references']>['klingElements'] | undefined {
  const all = [
    ...(saved ?? []).map((klingElementId) => ({ klingElementId })),
    ...((inline ?? []) as NonNullable<GenerateRequest['references']>['klingElements'] & object[]),
  ]
  return all.length > 0 ? all : undefined
}

/** Add the shared async flags to a waitable generate command. */
function addRunFlags(cmd: Command): Command {
  return cmd
    .option('--cost', 'estimate the credit cost instead of generating (nothing runs, nothing is charged)')
    .option('--no-wait', 'return the outputId immediately instead of waiting for the render')
    .option('--timeout <seconds>', 'how long to wait before handing back the outputId', toInt, DEFAULT_TIMEOUT_SEC)
}

/** Extract RunOptions from a command's parsed options. */
function runOptions(opts: { cost?: boolean; wait?: boolean; timeout?: number }): RunOptions {
  return {
    cost: opts.cost === true,
    wait: opts.wait !== false,
    timeoutSec: opts.timeout ?? DEFAULT_TIMEOUT_SEC,
  }
}

/** Add the optional one-call timeline-placement flags to a generate command. */
function addPlacementFlags(cmd: Command): Command {
  return cmd
    .option('--project <id>', 'editor project to place the result on (omit for a standalone library output)')
    .option('--placement <json>', 'placement intent as JSON, e.g. {"mode":"atPlayhead"} (omit to place at the playhead when known, else append)', toJson)
    .option('--playhead <frame>', 'current playhead frame, for playhead-relative placement', toInt)
}

/** Build the placement request fields from a command's parsed options. */
function placementFields(opts: Record<string, unknown>): Pick<GenerateRequest, 'projectId' | 'placement' | 'playheadFrame'> {
  return {
    projectId: opts.project as string | undefined,
    placement: opts.placement as GenerateRequest['placement'],
    playheadFrame: opts.playhead as number | undefined,
  }
}

/** An image flag's words, read from the canonical tool input. */
const image = (input: string): string => optionFromContract('generate_image', input).description

/** A video flag's words, read from the canonical tool input. */
const video = (input: string): string => optionFromContract('generate_video', input).description

/** A music flag's words, read from the agent contract's generate_audio input it mirrors. */
const music = (input: string): string => optionFromContract('generate_audio', input).description

/** Drop the keys a flag left unset, so the SDK planner sees only what the caller passed. */
function given<T extends object>(obj: T): T {
  return compact(obj)
}

/**
 * Run one image or video call. The model is asked for at call time, the SDK plans the call from its kind, and the
 * plan picks the route: a plain generation submits the request built by the caller, an operation submits the
 * planned request, a board runs the board pipeline.
 */
async function runMedium(
  client: ContentHero,
  ctx: Context,
  medium: 'image' | 'video',
  model: ModelInfo,
  input: MediumInput,
  generateRequest: GenerateRequest,
  run: RunOptions,
): Promise<void> {
  const plan = planMediumCall(model, medium, input)
  if (plan.route === 'board') return runBoard(client, ctx, plan.request, run)
  return runGeneration(client, ctx, plan.route === 'operation' ? plan.request : generateRequest, run)
}

export function registerGenerate(program: Command): void {
  const generate = program
    .command('generate')
    .description('Generate media: image, video, or audio. Each runs every operation its models offer (see `contenthero model get <id>`)')

  // -- generate image -------------------------------------------------------
  addPlacementFlags(addRunFlags(
    generate
      .command('image')
      .description('Generate one or more images from a prompt (optionally image-to-image)')
      .argument('[prompt]', 'the image prompt (optional for a few reference-only models)')
      .requiredOption('-m, --model <id>', 'image model id (see `contenthero model list --type image`)')
      .option('--aspect <ratio>', 'aspect ratio, e.g. 16:9, 1:1, 9:16')
      .option('--resolution <res>', 'resolution, e.g. 1K, 2K, 4K (model-dependent)')
      .option('--quality <quality>', image('quality'))
      .option('--output-format <format>', image('outputFormat'))
      .option('--background <background>', image('background'))
      .option('--frame-count <count>', image('frameCount'))
      .option('--frame-duration-ms <milliseconds>', image('frameDurationMs'), toInt)
      .option('--frame-size <size>', image('frameSize'))
      // ⛔ NO `--mode`. It picked a paid TIER (flux pro/flex, kontext pro/max) that the registry
      // now names with its own model id, so `-m flux-2-flex` says what `--mode flex` used to.
      // See .claude/plans/model-id-tier-convention-v1.md in the app repo.
      .option('-n, --num <count>', 'number of variations (1-4)', toInt)
      .option('--ref <urlOrId>', 'reference image (URL or output id); repeatable', collect)
      .option('--avatar <id>', 'file the result onto this avatar as a new look (see `contenthero avatar list`)')
      .option('--upscale-factor <factor>', image('upscaleFactor'))
      .option('--type <boardType>', image('boardType'))
      .option('--name <name>', image('boardName')),
  )).action(async (prompt: string | undefined, opts: Record<string, unknown>, command: Command) => {
    const { client, ctx } = makeClient(command)
    const model = await getMediumModel(client, opts.model as string, 'image')
    let frameCount = opts.frameCount as GenerateRequest['frameCount']
    if (frameCount !== undefined) {
      const key = model.capabilities.imageOutput?.gif?.frameCountKey
      const setting = model.capabilities.settings?.find(s => s.key === key)
      if (setting?.control === 'slider') frameCount = toInt(String(frameCount))
    }
    const request = compact<GenerateRequest>({
      contentType: 'image',
      kind: 'generate',
      modelId: opts.model as string,
      prompt,
      aspectRatio: opts.aspect as string | undefined,
      resolution: opts.resolution as string | undefined,
      quality: opts.quality as GenerateRequest['quality'],
      outputFormat: opts.outputFormat as GenerateRequest['outputFormat'],
      parameters: opts.background === undefined ? undefined : { background: opts.background as string },
      frameCount,
      frameDurationMs: opts.frameDurationMs as GenerateRequest['frameDurationMs'],
      frameSize: opts.frameSize as GenerateRequest['frameSize'],
      numImages: opts.num as number | undefined,
      references: references({ images: opts.ref as string[] | undefined }),
      avatarId: opts.avatar as string | undefined,
      ...placementFields(opts),
    })
    const input = given<MediumInput>({
      prompt,
      aspectRatio: opts.aspect as string | undefined,
      resolution: opts.resolution as string | undefined,
      quality: opts.quality as MediumInput['quality'],
      outputFormat: opts.outputFormat as MediumInput['outputFormat'],
      background: opts.background as MediumInput['background'],
      frameCount: opts.frameCount as MediumInput['frameCount'],
      frameDurationMs: opts.frameDurationMs as number | undefined,
      frameSize: opts.frameSize as MediumInput['frameSize'],
      numImages: opts.num as number | undefined,
      referenceImages: opts.ref as string[] | undefined,
      avatarId: opts.avatar as string | undefined,
      upscaleFactor: opts.upscaleFactor as string | undefined,
      boardType: opts.type as MediumInput['boardType'],
      boardName: opts.name as string | undefined,
      projectId: opts.project as string | undefined,
      placement: opts.placement as MediumInput['placement'],
      playheadFrame: opts.playhead as number | undefined,
    })
    await runMedium(client, ctx, 'image', model, input, request, runOptions(opts))
  })

  // -- generate video -------------------------------------------------------
  addPlacementFlags(addRunFlags(
    generate
      .command('video')
      .description('Generate a video from a prompt (optionally with frames / references)')
      .argument('[prompt]', 'the video prompt')
      .requiredOption('-m, --model <id>', 'video model id (see `contenthero model list --type video`)')
      .option('--aspect <ratio>', 'aspect ratio, e.g. 16:9, 9:16')
      .option('--resolution <res>', 'resolution, e.g. 720p, 1080p, 4K (model-dependent)')
      .option('--duration <seconds>', 'clip length in seconds (model-dependent)', toFloat)
      .option('--draft', optionFromContract('generate_video', 'draft').description)
      .option('--upgrade-from-output-id <id>', optionFromContract('generate_video', 'upgradeFromOutputId').description)
      .option('--upgrade-slot <slot>', optionFromContract('generate_video', 'upgradeSlot').description, toInt)
      .option('--output-format <format>', optionFromContract('generate_video', 'outputFormat').description)
      .option('--return-last-frame', optionFromContract('generate_video', 'returnLastFrame').description)
      .option('--keep-input-length', "keep the input video's full length (video edit only)")
      .option('--audio', 'enable generated audio (models that support it)')
      .option('-n, --num <count>', 'number of variations (1-4)', toInt)
      .option('--negative <text>', 'what to avoid (models that support it)')
      .option('--start-frame <urlOrId>', 'first frame (image URL or output id)')
      .option('--end-frame <urlOrId>', 'last frame (image URL or output id)')
      .option('--keyframe <urlOrId>', 'middle frame between the first and last, in order (URL or output id); repeatable; needs --start-frame', collect)
      .option('--ref <urlOrId>', 'reference image (URL or output id); repeatable', collect)
      .option('--ref-video <urlOrId>', 'reference video (URL or output id); repeatable', collect)
      .option('--ref-audio <urlOrId>', 'reference audio (URL or output id); repeatable', collect)
      .option('--voice <name:urlOrId>', 'a named voice, addressed in the prompt as @name, with the audio it speaks with (URL or output id); repeatable', toVoice)
      .option('--keep-original-sound', "on a model that offers it, with a reference video: keep that video's own sound in the result")
      .option('--kling-element <id>', 'saved Kling element id (Kling 3.0, @name in prompt); repeatable', collect)
      .option('--inline-kling-element <json>', 'define a Kling element in the call: a JSON object with name and any of description, images, video, voice (each a URL or output id; model get says what the model takes); repeatable', collectJson)
      .option('--multi-shot', 'multi-shot with the cuts planned by the model, on a model whose shots include auto (model get); to write each shot yourself, pass --shots instead')
      .option('--shots <json>', 'write each shot yourself, on a model whose shots include custom: JSON array of { prompt, duration } objects', toJson)
      .option('--input-mode <id>', 'the input mode, by id from model get; omit to let the attached inputs decide')
      .option('--upscale-factor <factor>', video('upscaleFactor'))
      .option('--source-duration <seconds>', video('sourceDurationSeconds'), toFloat)
      .option('--script <text>', video('script'))
      .option('--voice-id <id>', video('voiceId'))
      .option('--voice-name <name>', video('voiceName'))
      .option('--audio-duration <seconds>', video('audioDurationSeconds'), toFloat),
  )).action(async (prompt: string | undefined, opts: Record<string, unknown>, command: Command) => {
    const { client, ctx } = makeClient(command)
    const model = await getMediumModel(client, opts.model as string, 'video')
    const shots = opts.shots as Array<{ prompt: string; duration: number }> | undefined
    const klingMultiShot = Array.isArray(shots) && shots.length > 0
    const wantMultiShot = klingMultiShot || opts.multiShot === true
    const parameters: Record<string, unknown> = {}
    if (wantMultiShot) parameters.multiShot = true
    if (typeof opts.inputMode === 'string') parameters.inputMode = opts.inputMode
    if (opts.keepOriginalSound === true) parameters.keepOriginalSound = true
    if (opts.draft !== undefined) parameters.draft = opts.draft
    if (opts.outputFormat !== undefined) parameters.outputFormat = opts.outputFormat
    if (opts.returnLastFrame !== undefined) parameters.returnLastFrame = opts.returnLastFrame
    if (klingMultiShot) parameters.shots = shots
    const request = compact<GenerateRequest>({
      contentType: 'video',
      kind: 'generate',
      modelId: opts.model as string,
      upgradeFromOutputId: opts.upgradeFromOutputId as GenerateRequest['upgradeFromOutputId'],
      upgradeSlot: opts.upgradeSlot as GenerateRequest['upgradeSlot'],
      prompt: klingMultiShot ? (prompt ?? shots!.map((s) => s.prompt).join(' ')) : prompt,
      aspectRatio: opts.aspect as string | undefined,
      resolution: opts.resolution as string | undefined,
      duration: klingMultiShot
        ? shots!.reduce((sum, s) => sum + s.duration, 0)
        : (opts.duration as number | undefined),
      keepInputLength: opts.keepInputLength === true ? true : undefined,
      audioEnabled: opts.audio === true ? true : undefined,
      numGenerations: opts.num as number | undefined,
      negativePrompt: opts.negative as string | undefined,
      parameters: Object.keys(parameters).length > 0 ? parameters : undefined,
      references: references({
        startFrame: opts.startFrame as string | undefined,
        endFrame: opts.endFrame as string | undefined,
        keyframes: opts.keyframe as string[] | undefined,
        voices: opts.voice as Array<{ name: string; audio: string }> | undefined,
        images: opts.ref as string[] | undefined,
        videos: opts.refVideo as string[] | undefined,
        audio: opts.refAudio as string[] | undefined,
        klingElements: klingElementsFrom(opts.klingElement as string[] | undefined, opts.inlineKlingElement as object[] | undefined),
      }),
      ...placementFields(opts),
    })
    const input = given<MediumInput>({
      prompt,
      aspectRatio: opts.aspect as string | undefined,
      resolution: opts.resolution as string | undefined,
      duration: opts.duration as number | undefined,
      draft: opts.draft as MediumInput['draft'],
      upgradeFromOutputId: opts.upgradeFromOutputId as MediumInput['upgradeFromOutputId'],
      upgradeSlot: opts.upgradeSlot as MediumInput['upgradeSlot'],
      outputFormat: opts.outputFormat as MediumInput['outputFormat'],
      returnLastFrame: opts.returnLastFrame as MediumInput['returnLastFrame'],
      keepInputLength: opts.keepInputLength === true ? true : undefined,
      audioEnabled: opts.audio === true ? true : undefined,
      numGenerations: opts.num as number | undefined,
      negativePrompt: opts.negative as string | undefined,
      startFrame: opts.startFrame as string | undefined,
      endFrame: opts.endFrame as string | undefined,
      keyframes: opts.keyframe as string[] | undefined,
      voices: opts.voice as MediumInput['voices'],
      referenceImages: opts.ref as string[] | undefined,
      referenceVideos: opts.refVideo as string[] | undefined,
      referenceAudio: opts.refAudio as string[] | undefined,
      keepOriginalSound: opts.keepOriginalSound === true ? true : undefined,
      klingElements: request.references?.klingElements as MediumInput['klingElements'],
      multiShot: opts.multiShot === true ? true : undefined,
      shots: klingMultiShot ? shots : undefined,
      inputMode: opts.inputMode as string | undefined,
      upscaleFactor: opts.upscaleFactor as string | undefined,
      sourceDurationSeconds: opts.sourceDuration as number | undefined,
      script: opts.script as string | undefined,
      voiceId: opts.voiceId as string | undefined,
      voiceName: opts.voiceName as string | undefined,
      audioDurationSeconds: opts.audioDuration as number | undefined,
      projectId: opts.project as string | undefined,
      placement: opts.placement as MediumInput['placement'],
      playheadFrame: opts.playhead as number | undefined,
    })
    await runMedium(client, ctx, 'video', model, input, request, runOptions(opts))
  })

  // -- generate audio (synchronous) -----------------------------------------
  addPlacementFlags(
    generate
      .command('audio')
      .description('Generate audio with ElevenLabs: speech (TTS), music, or a sound effect')
      .requiredOption('-m, --model <id>', 'audio model id (see `contenthero model list --type audio`)')
      .option('--prompt <text>', 'for music / sfx: what to generate')
      .option('--text <text>', 'for TTS: the words to speak')
      .option('--voice <id>', 'for TTS: the ElevenLabs voice id')
      .option('--voice-name <name>', 'for TTS: human-readable voice name (display only)')
      .option('--duration <seconds>', 'for music / sfx: length in seconds', toFloat)
      .option('--prompt-influence <0-1>', 'for sfx: how literally to follow the prompt', toFloat)
      .option('--composition-plan <json>', music('compositionPlan'), toJson)
      .option('--seed <n>', music('seed'), toInt)
      .option('--with-timestamps', music('withTimestamps'))
      .option('--store-for-inpainting', music('storeForInpainting'))
      .option('--cost', 'estimate the credit cost instead of generating'),
  )
    .action(async (opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const request = compact<GenerateRequest>({
        contentType: 'audio',
        kind: 'generate',
        modelId: opts.model as string,
        prompt: opts.prompt as string | undefined,
        text: opts.text as string | undefined,
        voiceId: opts.voice as string | undefined,
        voiceName: opts.voiceName as string | undefined,
        durationSeconds: opts.duration as number | undefined,
        promptInfluence: opts.promptInfluence as number | undefined,
        compositionPlan: opts.compositionPlan as GenerateRequest['compositionPlan'],
        seed: opts.seed as number | undefined,
        withTimestamps: opts.withTimestamps === true ? true : undefined,
        storeForInpainting: opts.storeForInpainting === true ? true : undefined,
        ...placementFields(opts),
      })
      // Audio is synchronous: no waiting, so wait is irrelevant.
      await runGeneration(client, ctx, request, {
        cost: opts.cost === true,
        wait: false,
        timeoutSec: DEFAULT_TIMEOUT_SEC,
      })
    })
}
