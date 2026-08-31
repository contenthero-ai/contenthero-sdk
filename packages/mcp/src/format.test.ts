import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  generationStatusResult,
  generationBatchResult,
  getStatusCall,
  pendingResult,
  enhanceClipsResult,
} from './format.js'

/**
 * A running generation must report the slots that have already landed.
 *
 * `outputUrls` fills in slot by slot, so a 4-image batch routinely has finished assets while
 * `status` is still 'processing'. The formatter used to discard them and say only "still
 * processing", which made every caller block on the slowest slot even though the finished images
 * were already visible in the app's own grid.
 */

function gen(overrides = {}) {
  return {
    outputId: 'o1',
    status: 'processing',
    contentType: 'image',
    modelId: 'gpt-image-2',
    outputUrls: [],
    error: null,
    createdAt: '2026-08-29T00:00:00Z',
    completedAt: null,
    ...overrides,
  }
}

const body = (r) => r.content.map((c) => c.text).join('\n')

test('a running generation reports the urls it already has', () => {
  const out = body(generationStatusResult(gen({ outputUrls: ['https://a/1.png'] })))
  assert.match(out, /https:\/\/a\/1\.png/)
  assert.match(out, /1 image ready/)
  assert.match(out, /still processing/)
})

test('a partial result is never mistaken for a finished one', () => {
  // The whole point of the change is that a caller can act early. It must NOT be able to conclude
  // the set is complete, or it would silently drop the slots still running.
  const out = body(generationStatusResult(gen({ outputUrls: ['https://a/1.png'] })))
  assert.doesNotMatch(out, /^Done\./m)
  assert.match(out, /NOT the full set/)
  assert.match(out, /poll_after_seconds/)
})

test('a running generation with no urls yet is unchanged', () => {
  const out = body(generationStatusResult(gen()))
  assert.match(out, /is still processing/)
  assert.doesNotMatch(out, /Partial/)
  assert.doesNotMatch(out, /ready/)
})

test('a completed generation still uses the Done header', () => {
  const out = body(
    generationStatusResult(gen({ status: 'completed', outputUrls: ['https://a/1.png', 'https://a/2.png'] })),
  )
  assert.match(out, /^Done\. 2 images/)
  assert.doesNotMatch(out, /Partial/)
})

test('a failed generation is unaffected and stays an error', () => {
  const r = generationStatusResult(gen({ status: 'failed', error: 'boom' }))
  assert.equal(r.isError, true)
  assert.match(body(r), /failed: boom/)
})

test('the batch form also surfaces partial urls', () => {
  const out = body(
    generationBatchResult([
      gen({ outputId: 'a', outputUrls: ['https://a/1.png'] }),
      gen({ outputId: 'b' }),
      gen({ outputId: 'c', status: 'completed', outputUrls: ['https://c/1.png'] }),
    ]),
  )
  assert.match(out, /- a: processing, 1 ready so far \| https:\/\/a\/1\.png/)
  assert.match(out, /- b: processing \[poll_after_seconds/)
  assert.match(out, /- c: completed \| https:\/\/c\/1\.png/)
})

/**
 * The async handoff must name the argument the tool actually takes.
 *
 * `get_generation_status` requires `outputIds`, an ARRAY of 1 to 8, even for a single job. The handoff
 * used to read "call get_generation_status with this outputId", so an agent following it literally sent
 * `{ outputId }` and the schema rejected the call. Found by driving the MCP as an ordinary user on
 * 2026-08-31. These tests assert the printed CALL, not prose, because prose is what drifted.
 */

test('the status call names outputIds and passes an array, even for one id', () => {
  const call = getStatusCall(['o1'])
  assert.match(call, /outputIds: \["o1"\]/)
  // The singular must not appear as an argument name anywhere in the call.
  assert.doesNotMatch(call, /outputId:/)
})

test('the status call carries every id in one call', () => {
  assert.match(getStatusCall(['a', 'b', 'c']), /outputIds: \["a", "b", "c"\]/)
})

test('a still-rendering job hands back a callable get_generation_status', () => {
  const out = body(pendingResult('vid-7', 15))
  assert.match(out, /outputIds: \["vid-7"\]/)
  assert.doesNotMatch(out, /with this outputId/)
})

test('in-place enhancement hands back every outputId in one callable form', () => {
  const out = body(
    enhanceClipsResult({
      outputs: [
        { outputId: 'j1', clipIds: ['c1', 'c2'], windows: 2 },
        { outputId: 'j2', clipIds: ['c3'], windows: 1 },
      ],
    }),
  )
  assert.match(out, /outputIds: \["j1", "j2"\]/)
})
