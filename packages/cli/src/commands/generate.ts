/**
 * `contenthero generate <type>` - the generation hero path.
 *   generate image     text-to-image / image-to-image
 *   generate video     text-to-video, frame conditioning, references
 *   generate audio     ElevenLabs TTS / music / sfx (synchronous)
 *   generate board     a Reference Board (dense multi-panel sheet)
 *   generate lip-sync  animate a portrait to speak
 *
 * Request shaping mirrors the MCP intent tools so the CLI, SDK, and MCP submit
 * identical payloads. Shared async flags (--cost / --wait / --no-wait /
 * --timeout) come from runOptions; audio is synchronous so it only takes --cost.
 */

import type { Command } from 'commander'
import type { GenerateRequest, GenerateBoardRequest, BoardType } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { runGeneration, runBoard, compact, references, type RunOptions } from '../generation.js'
import { CliError, EXIT } from '../errors.js'
import { collect, toFloat, toInt, toJson } from '../args.js'

const BOARD_TYPES: BoardType[] = [
  'character',
  'pose',
  'mascot',
  'creature',
  'weapon',
  'vehicle',
  'object',
  'location',
  'shot',
]

const DEFAULT_TIMEOUT_SEC = 600

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

export function registerGenerate(program: Command): void {
  const generate = program
    .command('generate')
    .description('Generate media: image, video, audio, board, or lip-sync')

  // -- generate image -------------------------------------------------------
  addRunFlags(
    generate
      .command('image')
      .description('Generate one or more images from a prompt (optionally image-to-image)')
      .argument('[prompt]', 'the image prompt (optional for a few reference-only models)')
      .requiredOption('-m, --model <id>', 'image model id (see `contenthero model list --type image`)')
      .option('--aspect <ratio>', 'aspect ratio, e.g. 16:9, 1:1, 9:16')
      .option('--resolution <res>', 'resolution, e.g. 1K, 2K, 4K (model-dependent)')
      .option('--mode <mode>', 'variant mode for models that expose one (e.g. flux-2-pro: pro/flex)')
      .option('-n, --num <count>', 'number of variations (1-4)', toInt)
      .option('--seed <seed>', 'seed for reproducibility', toInt)
      .option('--ref <urlOrId>', 'reference image (URL or output id); repeatable', collect),
  ).action(async (prompt: string | undefined, opts: Record<string, unknown>, command: Command) => {
    const { client, ctx } = makeClient(command)
    const request = compact<GenerateRequest>({
      contentType: 'image',
      modelId: opts.model as string,
      prompt,
      aspectRatio: opts.aspect as string | undefined,
      resolution: opts.resolution as string | undefined,
      numImages: opts.num as number | undefined,
      seed: opts.seed as number | undefined,
      references: references({ images: opts.ref as string[] | undefined }),
      parameters: opts.mode ? { mode: opts.mode } : undefined,
    })
    await runGeneration(client, ctx, request, runOptions(opts))
  })

  // -- generate video -------------------------------------------------------
  addRunFlags(
    generate
      .command('video')
      .description('Generate a video from a prompt (optionally with frames / references)')
      .argument('[prompt]', 'the video prompt')
      .requiredOption('-m, --model <id>', 'video model id (see `contenthero model list --type video`)')
      .option('--aspect <ratio>', 'aspect ratio, e.g. 16:9, 9:16')
      .option('--resolution <res>', 'resolution, e.g. 720p, 1080p, 4K (model-dependent)')
      .option('--duration <seconds>', 'clip length in seconds (model-dependent)', toFloat)
      .option('--audio', 'enable generated audio (models that support it)')
      .option('-n, --num <count>', 'number of variations (1-4)', toInt)
      .option('--negative <text>', 'what to avoid (models that support it)')
      .option('--seed <seed>', 'seed for reproducibility', toInt)
      .option('--start-frame <urlOrId>', 'first frame (image URL or output id)')
      .option('--end-frame <urlOrId>', 'last frame (image URL or output id)')
      .option('--ref <urlOrId>', 'reference image (URL or output id); repeatable', collect)
      .option('--ref-video <urlOrId>', 'reference video (URL or output id); repeatable', collect)
      .option('--ref-audio <urlOrId>', 'reference audio (URL or output id); repeatable', collect)
      .option('--element <id>', 'saved reference element id (Kling 3.0, @name in prompt); repeatable', collect)
      .option('--multi-shot', 'enable multi-shot mode (e.g. WAN 2.6)')
      .option('--shots <json>', 'Kling 3.0 multi-shot: JSON array of { prompt, duration } objects', toJson),
  ).action(async (prompt: string | undefined, opts: Record<string, unknown>, command: Command) => {
    const { client, ctx } = makeClient(command)
    const shots = opts.shots as Array<{ prompt: string; duration: number }> | undefined
    const klingMultiShot = Array.isArray(shots) && shots.length > 0
    const wantMultiShot = klingMultiShot || opts.multiShot === true
    const parameters: Record<string, unknown> = {}
    if (wantMultiShot) parameters.multiShot = true
    if (klingMultiShot) parameters.shots = shots
    const request = compact<GenerateRequest>({
      contentType: 'video',
      modelId: opts.model as string,
      prompt: klingMultiShot ? (prompt ?? shots!.map((s) => s.prompt).join(' ')) : prompt,
      aspectRatio: opts.aspect as string | undefined,
      resolution: opts.resolution as string | undefined,
      duration: klingMultiShot
        ? shots!.reduce((sum, s) => sum + s.duration, 0)
        : (opts.duration as number | undefined),
      audioEnabled: opts.audio === true ? true : undefined,
      numGenerations: opts.num as number | undefined,
      negativePrompt: opts.negative as string | undefined,
      seed: opts.seed as number | undefined,
      parameters: Object.keys(parameters).length > 0 ? parameters : undefined,
      references: references({
        startFrame: opts.startFrame as string | undefined,
        endFrame: opts.endFrame as string | undefined,
        images: opts.ref as string[] | undefined,
        videos: opts.refVideo as string[] | undefined,
        audio: opts.refAudio as string[] | undefined,
        elements: (opts.element as string[] | undefined)?.map((elementId) => ({ elementId })),
      }),
    })
    await runGeneration(client, ctx, request, runOptions(opts))
  })

  // -- generate audio (synchronous) -----------------------------------------
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
    .option('--cost', 'estimate the credit cost instead of generating')
    .action(async (opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const request = compact<GenerateRequest>({
        contentType: 'audio',
        modelId: opts.model as string,
        prompt: opts.prompt as string | undefined,
        text: opts.text as string | undefined,
        voiceId: opts.voice as string | undefined,
        voiceName: opts.voiceName as string | undefined,
        durationSeconds: opts.duration as number | undefined,
        promptInfluence: opts.promptInfluence as number | undefined,
      })
      // Audio is synchronous: no waiting, so wait is irrelevant.
      await runGeneration(client, ctx, request, {
        cost: opts.cost === true,
        wait: false,
        timeoutSec: DEFAULT_TIMEOUT_SEC,
      })
    })

  // -- generate board -------------------------------------------------------
  addRunFlags(
    generate
      .command('board')
      .description('Generate a Reference Board (dense multi-panel reference sheet, 3:4 / 4K)')
      .argument('[prompt]', 'subject description (required when no --ref is given)')
      .requiredOption('-t, --type <type>', `board type: ${BOARD_TYPES.join(', ')}`)
      .option('--ref <urlOrId>', 'source image (URL or output id); repeatable', collect)
      .option('-n, --num <count>', 'number of board variations (1-4)', toInt)
      .option('--name <name>', 'optional board name'),
  ).action(async (prompt: string | undefined, opts: Record<string, unknown>, command: Command) => {
    const boardType = opts.type as string
    if (!BOARD_TYPES.includes(boardType as BoardType)) {
      throw new CliError(
        `Invalid --type "${boardType}". Expected one of: ${BOARD_TYPES.join(', ')}.`,
        EXIT.USAGE,
      )
    }
    const { client, ctx } = makeClient(command)
    const request = compact<GenerateBoardRequest>({
      boardType: boardType as BoardType,
      prompt,
      referenceImages: opts.ref as string[] | undefined,
      numImages: opts.num as number | undefined,
      boardName: opts.name as string | undefined,
    })
    await runBoard(client, ctx, request, runOptions(opts))
  })

  // -- generate lip-sync ----------------------------------------------------
  addRunFlags(
    generate
      .command('lip-sync')
      .description('Animate a portrait so the subject speaks (image + audio or script)')
      .requiredOption('-m, --model <id>', 'lip-sync model id (see `contenthero model list --type video`)')
      .requiredOption('--image <urlOrId>', 'portrait to animate (image URL or output id)')
      .option('--audio <urlOrId>', 'existing speech clip (audio URL or output id). Use this OR --script + --voice')
      .option('--script <text>', 'text for the subject to speak (requires --voice)')
      .option('--voice <id>', 'ElevenLabs voice id to speak the script')
      .option('--voice-name <name>', 'human-readable voice name (display only)')
      .option('--motion <text>', 'optional motion / expression hint')
      .option('--resolution <res>', 'resolution, e.g. 480p, 720p, 1080p (model-dependent)')
      .option('--audio-duration <seconds>', 'length of --audio in seconds (improves cost accuracy)', toFloat),
  ).action(async (opts: Record<string, unknown>, command: Command) => {
    if (!opts.audio && !(opts.script && opts.voice)) {
      throw new CliError(
        'Provide a voice source: either --audio <urlOrId>, or --script <text> together with --voice <id>.',
        EXIT.USAGE,
      )
    }
    const { client, ctx } = makeClient(command)
    const request = compact<GenerateRequest>({
      contentType: 'video',
      modelId: opts.model as string,
      prompt: opts.motion as string | undefined,
      text: opts.script as string | undefined,
      voiceId: opts.voice as string | undefined,
      voiceName: opts.voiceName as string | undefined,
      resolution: opts.resolution as string | undefined,
      durationSeconds: opts.audioDuration as number | undefined,
      references: references({
        images: [opts.image as string],
        audio: opts.audio ? [opts.audio as string] : undefined,
      }),
    })
    await runGeneration(client, ctx, request, runOptions(opts))
  })
}
