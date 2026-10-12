import { AsyncLocalStorage } from 'node:async_hooks'
import { AnswerTally, type ContentHero } from '@contenthero/sdk'

/**
 * THE SERVER'S ANSWER FOR THE TOOL CALL IN PROGRESS, so a formatting fault never hides it.
 *
 * Users install the connector at their own pace, so the server is always ahead of some of them. A newer answer can
 * carry a shape an older formatter was never built for, and that formatter then throws after the server answered
 * (measured: audio map v2 read by a v1 connector threw inside `describeAudioMapWindow`). `errorResult` reads this to
 * hand the answer over as data with a line saying to update, instead of reporting the fault as the call's error.
 *
 * Per call, not per client: one client serves concurrent calls, so the tally lives in the call's async context.
 */
const calls = new AsyncLocalStorage<AnswerTally>()
const observed = new WeakSet<ContentHero>()

/** Run one tool call with its own tally. */
export function runToolCall<T>(fn: () => T): T {
  return calls.run(new AnswerTally(), fn)
}

/** Record a client's requests into whichever tool call made them. Idempotent per client. */
export function observeClient(client: ContentHero): ContentHero {
  // A stand-in client without listeners (a test double) is served as it is: the net then simply has no answer to give.
  if (!observed.has(client) && typeof client.observeResponses === 'function') {
    observed.add(client)
    client.observeResponses((event) => calls.getStore()?.record(event))
  }
  return client
}

/** The server's last answer in this tool call when every request was answered (`AnswerTally.settledAnswer`). */
export function lastAnswer(): { body: unknown } | null {
  return calls.getStore()?.settledAnswer() ?? null
}
