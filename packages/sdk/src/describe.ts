import type { ApplyEditorOpsResult, Charge, CodeDiagnostic, EditorOpResult, ExportLoudness, GenerationReference, Loudness, MediaShare, ProjectReadScope, ProjectShare, ResolvedMediaBatchItem } from './types.js'
import type { LimitError } from './errors.js'

/**
 * The words every ContentHero surface uses for what a paid call cost and for a limit refusal, so the MCP and the CLI
 * say the same thing (one wording, not a copy each that drifts).
 */

const credits = (n: number) => `${n.toLocaleString('en-US')} credit${n === 1 ? '' : 's'}`

/**
 * What a paid call cost, labeled (approved 2026-09-30): the cost once charged, or the estimate while the work runs
 * (nothing is charged until it finishes, and only for what succeeds). Null when there is no receipt (an older server,
 * or a call that is not charged).
 *
 *   { label: 'Cost', text: '7 credits charged. Balance after: 93 credits.' }
 *   { label: 'Estimated cost', text: '120 credits, charged when it finishes (only for what succeeds).' }
 *   { label: 'Cost', text: 'Nothing was charged.' }
 */
export function describeCharge(charge: Charge | null | undefined): { label: 'Cost' | 'Estimated cost'; text: string } | null {
  if (!charge) return null
  if (charge.state === 'pending') {
    return { label: 'Estimated cost', text: `${credits(charge.held)}, charged when it finishes (only for what succeeds).` }
  }
  if (charge.state === 'free') return { label: 'Cost', text: 'Nothing was charged.' }
  const after = charge.balanceAfter != null ? ` Balance after: ${credits(charge.balanceAfter)}.` : ''
  return { label: 'Cost', text: `${credits(charge.credits)} charged.${after}` }
}

/**
 * What a generation was made FROM, one line per input ("Reference 1 (image): <url>"), so the MCP and the CLI list a
 * generation's inputs in the same words Studio labels them with. Empty when it had none or the server did not say.
 */
export function describeReferences(references: readonly GenerationReference[] | null | undefined): string[] {
  return (references ?? []).map((r) => `${r.label} (${r.type}): ${r.url}`)
}

/** The same, as one line ("Cost: 7 credits charged. ..."). */
export function chargeSentence(charge: Charge | null | undefined): string | null {
  const d = describeCharge(charge)
  return d ? `${d.label}: ${d.text}` : null
}

/** Credits set aside for work still running, for a balance (approved 2026-09-30). */
export function describeReserved(held: number): string {
  return `${credits(held)} reserved for work in progress`
}

/**
 * A limit refusal for a person: its message as written, then the ways to continue in the order to offer them.
 * Nothing ran and nothing was charged.
 */
export function describeLimit(err: LimitError): string {
  const ways = err.actions.map((a) => `- ${a.label}: ${a.url}`)
  return [err.message, ...(ways.length ? ['Ways to continue:', ...ways] : [])].join('\n')
}

/**
 * Why a view render produced no image, or some frames of a range, in words: the API's `rendered.error` and
 * `rendered.missingFrames`. Null when the render reported no error. An error the summary does not state reads as a
 * render that simply came back empty, which is what agents saw during the 2026-10-01 export outage.
 */
export function describeRenderFailure(rendered: Record<string, unknown> | null | undefined): string | null {
  if (!rendered) return null
  const error = rendered.error
  if (!error || typeof error !== 'object' || Array.isArray(error)) return null
  const { code, message } = error as { code?: unknown; message?: unknown }
  const why = `${typeof code === 'string' ? code : 'render_failed'}${typeof message === 'string' && message ? `: ${message}` : ''}`
  const missing = Array.isArray(rendered.missingFrames) ? (rendered.missingFrames as unknown[]) : []
  if (missing.length > 0) {
    return `${missing.length} ${missing.length === 1 ? 'frame' : 'frames'} could not be rendered (frames ${missing.join(', ')}). ${why}`
  }
  if (rendered.kind === 'sound') return `The sound could not be rendered. ${why}`
  return `The render produced no image. ${why}`
}

/**
 * Where a view render job stands, in words: still rendering (how much is ready, and the id to read the rest
 * with), or done across several pages (which page this is). Null for a render that came back whole on one page, or
 * that is not a job. Without it, a render that outlasted its wait reads as a render that returned nothing.
 */
export function describeRenderProgress(rendered: Record<string, unknown> | null | undefined): string | null {
  if (!rendered || typeof rendered.renderId !== 'string') return null
  const id = rendered.renderId
  const pages = typeof rendered.pages === 'number' ? rendered.pages : 1
  const page = typeof rendered.page === 'number' ? rendered.page : 1
  if (rendered.state === 'rendering') {
    if (rendered.kind === 'sound') return `The sound is still rendering. Read it with renderId ${id}.`
    const ready = Array.isArray(rendered.readyPages) ? (rendered.readyPages as unknown[]) : []
    const drawn = typeof rendered.renderedFrameCount === 'number' ? rendered.renderedFrameCount : 0
    const total = typeof rendered.frameCount === 'number' ? rendered.frameCount : null
    const progress = total !== null ? `${drawn} of ${total} frames are drawn` : 'Frames are still drawing'
    const readyText = ready.length ? `; ready: ${ready.length === 1 ? 'page' : 'pages'} ${ready.join(', ')} of ${pages}` : ''
    return `Still rendering: ${progress}${readyText}. Read the rest with renderId ${id} and a page number.`
  }
  if (pages > 1) return `Page ${page} of ${pages}. Read another page with renderId ${id} and its page number.`
  return null
}

/**
 * A region cut from a file, in words: what was cut and how its pixels map back to the file, so a point can be placed on
 * the source, or why it could not be cut. Null when no region was asked for. The one wording for an image get_media
 * zoomed and for a clip view cut.
 */
export function describeCrop(
  crop: ResolvedMediaBatchItem['crop'] | null,
  cropError: string | null | undefined,
): string | null {
  if (crop) {
    return `zoom: ${crop.region.width}x${crop.region.height} at (${crop.region.x}, ${crop.region.y}) in the file's pixels, shown at ${crop.width}x${crop.height} (${crop.pixelsPerSourcePixel} px per file px)`
  }
  return cropError ? `zoom not shown: ${cropError}` : null
}

/**
 * A raw source clip a view read (`context.clip`), in words: what it is, how long, which window was read and its url,
 * the region each frame was cut to, then why its keyframes, the region or the clip itself could not be read. Empty for
 * no clip. The keyframes themselves are images, so each surface says how it shows them.
 */
export function describeClip(clip: Record<string, unknown> | null | undefined): string[] {
  if (!clip) return []
  const from = typeof clip.fromSec === 'number' ? clip.fromSec : null
  const to = typeof clip.toSec === 'number' ? clip.toSec : null
  const window = from !== null || to !== null ? `, from ${from ?? 0}s to ${to !== null ? `${to}s` : 'its end'}` : ''
  const length = typeof clip.durationSeconds === 'number' ? ` (${clip.durationSeconds.toFixed(2)}s long)` : ''
  const lines = [`Raw source clip${typeof clip.type === 'string' ? ` (${clip.type})` : ''}${length}${window}: ${String(clip.url ?? '')}`]
  const crop = clip.crop && typeof clip.crop === 'object' && !Array.isArray(clip.crop) ? (clip.crop as ResolvedMediaBatchItem['crop']) : null
  const zoom = describeCrop(crop, typeof clip.cropError === 'string' ? clip.cropError : null)
  if (zoom) lines.push(`${zoom[0]!.toUpperCase()}${zoom.slice(1)}`)
  if (typeof clip.keyframeError === 'string' && clip.keyframeError) lines.push(`Keyframes not shown: ${clip.keyframeError}`)
  const error = clip.error
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const { code, message } = error as { code?: unknown; message?: unknown }
    lines.push(`The clip could not be read. ${typeof code === 'string' ? code : 'clip_failed'}${typeof message === 'string' && message ? `: ${message}` : ''}`)
  }
  return lines
}

/** One measure's value with its unit, or that there was nothing to measure. */
const measured = (value: unknown, unit: string) => (typeof value === 'number' ? `${value} ${unit}` : 'nothing measurable')

/**
 * A sound render's measurement in one paragraph, for a person reading a summary: loudness, peaks, range, how many
 * sounds start in it, and its stereo width. Null for a render that is not a finished sound. Every value is also in the
 * render's own fields.
 */
export function describeSoundMeasurement(rendered: Record<string, unknown> | null | undefined): string | null {
  if (!rendered || rendered.kind !== 'sound' || rendered.state !== 'done') return null
  const loudness = (rendered.loudness ?? {}) as Record<string, unknown>
  const onsets = Array.isArray(rendered.onsets) ? rendered.onsets.length : 0
  const stereo = rendered.stereo as { sideToMid?: unknown; correlation?: unknown } | null | undefined
  const width = stereo
    ? ` Stereo: side to mid ${typeof stereo.sideToMid === 'number' ? stereo.sideToMid : 'not measurable (no mid)'}, correlation ${typeof stereo.correlation === 'number' ? stereo.correlation : 'not measurable'}.`
    : ' Mono.'
  return (
    `Integrated loudness ${measured(loudness.integratedLufs, 'LUFS')}, true peak ${measured(loudness.truePeakDbtp, 'dBTP')}, ` +
    `loudness range ${measured(loudness.loudnessRangeLu, 'LU')}, sample peak ${measured(loudness.samplePeakDbfs, 'dBFS')}. ` +
    `${onsets} ${onsets === 1 ? 'sound starts' : 'sounds start'} in it.${width}`
  )
}

/**
 * What a scoped project read contains, in one sentence: its timeline window and track, or its slide
 * (`ProjectDetail.scope`). A full read of one beat looks exactly like a full read of a short timeline, and writing it
 * back as the whole would drop everything outside the window, so a scoped read says so in words.
 */
export function describeScope(scope: ProjectReadScope): string {
  const parts: string[] = []
  if (scope.fromFrame !== undefined || scope.toFrame !== undefined) {
    parts.push(`frames ${scope.fromFrame ?? 'start'} to ${scope.toFrame ?? 'end'}`)
  }
  if (scope.trackId) parts.push(`track ${scope.trackId}`)
  if (scope.slideId) parts.push(`slide ${scope.slideId}`)
  return `Scoped read (${parts.join(', ')}): the state is that part of the project, not all of it.`
}

/**
 * EXPOSURE GUARD for EditorOpResult. A surface prints only what this function writes, so a field it skips is invisible
 * to the agent or the person reading it, while every build and test stays green. `satisfies` makes each skipped field
 * a decision tsc checks. `diagnostics` would otherwise have arrived exactly that way.
 */
const EDITOR_OP_RESULT_EXPOSURE = {
  op: 'rendered (on a failure)',
  ok: 'rendered (the applied count, and the failure list)',
  error: 'rendered',
  warnings: 'rendered',
  createdIds: 'rendered',
  generatingOutputId: 'rendered',
  diagnostics: 'rendered',
  opId: 'omitted: the SDK mints it per call, and nothing the reader does next takes it',
} satisfies Record<keyof EditorOpResult, string>
void EDITOR_OP_RESULT_EXPOSURE

/**
 * One compiler finding about a clip's code, printed the way a compiler prints one: where, what, then the author's line
 * with a caret under the column (approved message 27, 2026-10-05). The line is printed without its indentation, and
 * the caret moves with it; a column past the end of what was sent gets no caret.
 */
function codeDiagnosticLines(d: CodeDiagnostic): string[] {
  const where = d.line != null ? `, line ${d.line}${d.column != null ? `, column ${d.column}` : ''}` : ''
  const head = `  - code in ${d.itemId}${where}: ${d.severity} (${d.code}): ${d.message}`
  if (!d.snippet || d.line == null) return [head]
  const code = d.snippet.trimStart()
  const gutter = `      ${d.line} | `
  const at = d.column != null ? d.column - 1 - (d.snippet.length - code.length) : -1
  if (at < 0 || at > code.length) return [head, `${gutter}${code}`]
  // Under each character before the column, a space, or a tab where the line has one, so the caret lines up.
  const pad = code.slice(0, at).replace(/[^\t]/g, ' ')
  return [head, `${gutter}${code}`, `${' '.repeat(gutter.length - 2)}| ${pad}^`]
}

/**
 * What the code warned about in a render or an export, in the words an op result uses for a finding. A warning
 * stopped nothing: the code drew, though perhaps not as its author meant. Null when there are none.
 */
export function describeCodeWarnings(warnings: readonly CodeDiagnostic[] | null | undefined): string | null {
  if (!warnings?.length) return null
  return ['Code warnings:', ...warnings.flatMap(codeDiagnosticLines)].join('\n')
}

/** A result's text, then what the code warned about, when anything did. */
export function withCodeWarnings(prose: string, warnings: readonly CodeDiagnostic[] | null | undefined): string {
  const warned = describeCodeWarnings(warnings)
  return warned ? `${prose}\n${warned}` : prose
}

/**
 * An applyEditorOps batch, for the MCP's tool result and the CLI's output alike: what applied, the new revision, what
 * was created, jobs to poll, each failure with its reason, warnings, and every compiler finding with its line
 * (the error on refused code names only the first, and a warning on code that applied appears nowhere else).
 */
export function describeEditorOps(r: ApplyEditorOpsResult): string {
  const okCount = r.results.filter((x) => x.ok).length
  const failures = r.results.filter((x) => !x.ok)
  const created = r.results.flatMap((x) => x.createdIds ?? [])
  // A batch applies whole or not at all (the server's rule since 2026-10-09), so any failure means nothing was stored.
  // Draft wording, for Taylan's review.
  const lines = [
    failures.length
      ? `Nothing was applied: a batch applies whole or not at all. Revision ${r.revision}, unchanged.`
      : `Applied ${okCount}/${r.results.length} op(s). New revision: ${r.revision}.`,
  ]
  if (created.length) lines.push(`Created: ${created.join(', ')}.`)
  // Async effect ops (remove_background) dispatch a job and return its outputId; name it so the reader can poll.
  const generating = r.results.map((x) => x.generatingOutputId).filter((id): id is string => !!id)
  if (generating.length) {
    lines.push(`Dispatched ${generating.length} async job(s); get_status on: ${generating.join(', ')}.`)
  }
  if (failures.length) {
    lines.push('Failed ops:')
    for (const f of failures) lines.push(`  - ${f.op}: ${f.error ?? 'unknown error'}`)
  }
  const warnings = r.results.flatMap((x) => x.warnings ?? [])
  // Each warning is a sentence of its own; joined, its closing period is the line's, so none is doubled.
  if (warnings.length) lines.push(`Warnings: ${warnings.map((w) => w.trim().replace(/\.+$/, '')).join('; ')}.`)
  const diagnostics = r.results.flatMap((x) => x.diagnostics ?? [])
  if (diagnostics.length) {
    lines.push('Code:')
    for (const d of diagnostics) lines.push(...codeDiagnosticLines(d))
  }
  return lines.join('\n')
}

/** A project's live link after `share`: where anyone sees it, or that its old link is dead. */
export function describeProjectShare(share: ProjectShare): string {
  return share.shared && share.shareUrl
    ? `Shared. Anyone with this link sees the project as it is now: ${share.shareUrl}`
    : 'Not shared. A link made before no longer opens it.'
}

/** A project's live link as a read reports it, or null when it is not shared. */
export function describeProjectShareLink(shareUrl: string | null | undefined): string | null {
  return shareUrl ? `Shared at ${shareUrl} (anyone with the link sees the project as it is now).` : null
}

/** An export's public share page, or null before the export completes. */
export function describeExportShareLink(shareUrl: string | null | undefined): string | null {
  return shareUrl ? `Share page: ${shareUrl}` : null
}

/** A delivery loudness as a setting reads: its target in LUFS, or off. */
export function describeLoudness(loudness: Loudness): string {
  return loudness === 'off' ? 'off' : `${loudness} LUFS`
}

/** How an export's loudness came out, as the one line the app shows people, or null when there is none to show. */
export function describeExportLoudness(loudness: ExportLoudness | null | undefined): string | null {
  return loudness?.summary || null
}

/** An export's text, then how its loudness came out, when there is a line to show. */
export function withExportLoudness(prose: string, loudness: ExportLoudness | null | undefined): string {
  const line = describeExportLoudness(loudness)
  return line ? `${prose}\n${line}` : prose
}

/** Media shared as one link: the page, and any media named that it leaves out. */
export function describeMediaShare(share: MediaShare, asked: readonly string[]): string {
  if (!share.shared) return 'Stopped sharing. The link no longer opens.'
  const left = asked.filter((id) => !share.mediaIds.includes(id))
  return left.length
    ? `Shared ${share.mediaIds.length} of ${asked.length} media: ${share.shareUrl}\nLeft out, as they cannot be shared: ${left.join(', ')}.`
    : `Shared: ${share.shareUrl}`
}

/** A file size as the app shows one: binary units, one decimal above KB. */
export function describeFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
