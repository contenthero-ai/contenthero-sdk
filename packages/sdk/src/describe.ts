import type { AccountIdNotFound, PlanLimitRefusal, ApplyEditorOpsResult, AudioMapAnswer, AudioMapSound, AudioMapSummary, AudioMapWindow, EvidenceSheet, Charge, CodeDiagnostic, ContentAnalysisCostEstimate, ContentVideo, ContentVideoCuts, ContentVideos, DocumentFinding, EditorOpResult, ExportLoudness, GenerationReference, JobKind, Loudness, MediaShare, ProjectReadScope, ProjectShare, ResolvedMediaBatchItem, TranscribeCostEstimate, Transcription } from './types.js'
import { statusTarget } from './types.js'
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

/**
 * A model's input limits, one line per limit it declares (`capabilities.inputLimits`), so the MCP's get_model and the
 * CLI's `model get` state them in the same words (approved 2026-10-11). Empty when the model declares none. The numbers
 * are the registry's; only the words live here.
 */
export function describeInputLimits(capabilities: Record<string, unknown> | null | undefined): string[] {
  const l = (capabilities?.inputLimits ?? {}) as Record<string, number | undefined>
  const out: string[] = []
  if (l.imageMaxMB != null) out.push(`image files: up to ${l.imageMaxMB} MB each`)
  if (l.videoMaxMB != null) out.push(`video files: up to ${l.videoMaxMB} MB each`)
  if (l.videoMaxDurationSec != null) out.push(`input video: up to ${l.videoMaxDurationSec}s`)
  if (l.videoTrimMaxSec != null) out.push(`input video: the first ${l.videoTrimMaxSec}s are used`)
  if (l.audioMinDurationSec != null && l.audioMaxDurationSec != null) {
    out.push(`audio references: each ${l.audioMinDurationSec} to ${l.audioMaxDurationSec}s`)
  } else if (l.audioMinDurationSec != null) {
    out.push(`audio references: each at least ${l.audioMinDurationSec}s`)
  } else if (l.audioMaxDurationSec != null) {
    out.push(`audio references: each up to ${l.audioMaxDurationSec}s`)
  }
  if (l.audioTotalMaxSec != null) out.push(`audio references: up to ${l.audioTotalMaxSec}s together`)
  if (l.videoTotalMaxSec != null) out.push(`video references: up to ${l.videoTotalMaxSec}s together`)
  if (l.videoPlusOutputMaxSec != null) out.push(`video references plus output: up to ${l.videoPlusOutputMaxSec}s together`)
  return out
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
 * Nothing ran and nothing was charged. Takes a thrown `LimitError`, or a refusal that came back beside results
 * (`PlanLimitRefusal`, whose message is its `error`).
 */
export function describeLimit(refusal: Pick<LimitError, 'message' | 'actions'> | Pick<PlanLimitRefusal, 'error' | 'actions'>): string {
  const err = 'error' in refusal ? { message: refusal.error, actions: refusal.actions } : refusal
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
  if (rendered.status === 'pending') {
    const readWith = readWithText(rendered.readWith) ?? `renderId ${id}`
    if (rendered.kind === 'sound') return `The sound is still rendering. Read it with ${readWith}.`
    const ready = Array.isArray(rendered.readyPages) ? (rendered.readyPages as unknown[]) : []
    const drawn = typeof rendered.renderedFrameCount === 'number' ? rendered.renderedFrameCount : 0
    const total = typeof rendered.frameCount === 'number' ? rendered.frameCount : null
    const progress = total !== null ? `${drawn} of ${total} frames are drawn` : 'Frames are still drawing'
    const readyText = ready.length ? `; ready: ${ready.length === 1 ? 'page' : 'pages'} ${ready.join(', ')} of ${pages}` : ''
    return `Still rendering: ${progress}${readyText}. Read this page with ${readWith}, and the rest with renderId ${id} and a page number.`
  }
  if (pages > 1) return `Page ${page} of ${pages}. Read another page with renderId ${id} and its page number.`
  return null
}

/** The inputs a pending part names to read it again, in words, or null when it names none. */
function readWithText(readWith: unknown): string | null {
  if (!readWith || typeof readWith !== 'object') return null
  const { renderId, page } = readWith as { renderId?: unknown; page?: unknown }
  if (typeof renderId !== 'string') return null
  return `renderId ${renderId}${typeof page === 'number' ? ` and page ${page}` : ''}`
}

/**
 * Something not ready yet, in one line (gap closure D3): what it is, since when, by when it is expected, how to read it
 * again (its `readWith`, else `fallback`), and why it has not ended when it is blocked or late. The one wording for a
 * pending analysis, evidence sheet or render part on every surface.
 */
export function describePending(
  what: string,
  part: { since?: string; expectedBy?: string; readWith?: unknown; reason?: string },
  fallback: string,
): string {
  const when = [part.since ? `since ${part.since}` : null, part.expectedBy ? `expected by ${part.expectedBy}` : null].filter(Boolean).join(', ')
  const readWith = readWithText(part.readWith)
  const how = readWith ? `read it again with ${readWith}` : fallback
  const why = part.reason ? ` ${part.reason.trim().replace(/\.+$/, '')}.` : ''
  return `${what} is still being made${when ? ` (${when})` : ''}: ${how}.${why}`
}

/**
 * What the server changed in a request (gap closure D2), one line per change: the field, what was asked, what was used
 * and why. Empty when it ran as asked.
 */
export function describeAdjusted(adjusted: unknown): string[] {
  if (!Array.isArray(adjusted)) return []
  return adjusted.flatMap((a) => {
    if (!a || typeof a !== 'object') return []
    const { field, asked, used, reason } = a as { field?: unknown; asked?: unknown; used?: unknown; reason?: unknown }
    if (typeof field !== 'string') return []
    const show = (v: unknown) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v))
    return [`adjusted ${field}: asked ${show(asked)}, used ${show(used)}${typeof reason === 'string' && reason ? ` (${reason})` : ''}.`]
  })
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
 * A source a view read (`context.clip`), in words: what it is (a clip of yours by its url, or a tracked post's video by
 * its contentId and slide, whose copy's address is never handed out), how long, which window was read, the region each
 * frame was cut to, then why its keyframes, the region or the source itself could not be read. Empty for no source.
 * The keyframes themselves are images, so each surface says how it shows them; its sound reads with
 * `describeSourceSound`.
 */
export function describeClip(clip: Record<string, unknown> | null | undefined): string[] {
  if (!clip) return []
  const from = typeof clip.fromSec === 'number' ? clip.fromSec : null
  const to = typeof clip.toSec === 'number' ? clip.toSec : null
  const window = from !== null || to !== null ? `, from ${from ?? 0}s to ${to !== null ? `${to}s` : 'its end'}` : ''
  const length = typeof clip.durationSeconds === 'number' ? ` (${clip.durationSeconds.toFixed(2)}s long)` : ''
  const post = typeof clip.contentId === 'string' ? clip.contentId : null
  const slide = typeof clip.slide === 'number' ? ` (slide ${clip.slide})` : ''
  const lines = [
    post !== null
      ? `Tracked post ${post}, its video${slide}${length}${window}`
      : `Raw source clip${typeof clip.type === 'string' ? ` (${clip.type})` : ''}${length}${window}: ${String(clip.url ?? '')}`,
  ]
  // How the frames map to the source: a region's cut, read from `pixels` (gap closure D2).
  const pixels = clip.pixels && typeof clip.pixels === 'object' && !Array.isArray(clip.pixels) ? (clip.pixels as Record<string, unknown>) : null
  const crop = pixels?.region ? (pixels as unknown as ResolvedMediaBatchItem['crop']) : null
  const zoom = describeCrop(crop, null)
  if (zoom) lines.push(`${zoom[0]!.toUpperCase()}${zoom.slice(1)}`)
  if (typeof clip.keyframeError === 'string' && clip.keyframeError) lines.push(`Keyframes not shown: ${clip.keyframeError}`)
  const missing = Array.isArray(clip.missingAtSec) ? (clip.missingAtSec as unknown[]) : []
  if (missing.length) lines.push(`No frame came back at ${missing.map((t) => `${String(t)}s`).join(', ')}: a moment the source holds no picture at.`)
  lines.push(...describeAdjusted(clip.adjusted))
  // A source's frames come in pages: which one this is, and how to read the next, so nothing past it is lost silently.
  const page = typeof clip.page === 'number' ? clip.page : null
  const pages = typeof clip.pages === 'number' ? clip.pages : null
  if (page !== null && pages !== null && pages > 1) {
    lines.push(page < pages ? `Page ${page} of ${pages}: ask for page ${page + 1} for the next frames.` : `Page ${page} of ${pages}.`)
  }
  const error = clip.error
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const { code, message } = error as { code?: unknown; message?: unknown }
    lines.push(
      `${post !== null ? "The post's video" : 'The clip'} could not be read. ${typeof code === 'string' ? code : 'clip_failed'}${typeof message === 'string' && message ? `: ${message}` : ''}`,
    )
  }
  return lines
}

/**
 * A source's sound a view heard (`context.clip.sound`), in words: the window it measured and its measurement (the
 * edit's sound render's wording, `describeSoundMeasurement`), then where its sounds start, in the source's own seconds
 * so they line up with its frames; or why it could not be heard. Empty for no sound. Its picture is an image and its
 * audio a link, so each surface says how it shows them.
 */
export function describeSourceSound(sound: Record<string, unknown> | null | undefined): string[] {
  if (!sound) return []
  const error = sound.error
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const { code, message } = error as { code?: unknown; message?: unknown }
    return [`The sound could not be heard. ${typeof code === 'string' ? code : 'sound_failed'}${typeof message === 'string' && message ? `: ${message}` : ''}`]
  }
  const window = typeof sound.fromSec === 'number' && typeof sound.toSec === 'number' ? ` from ${sound.fromSec}s to ${sound.toSec}s` : ''
  const measurement = describeSoundMeasurement(sound)
  const lines = [`Its sound${window}, as it is: ${measurement ?? 'nothing measurable.'}`]
  const onsets = Array.isArray(sound.onsets)
    ? (sound.onsets as unknown[]).flatMap((o) => (o && typeof o === 'object' && typeof (o as { seconds?: unknown }).seconds === 'number' ? [(o as { seconds: number }).seconds] : []))
    : []
  if (onsets.length > 0) lines.push(`Sounds start at ${onsets.map((t) => `${t}s`).join(', ')}, in the source's own seconds.`)
  return lines
}

/** One measure's value with its unit, or that there was nothing to measure. */
const measured = (value: unknown, unit: string) => (typeof value === 'number' ? `${value} ${unit}` : 'nothing measurable')

/**
 * A sound's measurement in one paragraph, for a person reading a summary: loudness, peaks, range, how many sounds
 * start in it, and its stereo width. The same reading for a finished sound render of your edit and for a source's
 * sound (which is not a job, so it carries no state). Null for anything else, a render still running, or a sound that
 * could not be measured. Every value is also in the sound's own fields.
 */
export function describeSoundMeasurement(rendered: Record<string, unknown> | null | undefined): string | null {
  if (!rendered || rendered.kind !== 'sound' || rendered.error) return null
  if (rendered.state !== undefined && rendered.state !== 'done') return null
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
  generatingAppUrl: 'rendered',
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
/**
 * How a surface writes the call that waits on jobs, given their ids and the kind they need: the MCP prints its
 * `get_status` call, the CLI its `contenthero status` command. Without one, the SDK's own method is named.
 */
export type WaitCall = (target: { ids: string[]; kind?: JobKind }) => string

export function describeEditorOps(r: ApplyEditorOpsResult, options: { waitCall?: WaitCall } = {}): string {
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
  // Async effect ops (remove_background, separate_layers) start a job and return its output's id, a UUID until the job
  // writes its record, so the wait names it with its kind (`statusTarget`), and each job's link beside it.
  const generating = r.results.filter((x): x is EditorOpResult & { generatingOutputId: string } => !!x.generatingOutputId)
  if (generating.length) {
    const targets = generating.map((x) => statusTarget({ id: x.generatingOutputId, kind: 'output' }))
    const kind = targets[0]?.kind
    const ids = targets.map((t) => t.id)
    const wait = options.waitCall ? options.waitCall({ ids, kind }) : `getStatus (kind '${kind ?? 'output'}') on each`
    lines.push(`Started ${generating.length} background job(s); wait with ${wait}:`)
    for (const x of generating) lines.push(`  - ${x.generatingOutputId}${x.generatingAppUrl ? ` (appUrl ${x.generatingAppUrl})` : ''}`)
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
  // Wording approved 2026-10-13 (gap closure W14).
  lines.push(...describeDocumentFindings(r.documentWarnings, 'Left in the project by this edit:'))
  return lines.join('\n')
}

/** A finding as one line: its subject, its place, and what it says (the app's own form, `describeFinding`). */
export function describeFinding(f: DocumentFinding): string {
  const subject = 'clipId' in f.subject ? f.subject.clipId : 'module' in f.subject ? `@project/${f.subject.module}` : f.subject.trackId
  return `${f.severity} in ${subject}${f.line != null ? `, line ${f.line}` : ''}: ${f.message}`
}

/** Findings under a heading, a line each; nothing when there are none. */
export function describeDocumentFindings(findings: readonly DocumentFinding[] | null | undefined, heading: string): string[] {
  return findings?.length ? [heading, ...findings.map((f) => `  - ${describeFinding(f)}`)] : []
}

/**
 * The `accountIds` a content list could not match, one line each in the server's words, so a surface says every id
 * that named nothing beside the rows the others matched. Nothing when every id named an account.
 */
export function describeAccountIdsNotFound(notFound: readonly AccountIdNotFound[] | null | undefined): string[] {
  return (notFound ?? []).map((n) => `Not matched: ${n.reason}`)
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

/**
 * Which video of a post this is: the post's one video, or a carousel slide counted from 1 with the 0-based `slide`
 * that `view` and the API take for it, so the number to pass is never worked out by hand.
 */
export function contentVideoLabel(video: ContentVideo): string {
  return video.slide === undefined ? 'Video' : `Slide ${video.slide + 1} (slide: ${video.slide})`
}

/** A video's cut list, free: how many cuts in how long, and where. */
export function describeContentVideoCuts(cuts: ContentVideoCuts): string {
  const length = `${cuts.durationSec.toFixed(1)}s`
  if (!cuts.boundaries.length) return `cut list (free): no cuts in ${length}`
  const n = cuts.boundaries.length
  return `cut list (free): ${n} cut${n === 1 ? '' : 's'} in ${length}, at ${cuts.boundaries.map((b) => `${b.toFixed(2)}s`).join(', ')}`
}

/** Seconds to a tenth and decibels whole: the audio map's precision in words, finer than any ear or edit needs. */
const sec1 = (s: number) => `${s.toFixed(1)}s`
const db = (v: number) => `${Math.round(v)} dB`
const signedDb = (v: number) => {
  const r = Math.round(v)
  return r > 0 ? `+${r}` : `${r}`
}

/** Music in words: its tempo and key when known, and how far it drops under speech when it does. */
function audioMapMusicWords(music: { tempoBpm: number | null; key: string | null; mode: 'major' | 'minor' | null }, dropDb: number | null): string[] {
  const parts: string[] = []
  if (music.tempoBpm !== null) parts.push(`${Math.round(music.tempoBpm)} BPM`)
  if (music.key) parts.push(music.mode ? `${music.key} ${music.mode}` : music.key)
  if (dropDb !== null) parts.push(`drops ${Math.round(dropDb)} dB under speech`)
  return parts
}

/** The voice over its bed in a window's line: its level while speaking and how far it sits over everything else. */
function voiceOverBedLine(v: AudioMapWindow['voiceOverBed']): string {
  if (!v) return '  voice: not measured'
  if (v.bedUnderSpeechDb === null || v.voiceOverBedDb == null) return `  voice: ${db(v.voiceUnderSpeechDb)} while speaking, nothing under it`
  return `  voice: ${db(v.voiceUnderSpeechDb)} while speaking, bed ${db(v.bedUnderSpeechDb)}, ${db(v.voiceOverBedDb)} over it`
}

/** Loudness in LUFS, or that the stretch is silent. */
const lufs = (v: number | null) => (v === null ? 'silent' : `${Math.round(v * 10) / 10} LUFS`)

/**
 * A video's audio map in one line, free: how much speech in how long, how many sound candidates, its music, how far the
 * voice sits over the bed while speaking (when measured) and loudness.
 */
export function describeAudioMapSummary(summary: AudioMapSummary): string {
  const n = summary.soundCount
  const sounds = n === 0 ? 'no sound candidates' : `${n} sound candidate${n === 1 ? '' : 's'}`
  const words = audioMapMusicWords(summary.music, summary.duckingDropDb)
  const music = !summary.music.present ? 'no music' : words.length ? `music ${words.join(', ')}` : 'music'
  const voice = summary.voiceOverBedDb != null ? `, voice ${db(summary.voiceOverBedDb)} over the bed while speaking` : ''
  return `audio map (free): ${sec1(summary.speechSec)} of speech in ${sec1(summary.durationSec)}, ${sounds}, ${music}${voice}, mix ${lufs(summary.integratedLufs)}`
}

const hz = (v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : `${Math.round(v)}`)
const share = (v: number) => `${Math.round(v * 100)}%`

/**
 * One sound candidate in a line, numbered as the evidence sheet marks it: when and on which stem, how loud (alone,
 * over its stem's floor, against the voice), where it falls against the beat and which repetition pattern it belongs
 * to (when it has either), and what was measured of it. Never a name: the reader decides what it is.
 */
export function describeAudioMapSound(sound: AudioMapSound, n: number): string {
  const d = sound.descriptors
  const beatMs = sound.beatOffsetMs != null ? Math.round(sound.beatOffsetMs) || 0 : null
  const beat = beatMs != null ? `, ${beatMs > 0 ? `+${beatMs}` : beatMs} ms off the beat` : ''
  const pattern = sound.pattern != null ? `, pattern ${sound.pattern}` : ''
  const level = `${db(sound.levelDb)}, +${Math.round(sound.riseDb)} over its floor${sound.vsVoiceDb !== null ? `, ${signedDb(sound.vsVoiceDb)} vs voice` : ''}${beat}${pattern}`
  const pitched = d.pitchHz?.filter((p): p is number => p !== null) ?? []
  const pitch = pitched.length ? `pitch ${hz(pitched[0]!)}${pitched.length > 1 ? ` to ${hz(pitched[pitched.length - 1]!)}` : ''} Hz` : 'unpitched'
  const shape = [
    `attack ${Math.round(d.attackMs)} ms`,
    `decay ${d.decayMs === null ? 'past its end' : `${Math.round(d.decayMs)} ms`}`,
    `peak ${db(d.peakDb)}`,
    `centroid ${hz(d.centroidHz.start)}/${hz(d.centroidHz.peak)}/${hz(d.centroidHz.end)} Hz (start/peak/end)`,
    `bandwidth ${hz(d.bandwidthHz)} Hz`,
    `flatness ${Math.round(d.flatness * 100) / 100}`,
    pitch,
    `low band ${share(d.lowBandShare)}`,
    `width ${d.stereoWidth === null ? 'mono' : Math.round(d.stereoWidth * 100) / 100}`,
  ].join(', ')
  return `${n}. ${sec1(sound.atSec)} to ${sec1(sound.endSec)} on ${sound.stem}: ${level}; ${shape}`
}

/**
 * A stretch of a video's audio map in lines, in the video's own seconds: where speech is, each sound candidate (numbered
 * as an evidence sheet marks it, with what was measured of it), the music with how many beats fall in the stretch, the
 * voice over its bed while speaking, the mix's loudness, and each stem's level across the whole video.
 */
export function describeAudioMapWindow(window: AudioMapWindow): string[] {
  const speech = window.speech.length ? window.speech.map((s) => `${s.fromSec.toFixed(1)}-${sec1(s.toSec)}`).join(', ') : 'none'
  const m = window.music
  const beats = m.beatsSec.length
  const music = m.present
    ? [...audioMapMusicWords(m, window.ducking ? window.ducking.dropDb : null), `${beats} beat${beats === 1 ? '' : 's'} in this window`].join(', ')
    : 'none'
  const shortTerm = window.loudness.shortTerm.flatMap((p) => (p.lufs === null ? [] : [p.lufs]))
  const loudness =
    `mix ${lufs(window.loudness.integratedLufs)} over the video` +
    (shortTerm.length ? `; short-term ${Math.round(Math.min(...shortTerm))} to ${Math.round(Math.max(...shortTerm))} LUFS in this window` : '')
  const level = (v: number | null) => (v === null ? 'silent' : db(v))
  const l = window.levels
  return [
    `audio map (free), ${sec1(window.fromSec)} to ${sec1(window.toSec)} of ${sec1(window.durationSec)}:`,
    `  speech: ${speech}`,
    window.sounds.length
      ? `  sound candidates (measured, not identified): ${window.sounds.length}`
      : '  sound candidates (measured, not identified): none',
    ...window.sounds.map((s, i) => `    ${describeAudioMapSound(s, i + 1)}`),
    `  music: ${music}`,
    voiceOverBedLine(window.voiceOverBed),
    `  loudness: ${loudness}`,
    `  levels: vocals ${level(l.vocalsDb)}, drums ${level(l.drumsDb)}, bass ${level(l.bassDb)}, other ${level(l.otherDb)}`,
  ]
}

/**
 * A post window's evidence sheet in lines: what the attached picture holds and how to read it, or why there is none
 * yet. The picture itself rides as an image beside these lines.
 */
export function describeEvidenceSheet(sheet: EvidenceSheet | null | undefined): string[] {
  if (!sheet) return []
  if (sheet.status === 'pending') return [describePending('evidence sheet', { ...sheet, reason: undefined }, sheet.reason.trim().replace(/\.+$/, ''))]
  if (sheet.status !== 'ready') return [`evidence sheet: unavailable (${sheet.reason.trim().replace(/\.+$/, '')})`]
  const marked = sheet.soundsMarked === 0 ? 'no sound candidates in this window' : `its ${sheet.soundsMarked} sound candidate${sheet.soundsMarked === 1 ? '' : 's'} marked on the stem each is loudest in, numbered as listed under sound candidates`
  return [
    `evidence sheet, ${sec1(sheet.fromSec)} to ${sec1(sheet.toSec)}: frames along the top, the spoken words under them, then one spectrogram ` +
      `strip per stem (${sheet.stems.join(', ')}; log frequency ${hz(sheet.frequencyHz.min)} Hz to ${hz(sheet.frequencyHz.max)} Hz, low at the bottom), ` +
      `on one time axis in the file's seconds (a rendered range's from the start of the range); ${marked}.`,
  ]
}

/**
 * A segment's words at their exact times (`getContent` with transcript `words`), as one line every surface prints under
 * the segment: each word with its start and end in seconds, unrounded. Null for a segment that carries none.
 */
export function describeSegmentWords(words: ReadonlyArray<{ startMs: number; endMs: number; text: string }> | null | undefined): string | null {
  if (!words?.length) return null
  return words.map((w) => `${w.text}@${w.startMs / 1000}s-${w.endMs / 1000}s`).join(' ')
}

/** Why a transcript asked for at the `words` grain has none: its segments are timed, its words are not. Null otherwise. */
export function describeWordTiming(transcript: { wordTimed?: boolean } | null | undefined): string | null {
  return transcript?.wordTimed === false ? "This post's transcript has no word timing: its segments are timed, its words are not." : null
}

/**
 * What a reader is told of an answer in a format newer than this client reads, after the answer's own name. Every
 * surface (the MCP and the CLI) prints it, so it names both.
 */
export const NEWER_FORMAT_LINE = 'in a newer format than this version of ContentHero reads; update the connector or CLI to read it'

/** The audio map format this client reads (MAP v2). */
export const KNOWN_AUDIO_MAP_VERSION = 2

const AUDIO_MAP_STATUSES: ReadonlySet<string> = new Set(['ready', 'pending', 'failed', 'unavailable'])

/**
 * Whether an audio map answer is in a format newer than this client reads: a status it does not know, or a declared
 * version other than the one it reads. A ready answer with no version is the current format (servers before the
 * version was declared). The ONE check every audio map reader goes through, so an older client says to update
 * instead of reading a shape it was never built for.
 */
export function isNewerAudioMap(answer: AudioMapAnswer): boolean {
  const status: unknown = (answer as { status?: unknown }).status
  if (typeof status !== 'string' || !AUDIO_MAP_STATUSES.has(status)) return true
  const version: unknown = (answer as { version?: unknown }).version
  return status === 'ready' && version !== undefined && version !== KNOWN_AUDIO_MAP_VERSION
}

/**
 * A video's audio map as a reader got it, in lines: being measured (free, so asking again costs nothing), why it is
 * unavailable, or its summary and the window read, whichever came back; in a newer format, that the client needs
 * updating.
 */
export function describeAudioMap(answer: AudioMapAnswer | null | undefined): string[] {
  if (!answer) return []
  if (isNewerAudioMap(answer)) return [`audio map: ${NEWER_FORMAT_LINE}`]
  if (answer.status === 'pending') return [describePending('audio map: the sound analysis', answer, 'read this window again to get it')]
  if (answer.status === 'failed') return [`audio map: the sound analysis failed (${answer.reason.trim().replace(/\.+$/, '')})`]
  if (answer.status === 'unavailable') return [`audio map: unavailable (${answer.reason.trim().replace(/\.+$/, '')})`]
  return [...(answer.summary ? [describeAudioMapSummary(answer.summary)] : []), ...(answer.window ? describeAudioMapWindow(answer.window) : [])]
}

/**
 * A post video's audio map window as lines of their own, under the video's line (`describeContentVideo` carries its
 * summary): empty when no window was read, or when the map is newer than this client reads (that line says so).
 */
export function describeContentVideoWindow(video: Pick<ContentVideo, 'audioMap'>): string[] {
  const map = video.audioMap
  return map?.status === 'ready' && !isNewerAudioMap(map) && map.window ? describeAudioMapWindow(map.window) : []
}

/**
 * One video of `analyzeContent` kind `video`: where its copy stands and, once stored, its cut list and its audio map
 * summary (or that the map is being measured, or why it cannot be), as one sentence that every surface prints after
 * `contentVideoLabel`. The map's window is lines of its own (`describeAudioMapWindow`).
 */
export function describeContentVideo(video: ContentVideo): string {
  const c = video.copy
  const state =
    c.status === 'ready'
      ? c.resolution
        ? c.upgrading
          ? `ready at ${c.resolution}p; a ${c.upgrading.resolution}p copy is downloading; the ${c.resolution}p copy stays readable until it lands`
          : `ready at ${c.resolution}p`
        : 'ready'
      : c.status === 'pending'
        ? 'still downloading'
        : c.status === 'failed'
          ? `the download failed: ${c.error.trim().replace(/\.+$/, '')}`
          : c.status === 'unavailable'
            ? `unavailable: ${c.reason.trim().replace(/\.+$/, '')}`
            : 'not downloaded yet'
  const map = video.audioMap
  const mapLine = !map ? null : map.status === 'ready' && !isNewerAudioMap(map) ? (map.summary ? describeAudioMapSummary(map.summary) : null) : describeAudioMap(map)[0]!
  return `${state}${video.cuts ? `; ${describeContentVideoCuts(video.cuts)}` : ''}${mapLine ? `; ${mapLine}` : ''}.`
}

/**
 * Whether a post's videos are still being fetched: a copy being made, or a stored one being replaced with more detail.
 * Asking again with kind `video` follows either, free.
 */
export function contentVideosPending(r: ContentVideos): boolean {
  return r.copy.status === 'pending' || r.videos.some((v) => v.copy.status === 'ready' && v.copy.upgrading !== undefined)
}

/**
 * What a post's video copies are and could be, from `estimateAnalysisCost` kind `video`, in lines: each video's stored
 * detail and the detail its platform offers, then the price of each resolution that would bring more. Empty for an
 * older server that reports none of it.
 */
export function describeVideoCostDetail(est: ContentAnalysisCostEstimate): string[] {
  const out: string[] = []
  for (const v of est.videos ?? []) {
    const label = v.slide === undefined || (est.videos?.length ?? 0) < 2 ? '' : `${contentVideoLabel({ slide: v.slide } as ContentVideo)}: `
    const stored = v.stored ? `Stored copy: ${v.stored}p.` : 'Not downloaded yet.'
    const offered = v.offered.length ? ` The platform offers: ${v.offered.map((o) => `${o}p`).join(', ')}.` : ''
    out.push(`${label}${stored}${offered}`)
  }
  if (est.upgrades) {
    if (est.upgrades.length) for (const u of est.upgrades) out.push(`Upgrade to ${u.resolution}p: about ${credits(u.creditsEstimate)}.`)
    else if (est.videos?.some((v) => v.stored)) out.push('No higher resolution is offered.')
  }
  return out
}

/**
 * An item as every answer names it: its short id (the one `get_status` and every tool take), else its id, with its page
 * in the app when known. The one handle formatter: the MCP's `jobName` and the CLI print through it.
 */
export function itemHandle(item: { id: string; shortId?: string | null; appUrl?: string | null }): string {
  return `${item.shortId || item.id}${item.appUrl ? ` (appUrl ${item.appUrl})` : ''}`
}

/**
 * The post a transcription (or its price) names, by its handle, with the carousel slide when there is one; null for an
 * audio file. A server older than the handle sends only `contentId`, which is named instead.
 */
export function transcriptionSource(t: { contentId?: string; shortId?: string; appUrl?: string; slide?: number }): string | null {
  if (!t.contentId) return null
  return `post ${itemHandle({ id: t.contentId, shortId: t.shortId, appUrl: t.appUrl })}${t.slide !== undefined ? `, slide ${t.slide}` : ''}`
}

/** What transcribing a post's video or an audio file costs, with nothing run or charged. */
export function describeTranscribeCost(est: TranscribeCostEstimate): string {
  if (est.audioUrl !== undefined) {
    if (est.creditsEstimate === null) return `${est.note ?? "This file's length could not be read, so its price is known only after it is transcribed."} Nothing ran and nothing was charged.`
    if (est.creditsEstimate === 0) return "Transcribing this audio file costs 0 credits: the account's own ElevenLabs key runs it. Nothing ran and nothing was charged."
    const length = est.durationSeconds ? ` (${Math.round(est.durationSeconds)} s)` : ''
    return `Transcribing this audio file${length} costs ${credits(est.creditsEstimate)}, priced from its length and charged for what is heard. Nothing ran and nothing was charged.`
  }
  const what = transcriptionSource(est) ?? 'this post'
  return est.creditsEstimate === 0
    ? `The words of ${what} already exist or are being made: transcribing it costs 0 credits. Nothing ran and nothing was charged.`
    : `Transcribing ${what} costs ${credits(est.creditsEstimate ?? 0)}, priced from its video's length and charged for what is heard. Nothing ran and nothing was charged.`
}

/**
 * Where a transcription stands when it has no transcript to show: still running (each surface then says how to follow
 * it, by asking again with the same post, which is free) or failed. Null once it completed.
 */
export function describeTranscriptionState(t: Transcription): string | null {
  const what = transcriptionSource(t) ?? 'the audio'
  if (t.status === 'running') return `Still transcribing ${what}.`
  if (t.status === 'failed') return `${t.error.trim()} Nothing was charged for it.`
  return null
}
