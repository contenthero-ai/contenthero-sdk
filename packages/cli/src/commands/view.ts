/**
 * `contenthero view` - see what the user is looking at, and see or hear your own work. The CLI twin of the MCP's
 * `view`.
 *
 *   view [--project <id>] [--capture] [--render] [--frame <n>] [--slide <id>] [--slide-index <n>]
 *        [--frames <list>] [--from-frame <n>] [--to-frame <n>] [--count <n>] [--per-second <n>]
 *        [--layout <frames|sheets>] [--sound] [--video] [--render-id <id>] [--page <n>] [--wait <seconds>]
 *        [--width <n>] [--region <x,y,w,h>] [--asset <id> | --media-url <url>] [--from-sec <n>] [--to-sec <n>]
 *        [--save <path>]
 *
 * Returns the most-recent-active session's surface + focus + selection, plus the live participant set.
 * Structured by default. `--capture` pings the live tab for a fresh viewport screenshot (the user's SCREEN).
 * `--render` renders the COMPOSED OUTPUT (the editor frames / canvas slide), ephemeral and stored nowhere;
 * `--sound` renders and measures a range's mix instead, and `--video` watches a range play: a terminal cannot take
 * video, so it comes back as the range's frames and its sound measured. A render is a job: what is not ready within
 * `--wait` is read with `--render-id` and `--page`. `--asset` or `--media-url` names a raw source clip instead, windowed
 * by `--from-sec` and `--to-sec`, and it comes back as keyframes. `--width` and `--region` say what the MCP's `view`
 * fields say (copied by hand until one source holds every field's description). `--save` writes whichever images
 * were produced (render preferred over snapshot: frames, contact sheets, a sound's picture, or a clip's keyframes) to
 * files.
 */
import { writeFileSync } from 'node:fs'
import type { Command } from 'commander'
import type { CompositionRegion, ViewResult } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit } from '../output.js'
import { CliError, EXIT } from '../errors.js'
import {
  describeClip,
  describeCodeWarnings,
  describeRenderFailure,
  describeRenderProgress,
  describeSoundMeasurement,
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

/** Every image a render returned, in order: one frame or slide, frames one by one, contact sheets, or a sound's picture. */
function renderedImages(rendered: Record<string, unknown> | null): Buffer[] {
  if (!rendered) return []
  const listed = [rendered.frames, rendered.sheets].flatMap((list) =>
    Array.isArray(list) ? (list as Array<Record<string, unknown>>).map((item) => bufferFromDataUrl(item.dataUrl)) : [],
  )
  const picture = record(rendered.picture) ? bufferFromDataUrl((rendered.picture as Record<string, unknown>).dataUrl) : null
  return [bufferFromDataUrl(rendered.dataUrl), ...listed, picture].filter((b): b is Buffer => b !== null)
}

/** Every image a view returned, in order: the render, the range's sound beside it, then a clip's keyframes. */
function viewImages(context: Record<string, unknown> | null): Buffer[] {
  const clip = record(context?.clip)
  const keyframes = Array.isArray(clip?.keyframes)
    ? (clip.keyframes as Array<Record<string, unknown>>).map((kf) => bufferFromDataUrl(kf.dataUrl)).filter((b): b is Buffer => b !== null)
    : []
  return [...renderedImages(record(context?.rendered)), ...renderedImages(record(context?.renderedSound)), ...keyframes]
}

/** Insert `-N` before a path's extension, so multi-frame renders save as file-1.jpg, file-2.jpg, ... */
function numberedPath(base: string, i: number): string {
  const dot = base.lastIndexOf('.')
  return dot > 0 ? `${base.slice(0, dot)}-${i}${base.slice(dot)}` : `${base}-${i}`
}

/** One render answer's lines, the same for the picture and the sound beside it: measurement, audio, progress, failure. */
function renderedLines(rendered: Record<string, unknown> | null): string[] {
  if (!rendered) return []
  const sound = describeSoundMeasurement(rendered)
  const audio = typeof rendered.audioUrl === 'string' ? `The audio, until ${String(rendered.audioExpiresAt)}: ${rendered.audioUrl}` : null
  const progress = describeRenderProgress(rendered)
  const failure = describeRenderFailure(rendered)
  const warned = describeCodeWarnings(Array.isArray(rendered.warnings) ? (rendered.warnings as CodeDiagnostic[]) : null)
  return [sound, audio, progress, failure, warned].filter((line): line is string => Boolean(line))
}

/** The human summary of a view: who is viewing, what a render measured or why it has no image, a clip, and what was saved. */
export function viewSummary(result: ViewResult, saved: { count: number; path: string }): string {
  const c = result.context
  const rendered = record(c?.rendered)
  const renderedSound = record(c?.renderedSound)
  const clip = record(c?.clip)
  // A render or a clip comes back with no live tab (each works without one), so only a context with none is empty.
  if (!c || (!result.participant && !rendered && !renderedSound && !clip)) {
    return 'No live context: no one is currently viewing this in the app.'
  }
  const head = result.participant
    ? [`Live context on the ${String(c.surface)} surface (updated ${result.participant.updatedAt}).`, `${result.participants.length} live participant(s).`]
    : rendered || renderedSound
      ? ['No one is viewing this in the app right now; the render is from the saved project.']
      : []
  const savedLine = saved.count > 0 ? [`${saved.count} image(s) saved to ${saved.path}${saved.count > 1 ? ' (-1, -2, ...)' : ''}`] : []
  return [...head, ...renderedLines(rendered), ...renderedLines(renderedSound), ...describeClip(clip), ...savedLine].join('\n')
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
    .option('--slide <id>', 'image (canvas): which slide id (omit for the focused slide)')
    .option('--slide-index <n>', 'image (canvas): 1-based slide index (alternative to --slide)', (v) => parseInt(v, 10))
    .option('--frames <list>', 'image (editor): exactly these timeline frames, in this order, separated by commas', parseFrames)
    .option('--from-frame <n>', 'start timeline frame of the range (several frames, sound or video)', (v) => parseInt(v, 10))
    .option('--to-frame <n>', 'end timeline frame of the range', (v) => parseInt(v, 10))
    .option('--count <n>', "how many frames to spread evenly across the range, or across a clip's window (omit for one at the focus point)", (v) => parseInt(v, 10))
    .option('--per-second <n>', 'how many frames to take per second of the range, up to every frame', (v) => Number(v))
    .option('--layout <layout>', "'frames' returns each frame as its own image; 'sheets' tiles them into contact sheets, each frame numbered under its tile (omit to choose by how many fit one response)")
    .option('--sound', "render the range's sound instead of its picture, mixed as an export mixes it, and measure it")
    .option('--video', "watch the range play with its sound, to judge motion, timing, transitions and pacing; a terminal cannot take video, so it returns frames across the range and the sound measured. Takes --from-frame and --to-frame, or a clip's window")
    .option('--render-id <id>', 'read a render already started, by the renderId it returned')
    .option('--page <n>', 'which page of the render to read, starting at 1', (v) => parseInt(v, 10))
    .option('--wait <seconds>', 'how long to wait for results before answering; what is not ready is read later with --render-id', (v) => Number(v))
    .option('--width <n>', "image: the width in pixels to render at, or of a clip's frames, to check legibility at the size it will be seen. Height follows the aspect ratio. The size used is reported with the result.", (v) => parseInt(v, 10))
    .option('--region <x,y,w,h>', "image: render only this rectangle, in composition units (get_project's compositionSpace), to inspect detail at full resolution. Without --width, it renders at native scale; rendered reports pixelsPerCompositionUnit. For a source clip, the rectangle is in the clip's own pixels, and each of its frames is cut to it.", parseRegion)
    .option('--asset <id>', 'a raw source clip to see, by its asset id, rather than your edit (or --media-url)')
    .option('--media-url <url>', 'a raw source clip to see, by its media URL, rather than your edit (or --asset)')
    .option('--from-sec <n>', "start of the clip's window, in its own seconds (omit to start at its beginning)", (v) => Number(v))
    .option('--to-sec <n>', "end of the clip's window, in its own seconds (omit to run to its end)", (v) => Number(v))
    .option('--save <path>', "write the produced image(s), a render's or a clip's keyframes, to this file (several append -1, -2, ...)")
    .action(async (opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const sound = Boolean(opts.sound)
      const video = Boolean(opts.video)
      const clip = opts.asset != null || opts.mediaUrl != null
      // A picture flag implies a render, unless it shapes a sound, a video or a clip, which are renders of their own.
      const render =
        Boolean(opts.render) ||
        (!sound && !video && !clip &&
          (opts.frame != null || opts.slide != null || opts.slideIndex != null ||
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
        slideId: opts.slide as string | undefined,
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
        fromSec: opts.fromSec as number | undefined,
        toSec: opts.toSec as number | undefined,
      })

      const c = result.context as Record<string, unknown> | null
      const rendered = record(c?.rendered)
      const failure = describeRenderFailure(rendered) ?? describeRenderFailure(record(c?.renderedSound))
      let savedCount = 0
      if (opts.save) {
        const images = viewImages(c)
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
          // A clip with no keyframes: the summary says why, and there is nothing to save.
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
