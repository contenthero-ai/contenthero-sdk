/**
 * `contenthero context` - read the LIVE context of what the user is currently viewing in the open app.
 *
 *   context [--project <id>] [--capture] [--render] [--frame <n>] [--slide <id>] [--slide-index <n>] [--save <path>]
 *
 * Returns the most-recent-active session's surface + focus + selection, plus the live participant set.
 * Structured by default. `--capture` pings the live tab for a fresh viewport screenshot (the user's SCREEN).
 * `--render` returns a server-side render of the COMPOSED OUTPUT (the editor frame / canvas slide) inline,
 * ephemeral and stored nowhere; `--frame` / `--slide` / `--slide-index` target a specific point. `--save`
 * writes whichever image was produced (render preferred over snapshot) to a file.
 */
import { writeFileSync } from 'node:fs'
import type { Command } from 'commander'
import { makeClient } from '../context.js'
import { emit } from '../output.js'
import { CliError, EXIT } from '../errors.js'

/** Split a `data:<mime>;base64,<data>` URL into a Buffer. Returns null on any non-data-URL. */
function bufferFromDataUrl(dataUrl: unknown): Buffer | null {
  if (typeof dataUrl !== 'string') return null
  const m = /^data:[^;]+;base64,(.+)$/s.exec(dataUrl)
  const b64 = m?.[1]
  return b64 ? Buffer.from(b64, 'base64') : null
}

/** Insert `-N` before a path's extension, so filmstrip/clip frames save as file-1.jpg, file-2.jpg, ... */
function numberedPath(base: string, i: number): string {
  const dot = base.lastIndexOf('.')
  return dot > 0 ? `${base.slice(0, dot)}-${i}${base.slice(dot)}` : `${base}-${i}`
}

export function registerContext(program: Command): void {
  program
    .command('context')
    .description('Read what the user is currently viewing in the open app (requires context:read)')
    .option('--project <id>', 'scope to a specific project (editor/canvas)')
    .option('--capture', "also capture a fresh screenshot of the live viewport (the user's screen; slower)")
    .option('--render', 'also render your work inline; ephemeral. Use --mode filmstrip for several frames')
    .option('--mode <mode>', "render tier: still (default) | filmstrip")
    .option('--frame <n>', 'still (editor): which timeline frame (omit for the current playhead)', (v) => parseInt(v, 10))
    .option('--slide <id>', 'still (canvas): which slide id (omit for the focused slide)')
    .option('--slide-index <n>', 'still (canvas): 1-based slide index (alternative to --slide)', (v) => parseInt(v, 10))
    .option('--from-frame <n>', 'filmstrip: start timeline frame of the range', (v) => parseInt(v, 10))
    .option('--to-frame <n>', 'filmstrip: end timeline frame of the range', (v) => parseInt(v, 10))
    .option('--count <n>', 'filmstrip: how many frames', (v) => parseInt(v, 10))
    .option('--save <path>', 'write the produced image(s) to this file (filmstrip appends -1, -2, ...)')
    .action(async (opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const render =
        Boolean(opts.render) || opts.mode != null || opts.frame != null || opts.slide != null || opts.slideIndex != null ||
        opts.fromFrame != null || opts.toFrame != null
      // --save needs an image; imply --capture only when the user did not ask for a render.
      const capture = Boolean(opts.capture) || (Boolean(opts.save) && !render)
      const result = await client.getContext({
        projectId: opts.project as string | undefined,
        capture,
        render: render || undefined,
        mode: opts.mode as 'still' | 'filmstrip' | undefined,
        frame: opts.frame as number | undefined,
        slideId: opts.slide as string | undefined,
        slideIndex: opts.slideIndex as number | undefined,
        fromFrame: opts.fromFrame as number | undefined,
        toFrame: opts.toFrame as number | undefined,
        count: opts.count as number | undefined,
      })

      let savedCount = 0
      if (opts.save) {
        const c = result.context as Record<string, unknown> | null
        const rendered = (c?.rendered ?? null) as Record<string, unknown> | null
        const frames = rendered && Array.isArray(rendered.frames) ? (rendered.frames as Array<Record<string, unknown>>) : null
        const single = rendered ? bufferFromDataUrl(rendered.dataUrl) : null
        if (frames && frames.length > 0) {
          frames.forEach((f, i) => {
            const buf = bufferFromDataUrl(f.dataUrl)
            if (buf) { writeFileSync(numberedPath(opts.save as string, i + 1), buf); savedCount++ }
          })
        } else if (single) {
          writeFileSync(opts.save as string, single)
          savedCount = 1
        } else {
          const url = typeof c?.snapshotUrl === 'string' ? c.snapshotUrl : null
          if (!url) throw new CliError('No image available for the current context (try --render or --capture).', EXIT.USAGE)
          const res = await fetch(url)
          if (!res.ok) throw new CliError(`Failed to download snapshot (HTTP ${res.status}).`, EXIT.GENERAL)
          writeFileSync(opts.save as string, Buffer.from(await res.arrayBuffer()))
          savedCount = 1
        }
      }

      emit(result, ctx, () => {
        if (!result.context || !result.participant) return 'No live context: no one is currently viewing this in the app.'
        const c = result.context as Record<string, unknown>
        const saved = savedCount > 0 ? `\n${savedCount} image(s) saved to ${String(opts.save)}${savedCount > 1 ? ' (-1, -2, ...)' : ''}` : ''
        return (
          `Live context on the ${String(c.surface)} surface (updated ${result.participant.updatedAt}).\n` +
          `${result.participants.length} live participant(s).` +
          saved
        )
      })
    })

  program
    .command('preview')
    .description('Render a short composed video of an editor range (ephemeral preview), polling until ready')
    .requiredOption('--project <id>', 'the editor project to preview')
    .option('--from-frame <n>', 'start timeline frame of the range', (v) => parseInt(v, 10))
    .option('--to-frame <n>', 'end timeline frame of the range', (v) => parseInt(v, 10))
    .option('--save <path>', 'download the finished mp4 to this file')
    .option('--timeout <sec>', 'max seconds to wait for the render (default 120)', (v) => parseInt(v, 10))
    .action(async (opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const job = await client.createPreview({
        projectId: opts.project as string,
        fromFrame: opts.fromFrame as number | undefined,
        toFrame: opts.toFrame as number | undefined,
      })
      const deadline = Date.now() + (Number(opts.timeout) || 120) * 1000
      let status = await client.getPreview(job)
      while (status.status === 'rendering' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000))
        status = await client.getPreview(job)
      }
      if (status.status === 'done' && status.url && opts.save) {
        const res = await fetch(status.url)
        if (!res.ok) throw new CliError(`Failed to download the preview (HTTP ${res.status}).`, EXIT.GENERAL)
        writeFileSync(opts.save as string, Buffer.from(await res.arrayBuffer()))
      }
      emit(status, ctx, () => {
        if (status.status === 'done') return `Preview video ready: ${status.url}${opts.save ? `\nSaved to ${String(opts.save)}` : ''}`
        if (status.status === 'failed') return `Preview render failed: ${status.error ?? 'unknown error'}`
        return `Still rendering after the timeout; poll again with renderId "${job.renderId}", bucketName "${job.bucketName}".`
      })
    })
}
