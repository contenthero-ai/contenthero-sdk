import type { Charge } from './types.js'
import type { LimitError } from './errors.js'

/**
 * The words every ContentHero surface uses for what a paid call cost and for a limit refusal, so the MCP and the CLI
 * say the same thing (one wording, not a copy each that drifts).
 */

/**
 * What a paid call cost, as one sentence ("7 credits charged. Balance after: 93 credits."). Null when there is no
 * receipt (an older server, or a call that is not charged). Surfaces label it "Cost".
 */
export function describeCharge(charge: Charge | null | undefined): string | null {
  if (!charge) return null
  const credits = (n: number) => `${n.toLocaleString('en-US')} credit${n === 1 ? '' : 's'}`
  if (charge.state === 'pending') return `${credits(charge.held)} held while it runs, charged for what finishes.`
  if (charge.state === 'free') return 'Nothing was charged.'
  const after = charge.balanceAfter != null ? ` Balance after: ${credits(charge.balanceAfter)}.` : ''
  return `${credits(charge.credits)} charged.${after}`
}

/**
 * A limit refusal for a person: its message as written, then the ways to continue in the order to offer them.
 * Nothing ran and nothing was charged.
 */
export function describeLimit(err: LimitError): string {
  const ways = err.actions.map((a) => `- ${a.label}: ${a.url}`)
  return [err.message, ...(ways.length ? ['Ways to continue:', ...ways] : [])].join('\n')
}
