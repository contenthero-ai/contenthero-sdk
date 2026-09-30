import type { Charge } from './types.js'
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
