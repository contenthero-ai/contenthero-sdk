import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  generationStatusResult,
  completedResult,
  audioResult,
  contentScenesResult,
  contentAnalysisResult,
  withCharge,
} from './format.js'

/**
 * A paid result carries its charge in its structured data, not only in its text (2026-09-30).
 *
 * A host may hand the model a result's `structuredContent` instead of its text: on claude.ai a finished generation
 * reached the agent as its widget data alone, so "Cost: 6 credits charged" never arrived and the agent could not
 * tell what it had spent.
 */

const charged = { credits: 6, held: 0, state: 'charged' as const, balanceAfter: 86427 }
const pending = { credits: 0, held: 5, state: 'pending' as const, balanceAfter: null }

function structured(r: { structuredContent?: Record<string, unknown> }) {
  assert.ok(r.structuredContent, 'the result has structured data')
  return r.structuredContent
}

test('a finished generation, polled or returned, carries its charge', () => {
  const gen = { outputId: 'o1', status: 'completed', contentType: 'image', modelId: 'nano-banana-2', outputUrls: ['https://a/1.jpg'], charge: charged }
  for (const r of [completedResult(gen as never), generationStatusResult(gen as never)]) {
    assert.deepEqual(structured(r).charge, charged)
    assert.equal(structured(r).cost, 'Cost: 6 credits charged. Balance after: 86,427 credits.')
  }
})

test('a running generation carries what is held for it', () => {
  const gen = { outputId: 'o1', status: 'processing', contentType: 'image', modelId: 'nano-banana-2', outputUrls: ['https://a/1.jpg'], charge: pending }
  assert.deepEqual(structured(generationStatusResult(gen as never)).charge, pending)
})

test('audio, scenes and Break It Down carry their charge', () => {
  assert.deepEqual(structured(audioResult({ outputId: 'a1', outputUrls: ['https://a/1.mp3'], charge: charged } as never)).charge, charged)
  assert.deepEqual(
    structured(contentScenesResult({ contentId: 'c1', scenes: { status: 'running' }, charge: pending } as never)).charge,
    pending,
  )
  assert.deepEqual(
    structured(contentAnalysisResult({ contentId: 'c1', analysis: { status: 'running' }, charge: pending } as never)).charge,
    pending,
  )
})

test('withCharge adds the charge to structured data when the result has any', () => {
  const r = withCharge({ content: [{ type: 'text', text: 'ok' }], structuredContent: { a: 1 } }, charged)
  assert.deepEqual(structured(r), { a: 1, charge: charged, cost: 'Cost: 6 credits charged. Balance after: 86,427 credits.' })
})

test('BREAK-VERIFY: no result builder writes a cost line without the structured charge', () => {
  // Every function in the formatter that renders a charge into its text AND returns structured data must also
  // spread `chargeData`, or go through `withCharge`. Found by reading the function bodies, so a new builder that
  // forgets fails here rather than on a host.
  const src = readFileSync(new URL('./format.ts', import.meta.url), 'utf8')
  const bodies = src.split(/\nexport function |\nfunction /).slice(1)
  const offenders = bodies
    .filter((b) => /chargeLine\(/.test(b) && /structuredContent:/.test(b) && !/chargeData\(/.test(b))
    .map((b) => b.slice(0, b.indexOf('(')))
    .filter((name) => name !== 'withCharge' && name !== 'chargeData')
  assert.deepEqual(offenders, [])
  // Guard the guard: the functions this was written for are still found by the split.
  const names = bodies.map((b) => b.slice(0, b.indexOf('(')))
  for (const n of ['completedResult', 'audioResult', 'contentScenesResult', 'contentAnalysisResult']) assert.ok(names.includes(n), n)
})
