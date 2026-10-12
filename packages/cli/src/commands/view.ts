/**
 * `contenthero view` - see what the user is looking at, and see or hear your own work. The CLI twin of the MCP's
 * `view`.
 *
 *   view [--project <id>] [--capture] [--render] [--frame <n>] [--slide <id>] [--slide-index <n>]
 *        [--frames <list>] [--from-frame <n>] [--to-frame <n>] [--count <n>] [--per-second <n>]
 *        [--layout <frames|sheets>] [--sound] [--video] [--render-id <id>] [--page <n>] [--wait <seconds>]
 *        [--width <n>] [--region <x,y,w,h>] [--asset <id> | --media-url <url> | --content-id <id> [--slide <n>]]
 *        [--from-sec <n>] [--to-sec <n>] [--at-sec <list>] [--save <path>]
 *
 * Returns the most-recent-active session's surface + focus + selection, plus the live participant set.
 * Structured by default. `--capture` pings the live tab for a fresh viewport screenshot (the user's SCREEN).
 * `--render` renders the COMPOSED OUTPUT (the editor frames / canvas slide), ephemeral and stored nowhere;
 * `--sound` renders and measures a range's mix instead, and `--video` watches a range play: a terminal cannot take
 * video, so it comes back as the range's frames and its sound measured. A render is a job: what is not ready within
 * `--wait` is read with `--render-id` and `--page`. `--asset` or `--media-url` names a clip of the user's instead, and
 * `--content-id` a tracked post's video (with `--slide`, the carousel's video slide, which with a post names that
 * rather than a canvas slide: a source takes no canvas slide, and the edit no post's). A source is windowed by
 * `--from-sec` and `--to-sec`; its frames come spread across the window (`--count`), at named seconds (`--at-sec`) or
 * per second (`--per-second`), and `--sound` measures the window as it is, beside any frames. `--width` and `--region`
 * say what the MCP's `view` fields say (copied by hand until one source holds every field's description). `--save`
 * writes whichever images were produced (render preferred over snapshot: frames, contact sheets, a sound's picture,
 * or a source's keyframes, a post's evidence sheet and its sound's picture) to files.
 */
import { writeFileSync } from 'node:fs'
import type { Command } from 'commander'
import type { CompositionRegion, ViewResult } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit } from '../output.js'
import { CliError, EXIT } from '../errors.js'
import {
  describeAudioMap,
  describeEvidenceSheet,
  describeClip,
  describeCodeWarnings,
  describeRenderFailure,
  describeRenderProgress,
  describeSoundMeasurement,
  describeSourceSound,
  type AudioMapAnswer,
  type EvidenceSheet,
  type CodeDiagnostic,
} from '@contenthero/sdk'

/** Split a `data:<mime>;base64,<data>` URL into a Buffer. Returns null on any non-data-URL. */
function bufferFromDataUrl(dataUrl: unknown): Buffer | null {
  if (typeof dataUrl !== 'string') return null
  const m = /^data:[^;]+;base64,(.+)$/s.exec(dataUrl)
  const b64 = m?.[1]
  return b64 ? Buffer.from(b64, 'base64') : null
}

/** `x,y,w,h` in composition units, or a source clip's own pixels: the same four numbers the API's `region` takes. */
function parseRegion(value: string): CompositionRegion {
  const parts = value.split(',').map((v) => Number(v.trim()))
  const [x, y, width, height] = parts
  if (parts.length !== 4 || !parts.every(Number.isFinite) || x === undefined || y === undefined || width === undefined || height === undefined) {
    throw new CliError("--region takes four numbers: x,y,width,height (composition units, or a source clip's own pixels).", EXIT.USAGE)
  }
  return { x, y, width, height }
}

/** A comma-separated list of seconds of a source, as the API's `atSec` takes them. */
function parseSeconds(value: string): number[] {
  const seconds = value.split(',').map((v) => Number(v.trim()))
  if (seconds.length === 0 || !seconds.every((t) => Number.isFinite(t) && t >= 0)) {
    throw new CliError("--at-sec takes seconds of the source, zero or more, separated by commas.", EXIT.USAGE)
  }
  return seconds
}

/** A comma-separated list of whole frame numbers, as the API's `frames` takes them. */
function parseFrames(value: string): number[] {
  const frames = value.split(',').map((v) => Number(v.trim()))
  if (frames.length === 0 || !frames.every((f) => Number.isInteger(f) && f >= 0)) {
    throw new CliError('--frames takes whole timeline frame numbers, separated by commas.', EXIT.USAGE)
  }
  return frames
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null

/** Every image a render returned, in order: one frame or slide, frames one by one, contact sheets, or a sound's picture or its evidence sheet. */
function renderedImages(rendered: Record<string, unknown> | null): Buffer[] {
  if (!rendered) return []
  const listed = [rendered.frames, rendered.sheets].flatMap((list) =>
    Array.isArray(list) ? (list as Array<Record<string, unknown>>).map((item) => bufferFromDataUrl(item.dataUrl)) : [],
  )
  const picture = record(rendered.picture) ? bufferFromDataUrl((rendered.picture as Record<string, unknown>).dataUrl) : null
  const sheet = record(rendered.sheet) ? bufferFromDataUrl((rendered.sheet as Record<string, unknown>).dataUrl) : null
  return [bufferFromDataUrl(rendered.dataUrl), ...listed, picture, sheet].filter((b): b is Buffer => b !== null)
}

/** Every image a view returned, in order: the render and the range's sound beside it, or a source's page of keyframes or contact sheets, its evidence sheet and its sound's picture. */
function viewImages(result: ViewResult): Buffer[] {
  if ('clip' in result) {
    const clip = record(result.clip)
    const pictures = [clip?.keyframes, clip?.sheets].flatMap((list) =>
      Array.isArray(list) ? (list as Array<Record<string, unknown>>).map((item) => bufferFromDataUrl(item.dataUrl)) : [],
    )
    const sheet = record(clip?.sheet)
    return [...pictures, sheet ? bufferFromDataUrl(sheet.dataUrl) : null, ...renderedImages(record(clip?.sound))].filter((b): b is Buffer => b !== null)
  }
  const context = result.context
  return [...renderedImages(record(context?.rendered)), ...renderedImages(record(context?.renderedSound))]
}

/** A source's sound in lines: its measurement and where its sounds start, or why it could not be heard, and its audio. */
function sourceSoundLines(sound: Record<string, unknown> | null): string[] {
  const audio = sound && typeof sound.audioUrl === 'string' ? [`The audio, for a short while: ${sound.audioUrl}`] : []
  return [...describeSourceSound(sound), ...audio]
}

/** Insert `-N` before a path's extension, so multi-frame renders save as file-1.jpg, file-2.jpg, ... */
function numberedPath(base: string, i: number): string {
  const dot = base.lastIndexOf('.')
  return dot > 0 ? `${base.slice(0, dot)}-${i}${base.slice(dot)}` : `${base}-${i}`
}

/**
 * One render answer's lines, the same for the picture and the sound beside it: measurement, audio, a heard range's
 * audio map and evidence sheet, progress, failure.
 */
function renderedLines(rendered: Record<string, unknown> | null): string[] {
  if (!rendered) return []
  const sound = describeSoundMeasurement(rendered)
  const audio = typeof rendered.audioUrl === 'string' ? `The audio, until ${String(rendered.audioExpiresAt)}: ${rendered.audioUrl}` : null
  const heard = [
    ...describeAudioMap(record(rendered.audioMap) as AudioMapAnswer | null),
    ...describeEvidenceSheet(record(rendered.sheet) as EvidenceSheet | null),
  ]
  const progress = describeRenderProgress(rendered)
  const failure = describeRenderFailure(rendered)
  const warned = describeCodeWarnings(Array.isArray(rendered.warnings) ? (rendered.warnings as CodeDiagnostic[]) : null)
  return [sound, audio, ...heard, progress, failure, warned].filter((line): line is string => Boolean(line))
}

/**
 * The human summary of a view: who is viewing, what a render measured or why it has no image, a clip with its sound and
 * a post's audio map for the window and its evidence sheet, and what was saved.
 */
export function viewSummary(result: ViewResult, saved: { count: number; path: string }): string {
  const savedLine = saved.count > 0 ? [`${saved.count} image(s) saved to ${saved.path}${saved.count > 1 ? ' (-1, -2, ...)' : ''}`] : []
  // A source read is the source alone, never the live context.
  if ('clip' in result) {
    const clip = record(result.clip)
    return [
      ...describeClip(clip),
      ...sourceSoundLines(record(clip?.sound)),
      ...describeAudioMap(record(clip?.audioMap) as AudioMapAnswer | null),
      ...describeEvidenceSheet(record(clip?.sheet) as EvidenceSheet | null),
      ...savedLine,
    ].join('\n')
  }
  const c = result.context
  const rendered = record(c?.rendered)
  const renderedSound = record(c?.renderedSound)
  // A render comes back with no live tab (it works without one), so only a context with none is empty.
  if (!c || (!result.participant && !rendered && !renderedSound)) {
    return 'No live context: no one is currently viewing this in the app.'
  }
  const head = result.participant
    ? [`Live context on the ${String(c.surface)} surface (updated ${result.participant.updatedAt}).`, `${result.participants.length} live participant(s).`]
    : rendered || renderedSound
      ? ['No one is viewing this in the app right now; the render is from the saved project.']
      : []
  return [...head, ...renderedLines(rendered), ...renderedLines(renderedSound), ...savedLine].join('\n')
}

export function registerView(program: Command): void {
  program
    .command('view')
    .description('See what the user is looking at, and see or hear your own work (requires context:read)')
    .option('--project <id>', 'scope to a specific project (editor/canvas)')
    .option('--capture', "also capture a fresh screenshot of the live viewport (the user's screen; slower)")
    .option('--render', 'also render your work (images); ephemeral. Name several frames with --frames, --per-second or --count. Frames across a range are how you judge motion, timing and pacing: the closer together they are, the finer the motion they show.')
    // ⛔ NO `--mode`. The render takes no mode on any layer: `--sound` and `--video` name what else to render.
    .option('--frame <n>', 'image: which single timeline frame (omit for the current playhead)', (v) => parseInt(v, 10))
    .option('--slide <id|n>', "image (canvas): which slide id (omit for the focused slide). With --content-id: which video of a carousel post, by the slide content analyze reports for it")
    .option('--slide-index <n>', 'image (canvas): 1-based slide index (alternative to --slide)', (v) => parseInt(v, 10))
    .option('--frames <list>', 'image (editor): exactly these timeline frames, in this order, separated by commas', parseFrames)
    .option('--from-frame <n>', 'start timeline frame of the range (several frames, sound or video)', (v) => parseInt(v, 10))
    .option('--to-frame <n>', 'end timeline frame of the range', (v) => parseInt(v, 10))
    .option('--count <n>', "how many frames to spread evenly across the range, or across a source's window (omit for one at the focus point, or about one a second of a range)", (v) => parseInt(v, 10))
    .option('--per-second <n>', "how many frames to take per second of the range, up to every frame, or of a source's window", (v) => Number(v))
    .option('--layout <layout>', "'frames' returns each frame as its own image; 'sheets' tiles them into contact sheets, an edit's frames numbered and a source's labeled with its second under each tile (omit to choose by how many fit one response)")
    .option('--sound', "hear and measure sound: your edit's range mixed as an export mixes it, instead of its picture, by --from-frame and --to-frame; or a source's window as it is, by --from-sec and --to-sec, beside any frames asked for")
    .option('--video', "watch the range play with its sound, to judge motion, timing, transitions and pacing; a terminal cannot take video, so it returns frames across the range and the sound measured. Takes --from-frame and --to-frame, or a source's window")
    .option('--render-id <id>', 'read a render already started, by the renderId it returned')
    .option('--page <n>', "which page of the render, or of a source's frames, to read, starting at 1", (v) => parseInt(v, 10))
    .option('--wait <seconds>', 'how long to wait for results before answering; what is not ready is read later with --render-id', (v) => Number(v))
    .option('--width <n>', "image: the width in pixels to render at, or of a source's frames, to check legibility at the size it will be seen. Height follows the aspect ratio. The size used is reported with the result.", (v) => parseInt(v, 10))
    .option('--region <x,y,w,h>', "image: render only this rectangle, x,y,width,height in composition units (get_project's compositionSpace), to inspect detail at full resolution. Without --width, it renders at native scale. For a source, the rectangle is in its own pixels, and each of its frames is cut to it.", parseRegion)
    .option('--asset <id>', "a clip of the user's to see and hear, by its asset id, rather than your edit (or --media-url or --content-id)")
    .option('--media-url <url>', "a clip of the user's to see and hear, by its media URL, rather than your edit (or --asset or --content-id)")
    .option('--content-id <id>', "a tracked post's video to see and hear, by its id or short id, its link, or the platform's own id for it, once content analyze --kind video has downloaded it (or --asset or --media-url); --slide names a carousel's video")
    .option('--from-sec <n>', "start of a source's window, in its own seconds (omit to start at its beginning)", (v) => Number(v))
    .option('--to-sec <n>', "end of a source's window, in its own seconds (omit to run to its end)", (v) => Number(v))
    .option('--at-sec <list>', "frames at exactly these seconds of a source, such as its cut list's times, instead of spread across a window, separated by commas", parseSeconds)
    .option('--save <path>', "write the produced image(s), a render's (with a heard range's evidence sheet), or a source's keyframes, its evidence sheet and its sound's picture, to this file (several append -1, -2, ...)")
    .action(async (opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const sound = Boolean(opts.sound)
      const video = Boolean(opts.video)
      const post = opts.contentId != null
      const clip = opts.asset != null || opts.mediaUrl != null || post
      // With a post, --slide is the carousel's video slide, a 0-based order; otherwise it is a canvas slide's id.
      let postSlide: number | undefined
      if (post && opts.slide != null) {
        postSlide = Number(opts.slide)
        if (!Number.isInteger(postSlide) || postSlide < 0) {
          throw new CliError("--slide with --content-id is a carousel slide's 0-based order, as content analyze reports it.", EXIT.USAGE)
        }
      }
      // A picture flag implies a render, unless it shapes a sound, a video or a clip, which are renders of their own.
      const render =
        Boolean(opts.render) ||
        (!sound && !video && !clip &&
          (opts.frame != null || (opts.slide != null && !post) || opts.slideIndex != null ||
            opts.fromFrame != null || opts.toFrame != null || opts.width != null || opts.region != null ||
            opts.frames != null || opts.perSecond != null || opts.layout != null || opts.count != null))
      if (opts.layout != null && opts.layout !== 'frames' && opts.layout !== 'sheets') {
        throw new CliError("--layout takes 'frames' or 'sheets'.", EXIT.USAGE)
      }
      const reading = opts.renderId != null
      const renders = render || sound || video || reading
      // --save needs an image; imply --capture only when nothing else produces one.
      const capture = Boolean(opts.capture) || (Boolean(opts.save) && !renders && !clip)
      const result = await client.view({
        projectId: opts.project as string | undefined,
        capture,
        // A render read by its id is a render too; the request names which.
        render: (render && !reading) || undefined,
        frame: opts.frame as number | undefined,
        slideId: post ? undefined : (opts.slide as string | undefined),
        slideIndex: opts.slideIndex as number | undefined,
        frames: opts.frames as number[] | undefined,
        fromFrame: opts.fromFrame as number | undefined,
        toFrame: opts.toFrame as number | undefined,
        count: opts.count as number | undefined,
        perSecond: opts.perSecond as number | undefined,
        layout: opts.layout as 'frames' | 'sheets' | undefined,
        sound: sound || undefined,
        video: video || undefined,
        renderId: opts.renderId as string | undefined,
        page: opts.page as number | undefined,
        wait: opts.wait as number | undefined,
        width: opts.width as number | undefined,
        region: opts.region as CompositionRegion | undefined,
        assetId: opts.asset as string | undefined,
        mediaUrl: opts.mediaUrl as string | undefined,
        contentId: opts.contentId as string | undefined,
        slide: postSlide,
        fromSec: opts.fromSec as number | undefined,
        toSec: opts.toSec as number | undefined,
        atSec: opts.atSec as number[] | undefined,
      })

      const c = 'clip' in result ? null : result.context
      const rendered = record(c?.rendered)
      const failure = describeRenderFailure(rendered) ?? describeRenderFailure(record(c?.renderedSound))
      let savedCount = 0
      if (opts.save) {
        const images = viewImages(result)
        if (images.length > 1) {
          images.forEach((buf, i) => {
            writeFileSync(numberedPath(opts.save as string, i + 1), buf)
            savedCount++
          })
        } else if (images.length === 1) {
          writeFileSync(opts.save as string, images[0] as Buffer)
          savedCount = 1
        } else if (renders && rendered?.state === 'rendering') {
          // Still rendering: the summary says how to read it, and there is nothing to save yet.
        } else if (renders && failure) {
          // The render was asked for and said why it has no image: that is the answer, not a missing snapshot.
          throw new CliError(failure, EXIT.GENERAL)
        } else if (clip) {
          // A source with no keyframes and no sound picture: the summary says why, and there is nothing to save.
        } else {
          const url = typeof c?.snapshotUrl === 'string' ? c.snapshotUrl : null
          if (!url) throw new CliError('No image available for the current context (try --render or --capture).', EXIT.USAGE)
          const res = await fetch(url)
          if (!res.ok) throw new CliError(`Failed to download snapshot (HTTP ${res.status}).`, EXIT.GENERAL)
          writeFileSync(opts.save as string, Buffer.from(await res.arrayBuffer()))
          savedCount = 1
        }
      }

      emit(result, ctx, () => viewSummary(result, { count: savedCount, path: String(opts.save) }))
    })
}
