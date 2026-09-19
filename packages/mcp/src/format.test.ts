import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  generationStatusResult,
  generationBatchResult,
  getStatusCall,
  pendingResult,
  enhanceClipsResult,
  completedResult,
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


/**
 * A FINISHED GENERATION CARRIES THE ASSET, NOT JUST A LINK TO IT.
 *
 * ## The defect
 *
 * 🚨 **AN AGENT THAT GENERATED AN IMAGE COULD NOT SEE IT.** `completedResult` returned a header, an outputId
 * and numbered urls, so the model had metadata and nothing else. Measured 2026-09-19 in a real session:
 * Claude replied "I can't see the image myself, only the metadata", and the link beside it was already dead
 * because ChatGPT had appended `utm_source=chatgpt.com` to a presigned URL and invalidated its signature.
 *
 * ⭐ The machinery was already here and wired to other tools: `mediaBatchResult` and `liveContextResult`
 * have pushed image blocks for a while. Generation, the one surface where a user most wants to SEE the
 * output, was the only one that did not.
 *
 * ## Why the mediums differ, and why that is not arbitrary
 *
 * MCP's content union is `text | image | audio | resource_link | resource`.
 *
 * ⛔⛔ **ONLY A FIRST-CLASS BLOCK RENDERS. A `resource_link` DOES NOT**, measured in both ChatGPT and Claude
 * in production on 2026-09-19. So an image is EMBEDDED (from its small `.preview.webp` sibling) and also
 * linked for full resolution. Video has no block of its own and would be megabytes of base64 repeated
 * through the rest of the conversation, so it is a link alone and the human clicks through.
 */

const baseGen = {
  outputId: 'o1',
  modelId: 'nb2',
  status: 'completed' as const,
  createdAt: 't',
  completedAt: 't',
  error: null,
}

test('🚨 EVERY variation in a batch comes back, not just the first', () => {
  /*
    ⛔ THE CAP THIS REPLACED MADE A FOUR-VARIATION BATCH SHOW ONE VARIATION. That is not a smaller version
    of the feature, it is a broken one: comparing the variations is the entire reason to generate four.
  */
  const urls = ['a', 'b', 'c', 'd'].map((n) => `https://media.contenthero.ai/u/${n}.png?t=tok`)
  const res = completedResult(
    { ...baseGen, contentType: 'image', outputUrls: urls } as never,
    urls.map((uri, i) => ({ kind: 'link' as const, uri, mimeType: 'image/png', name: `o1-${i + 1}.png` })),
  )
  const links = res.content.filter((c) => c.type === 'resource_link')
  assert.equal(links.length, 4, 'all four variations must be attached')
  // Distinct names, or a batch reads as four copies of one thing.
  assert.equal(new Set(links.map((l) => l.name)).size, 4)
  // The text still leads, so a text-only host loses nothing.
  assert.equal(res.content[0].type, 'text')
  assert.match(res.content[0].text, /outputId o1/)
})

test('⭐ an image comes back as a BLOCK AND a link; video links only', () => {
  /*
    ⛔⛔ THIS TEST ASSERTED THE OPPOSITE UNTIL 2026-09-19, under the name "media is LINKED, never embedded
    as base64". The reasoning was that base64 is charged to the user's context on every later turn and
    `get_media` already exists for when an agent needs to look. Both halves are true and neither answers the
    question the user actually asked, which was to SEE the image.

    🚨 MEASURED IN PRODUCTION, IN BOTH HOSTS: a `resource_link` DOES NOT RENDER. ChatGPT showed a "View the
    generated image" hyperlink that opened a NEW TAB. Claude showed nothing at all: no image, no link, no
    output id. The feature did not work.

    ⭐ So an image gets BOTH: a block, built from the small `.preview.webp` sibling so it costs a few hundred
    tokens rather than megabytes, and the capability link for full resolution. Video keeps link-only, since
    MCP has no video block and base64 video in a transcript is not a trade worth making.
  */
  const imageRes = completedResult(
    { ...baseGen, contentType: 'image', outputUrls: ['https://media.contenthero.ai/u/a.png?t=tok'] } as never,
    [
      { kind: 'bytes', type: 'image', data: 'AAAA', mimeType: 'image/webp' },
      { kind: 'link', uri: 'https://media.contenthero.ai/u/a.png?t=tok', mimeType: 'image/png', name: 'o1.png' },
    ],
  )
  assert.ok(imageRes.content.some((c) => c.type === 'image'), 'an image MUST render inline')
  assert.ok(imageRes.content.some((c) => c.type === 'resource_link'), 'and keep its full-resolution link')

  const videoRes = completedResult(
    { ...baseGen, contentType: 'video', outputUrls: ['https://media.contenthero.ai/u/a.mp4?t=tok'] } as never,
    [{ kind: 'link', uri: 'https://media.contenthero.ai/u/a.mp4?t=tok', mimeType: 'video/mp4', name: 'o1.mp4' }],
  )
  assert.ok(!videoRes.content.some((c) => c.type === 'image'), 'video must not embed bytes')
  assert.ok(videoRes.content.some((c) => c.type === 'resource_link'))
})

test('⛔ video attaches as a resource_link, because MCP has no video block', () => {
  /*
    Embedding it would put megabytes of base64 into every subsequent turn. The link is the right carrier,
    and it is only acceptable because the url behind it is a capability url: no expiry, and appended query
    parameters cannot invalidate it.
  */
  const res = completedResult(
    { ...baseGen, contentType: 'video', outputUrls: ['https://media.contenthero.ai/u/v.mp4?t=tok'] } as never,
    [{ kind: 'link', uri: 'https://media.contenthero.ai/u/v.mp4?t=tok', mimeType: 'video/mp4', name: 'o1.mp4' }],
  )
  const link = res.content.find((c) => c.type === 'resource_link')
  assert.ok(link, 'expected a resource_link block')
  assert.equal(link.mimeType, 'video/mp4')
  assert.match(link.uri, /\?t=/)
  assert.ok(!res.content.some((c) => c.type === 'image'), 'video must not be downgraded to a poster only')
})

test('no attachment still returns the text result, so a fetch failure never fails a generation', () => {
  /*
    ⛔ A generation that SUCCEEDED must never be reported as failed because we could not inline a preview of
    it. This is the shape the caller got before attachments existed, and it has to remain valid.
  */
  const res = completedResult(
    { ...baseGen, contentType: 'image', outputUrls: ['https://media.contenthero.ai/u/a.jpg'] } as never,
  )
  assert.equal(res.content.length, 1)
  assert.equal(res.content[0].type, 'text')
  assert.equal(res.isError, false)
})

test('placement notes survive alongside the attachment', () => {
  // The text half carries chaining ids an agent needs for its next call; attaching bytes must not drop it.
  const res = completedResult(
    {
      ...baseGen,
      contentType: 'image',
      outputUrls: ['https://media.contenthero.ai/u/a.jpg'],
      placement: { surface: 'canvas', layerId: 'L1', slideId: 'S1' },
    } as never,
    [{ kind: 'bytes', type: 'image', data: 'QUJD', mimeType: 'image/jpeg' }],
  )
  assert.match(res.content[0].text, /canvas layer \(id L1\)/)
  assert.ok(res.content.some((c) => c.type === 'image'))
})
