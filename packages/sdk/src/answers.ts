import type { ResponseEvent } from './client.js'

/**
 * The requests of one unit of work (an MCP tool call, a CLI command) as `ResponseEvent`s, kept to answer one question:
 * did the server answer everything it was asked, so a fault that followed is this client's own, reading a shape it was
 * not built for? THE one rule the MCP and the CLI share for telling a formatting fault from a failed request.
 */
export class AnswerTally {
  private inFlight = 0
  private failed = false
  private last: { body: unknown } | null = null

  record(event: ResponseEvent): void {
    if (event.type === 'sent') this.inFlight++
    else {
      this.inFlight = Math.max(0, this.inFlight - 1)
      if (event.type === 'failed') this.failed = true
      else this.last = { body: event.body }
    }
  }

  /**
   * The server's last answer when every request was answered and none failed or is still out, so a fault after it is
   * the client's; null otherwise (nothing asked, a request failed, or one is still in flight).
   */
  settledAnswer(): { body: unknown } | null {
    return this.failed || this.inFlight > 0 ? null : this.last
  }
}
