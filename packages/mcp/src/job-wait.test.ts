import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { JobStatusResult } from '@contenthero/sdk'
import { jobStatusRow } from './format.js'

const row = (detail: unknown): JobStatusResult =>
  ({ kind: 'scenes', id: 'Pst12345', state: 'queued', reason: null, appUrl: null, progress: null, detail }) as JobStatusResult

// Break-verified: dropping the wait part from jobStatusRow turns the first assertion red.
test('a queued post job row says how many jobs are ahead and what it waits for', () => {
  const line = jobStatusRow(row({ status: 'running', wait: { phase: 'queued', jobsAhead: 2, waitingFor: 'the post video copy' } }))
  assert.match(line, /wait: queued, no worker has it yet, 2 jobs ahead \(approximate\), waiting for the post video copy/)
  assert.match(line, /poll_after_seconds/)
})

test('a row from an older server, with no wait, has no wait part', () => {
  assert.doesNotMatch(jobStatusRow(row({ status: 'running' })), /wait:/)
})
