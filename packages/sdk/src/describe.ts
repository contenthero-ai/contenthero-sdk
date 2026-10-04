import type { ApplyEditorOpsResult, Charge, EditorOpResult, GraphicDiagnostic, ProjectReadScope } from './types.js'
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
 * Why a get_context render produced no image, or some frames of a range, in words: the API's `rendered.error` and
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
  return `The render produced no image. ${why}`
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

/** One graphic compiler finding, printed the way a compiler prints one: where, what, then the author's line. */
function graphicDiagnosticLines(d: GraphicDiagnostic): string[] {
  const where = d.line != null ? `, line ${d.line}${d.column != null ? `, column ${d.column}` : ''}` : ''
  const head = `  - graphic ${d.itemId}${where}: ${d.severity} (${d.code}): ${d.message}`
  return d.snippet && d.line != null ? [head, `      ${d.line} | ${d.snippet}`] : [head]
}

/**
 * An applyEditorOps batch, for the MCP's tool result and the CLI's output alike: what applied, the new revision, what
 * was created, jobs to poll, each failure with its reason, warnings, and every graphic compiler finding with its line
 * (a refused graphic's error names only the first, and a warning on code that applied appears nowhere else).
 */
export function describeEditorOps(r: ApplyEditorOpsResult): string {
  const okCount = r.results.filter((x) => x.ok).length
  const failures = r.results.filter((x) => !x.ok)
  const created = r.results.flatMap((x) => x.createdIds ?? [])
  const lines = [`Applied ${okCount}/${r.results.length} op(s). New revision: ${r.revision}.`]
  if (created.length) lines.push(`Created: ${created.join(', ')}.`)
  // Async effect ops (remove_background) dispatch a job and return its outputId; name it so the reader can poll.
  const generating = r.results.map((x) => x.generatingOutputId).filter((id): id is string => !!id)
  if (generating.length) {
    lines.push(`Dispatched ${generating.length} async job(s); get_generation_status on: ${generating.join(', ')}.`)
  }
  if (failures.length) {
    lines.push('Failed ops:')
    for (const f of failures) lines.push(`  - ${f.op}: ${f.error ?? 'unknown error'}`)
  }
  const warnings = r.results.flatMap((x) => x.warnings ?? [])
  if (warnings.length) lines.push(`Warnings: ${warnings.join('; ')}.`)
  const diagnostics = r.results.flatMap((x) => x.diagnostics ?? [])
  if (diagnostics.length) {
    lines.push('Graphic code:')
    for (const d of diagnostics) lines.push(...graphicDiagnosticLines(d))
  }
  return lines.join('\n')
}
