import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { JobStatusResult } from '@contenthero/sdk'
import { statusHuman } from './status.js'

const queued = (kind: 'content' | 'scenes'): JobStatusResult =>
  ({
    kind,
    id: 'Pst12345',
    state: 'queued',
    reason: null,
    appUrl: null,
    progress: null,
    detail: { status: 'running', wait: { phase: 'queued', jobsAhead: 3, waitingFor: 'the post video copy', typicalSeconds: 60 } },
  }) as JobStatusResult

// Break-verified: dropping the wait line from statusHuman turns both assertions red.
test('a queued post analysis or scenes job prints where it stands in the queue', () => {
  for (const kind of ['content', 'scenes'] as const) {
    const out = statusHuman(queued(kind))
    assert.match(out, /Wait:\s+queued, no worker has it yet, 3 jobs ahead \(approximate\), waiting for the post video copy, typical time 60s/)
  }
})

test('a job from an older server, with no wait, prints no wait line', () => {
  const old = { ...queued('content'), detail: { status: 'running' } } as JobStatusResult
  assert.doesNotMatch(statusHuman(old), /Wait:/)
})
