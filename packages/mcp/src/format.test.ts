import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  generationStatusResult,
  generationBatchResult,
  getStatusCall,
  pendingResult,
  enhanceClipsResult,
  completedResult,
  generationWidgetData,
  pollAfterSecondsFor,
  studioUrlFor,
  audioResult,
  completedExportResult,
  exportJobResult,
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


// ---------------------------------------------------------------------------
// The model chip
// ---------------------------------------------------------------------------

/**
 * ⛔⛔⛔ **THE CHIP SHOWS NOTHING RATHER THAN THE MODEL ID.**
 *
 * `generationWidgetData` used to compute `modelName: displayName ?? gen.modelId`, fed by a catalog fetch
 * in the server whose `catch` returned the id. `gpt-image-2` reads like a label, so every failure of that
 * unrelated network call surfaced as a chip flickering between kebab case and title case, with nothing
 * logged. A sentinel that collapses "I could not resolve this" into a plausible answer moves the defect
 * into every caller.
 *
 * ⚠️ This test fails if anyone reintroduces the `?? gen.modelId` fallback, which is the only reason it
 * asserts a null rather than simply asserting the happy path.
 */
test('🚨 an unresolved model name renders NOTHING, never the raw id', () => {
  const data = generationWidgetData({
    ...baseGen,
    modelId: 'gpt-image-2',
    contentType: 'image',
    outputUrls: ['https://media.contenthero.ai/u/a.png?t=tok'],
  } as never)
  assert.equal(data.modelName, null, 'no display name means no chip')
  assert.notEqual(data.modelName, 'gpt-image-2', 'the id must never stand in for the label')
  // The id itself stays on the payload: it is the machine-readable key, just not the label.
  assert.equal(data.modelId, 'gpt-image-2')
})

test('the chip carries what the registry resolved, not what the widget could guess', () => {
  const data = generationWidgetData({
    ...baseGen,
    modelId: 'gpt-image-2',
    contentType: 'image',
    outputUrls: ['https://media.contenthero.ai/u/a.png?t=tok'],
    modelDisplayName: 'GPT Image 2',
    modelBrandColor: '#10A37F',
    modelIconKey: 'openai',
    displayAspect: '9:16',
    prompt: 'a yoga pose',
  } as never)
  assert.equal(data.modelName, 'GPT Image 2')
  assert.equal(data.modelBrandColor, '#10A37F')
  // ⚠️ The icon key is a BRAND FAMILY, not the model id. Keying a glyph off the id would need a new entry
  // per model and would miss every model added to the registry after the last deploy.
  assert.equal(data.modelIconKey, 'openai')
  assert.equal(data.displayAspect, '9:16')
  assert.equal(data.prompt, 'a yoga pose')
})

/**
 * ⭐ **THE ONE PLACE THE ID IS STILL AN ACCEPTABLE FALLBACK.**
 *
 * The text block's reader is the model, for whom `gpt-image-2` is a true and directly useful token. The
 * chip's reader is a person, for whom the same string is an unexplained failure wearing a label's clothes.
 * Same value, opposite correct behavior, which is why this is asserted rather than left to be "fixed" later
 * into consistency with the test above.
 */
test('the TEXT header still names the id when nothing resolved, because a model reads it', () => {
  const res = completedResult({
    ...baseGen,
    modelId: 'gpt-image-2',
    contentType: 'image',
    outputUrls: ['https://media.contenthero.ai/u/a.png?t=tok'],
  } as never)
  assert.match(res.content[0].text, /from gpt-image-2/)
})

test('a resolved name reaches the text header too', () => {
  const res = completedResult({
    ...baseGen,
    modelId: 'gpt-image-2',
    contentType: 'image',
    outputUrls: ['https://media.contenthero.ai/u/a.png?t=tok'],
    modelDisplayName: 'GPT Image 2',
  } as never)
  assert.match(res.content[0].text, /from GPT Image 2/)
})


// ---------------------------------------------------------------------------
// The pending state
// ---------------------------------------------------------------------------

/**
 * ⭐⭐⭐ **A SLOW GENERATION SHOWS PLACEHOLDERS INSTEAD OF A PARAGRAPH.**
 *
 * A job that outran the smart wait used to return one sentence asking the agent to poll. Every video takes
 * that path, so the person who waited longest got the least. It now also carries a widget payload the
 * frame can draw placeholder cards from, at the right shape and the right count.
 */
test('a pending generation binds the widget and says how many are coming', () => {
  const res = pendingResult('o-slow', 15, {
    contentType: 'video',
    modelId: 'seedance-2',
    displayAspect: '9:16',
    expected: 4,
  })
  const sc = res.structuredContent as Record<string, unknown>
  assert.equal(sc.status, 'processing')
  assert.equal(sc.expected, 4)
  assert.equal(sc.displayAspect, '9:16')
  assert.deepEqual(sc.items, [], 'nothing has landed yet')
  assert.ok(res._meta?.['ui/resourceUri'], 'the widget must be bound or nothing renders')
})

/**
 * ⛔⛔ **THE PROSE MUST SURVIVE, WORD FOR WORD.**
 *
 * It is what a host without MCP Apps renders, and it is what the AGENT reads to know it has to poll. An
 * agent that stopped polling because the sentence was replaced by a payload it cannot see would leave a
 * charged generation unclaimed. The widget is added ALONGSIDE it, never instead of it.
 */
test('the pending text still tells the agent to poll', () => {
  const withWidget = pendingResult('o-slow', 15, { contentType: 'video', modelId: 'seedance-2', expected: 1 })
  const textOnly = pendingResult('o-slow', 15)
  assert.equal(withWidget.content[0].type, 'text')
  assert.equal(
    withWidget.content[0].text,
    textOnly.content[0].text,
    'adding the widget must not change one character of what the agent reads',
  )
  assert.match(withWidget.content[0].text, /get_generation_status \{ outputIds: \["o-slow"\] \}/)
})

/**
 * ⚠️ A count of zero would draw a grid with nothing in it, which reads as broken rather than busy.
 */
test('at least one placeholder is always promised', () => {
  const sc = pendingResult('o', 15, { contentType: 'image', modelId: 'm', expected: 0 })
    .structuredContent as Record<string, unknown>
  assert.equal(sc.expected, 1)
})

/**
 * ⛔ NO MODEL NAME ON THE PENDING PATH, DELIBERATELY. Resolving one would mean a network call from inside
 * a catch block, which is the exact shape that produced a chip flickering between kebab case and title
 * case. The widget polls and the name arrives with the first response.
 */
test('the pending chip is empty rather than guessed', () => {
  const sc = pendingResult('o', 15, { contentType: 'image', modelId: 'gpt-image-2', expected: 2 })
    .structuredContent as Record<string, unknown>
  assert.equal(sc.modelName, null)
  assert.notEqual(sc.modelName, 'gpt-image-2')
  assert.equal(sc.modelId, 'gpt-image-2', 'the id still travels; it is just not a label')
})

test('video is polled less often than image, because it takes longer', () => {
  assert.ok(pollAfterSecondsFor('video') > pollAfterSecondsFor('image'))
})


/**
 * ⭐ THE OPEN BUTTON'S URL.
 *
 * ⛔ This asserts the real `studioUrlFor`, not a copy of its arithmetic. An earlier version of this test
 * restated the index conversion inline, which cannot fail when the function is wrong: it only proves the
 * test agrees with itself.
 *
 * ⚠️ ONE-BASED IN THE NAME, ZERO-BASED IN THE URL. `<id>-3` is what a person reads as "variation 3" and
 * `variation=2` is the studio's slot. Getting it wrong opens the WRONG PICTURE, which reads as a broken
 * link rather than an off-by-one.
 */
test('the url names the variation a PERSON reads, which is one-based', () => {
  const id = 'cfe3bafb-ddc5-4e51-bae6-68ec61112a23'
  const base = 'https://app.contenthero.ai'
  // Output 0 is "Variation 1 of 4" in the detail view and `<id>-1` in a reference. The url must agree.
  assert.equal(studioUrlFor(base, id, 0, 4), `${base}/studio?output=${id}&variation=1`)
  assert.equal(studioUrlFor(base, id, 3, 4), `${base}/studio?output=${id}&variation=4`)
  // ⛔ Zero must never appear: it is slot space, and slot space is not a number to show anyone.
  assert.ok(!studioUrlFor(base, id, 0, 4).includes('variation=0'))
})

test('a single output names no variation, because there was no choice to record', () => {
  const id = 'fff25b52-2974-4594-892e-39310475e760'
  assert.equal(studioUrlFor('https://app.contenthero.ai', id, 0, 1), `https://app.contenthero.ai/studio?output=${id}`)
})

test('a trailing slash on the base url does not produce a double slash', () => {
  assert.match(studioUrlFor('https://app.contenthero.ai/', 'o', 0, 1), /^https:\/\/app\.contenthero\.ai\/studio\?/)
})

/**
 * ⚠️ The base url is a PARAMETER so a local server deep-links to itself. Hardcoding production meant Open
 * always left for the live app even while testing against localhost.
 */
test('the widget payload carries a studio url per output', () => {
  const data = generationWidgetData(
    {
      ...baseGen,
      outputId: 'o1',
      contentType: 'image',
      outputUrls: ['https://media.contenthero.ai/a.png', 'https://media.contenthero.ai/b.png'],
    } as never,
    [],
    'http://localhost:3000',
  )
  /**
   * ⚠️ `openUrl`, NOT `studioUrl`. The field means "where this lives in the product", and naming it after
   * one destination is what made an earlier version treat a project export as a studio question.
   */
  assert.equal(data.items[0]!.openUrl, 'http://localhost:3000/studio?output=o1&variation=1')
  assert.equal(data.items[1]!.openUrl, 'http://localhost:3000/studio?output=o1&variation=2')
})


/**
 * ⚠️ THE REASSURANCE MUST MATCH THE MEDIUM.
 *
 * Every pending result said "This is normal for video", including image jobs, where it reads as the server
 * describing something other than what was asked for. `shape` is present exactly when the medium is known.
 */
test('an image job is not told that slowness is normal for video', () => {
  const img = pendingResult('o', 5, { contentType: 'image', modelId: 'gpt-image-2', expected: 3 })
  assert.ok(!img.content[0].text.includes('normal for video'))
  assert.match(img.content[0].text, /Still rendering \(outputId o\)\. Call/)
})

test('a video job still gets the reassurance, because for video it is true', () => {
  const vid = pendingResult('o', 15, { contentType: 'video', modelId: 'seedance-2', expected: 1 })
  assert.match(vid.content[0].text, /This is normal for video\./)
})

/**
 * ⚠️ The shapeless form is what a host without app support sees, and it cannot know the medium, so it keeps
 * the generic wording rather than silently dropping a reassurance that is usually right.
 */
test('with no shape the wording is unchanged', () => {
  assert.match(pendingResult('o', 15).content[0].text, /This is normal for video\./)
})


// ---------------------------------------------------------------------------
// The payload shape
// ---------------------------------------------------------------------------

/**
 * ⭐⭐⭐ **A GENERATION IS THE CASE WHERE EVERY ITEM AGREES, NOT A MODE ANYONE SETS.**
 *
 * The payload used to BE a generation: one outputId, one contentType, one chip, one aspect shared by every
 * tile. That shape is the reason nothing but a generation could render, and why `generate_audio` was
 * text-only for the life of this widget. Items with their own medium and shape is what lets an upload, an
 * export and a mixed library set use the same viewer.
 */
test('a generation emits items that all share its medium and shape', () => {
  const data = generationWidgetData(
    {
      ...baseGen,
      outputId: 'o1',
      contentType: 'image',
      displayAspect: '9:16',
      outputUrls: ['https://media.contenthero.ai/a.png', 'https://media.contenthero.ai/b.png'],
    } as never,
    [],
    'https://app.contenthero.ai',
  )
  assert.equal(data.items.length, 2)
  for (const it of data.items) {
    assert.equal(it.contentType, 'image')
    assert.equal(it.displayAspect, '9:16')
    assert.ok(it.openUrl, 'a generation lives in the studio, so every item knows where to open')
  }
  // The shared values stay too: their PRESENCE is what tells the widget to lay this out as a row.
  assert.equal(data.displayAspect, '9:16')
  assert.equal(data.contentType, 'image')
})

/**
 * ⚠️ AUDIO HAS NO SHAPE, and null is the honest answer rather than a default square. A tile with no ratio
 * falls back to a bounded box instead of cropping against one nobody established.
 */
test('audio items carry a null shape, not a guessed one', () => {
  const r = audioResult(
    { outputId: 'aud', outputUrls: ['https://media.contenthero.ai/a.mp3'] } as never,
    'https://app.contenthero.ai',
  )
  const sc = r.structuredContent as { items: Array<{ contentType: string; displayAspect: unknown }> }
  assert.equal(sc.items[0]!.contentType, 'audio')
  assert.equal(sc.items[0]!.displayAspect, null)
})

/**
 * ⛔⛔ **THE OLD SHAPE MUST KEEP RENDERING.**
 *
 * Results already sitting in people's conversations carry `outputs` with a shared `contentType`, and the
 * host re-renders them with whatever bundle is current. Dropping the old reader would blank every card
 * anybody generated before this change, which is a regression nobody would attribute to a payload rename.
 *
 * ⚠️ This asserts the NORMALIZER, which is the widget's own `itemsOf` logic restated here because the
 * widget has no test runner. That restatement is the weakness; it is recorded rather than hidden.
 */
test('the old outputs shape still yields items', () => {
  const legacy = {
    outputId: 'o1',
    contentType: 'image' as const,
    displayAspect: '16:9',
    outputs: [{ url: 'https://media.contenthero.ai/a.png', name: 'o1-1', studioUrl: '/studio?output=o1' }],
  }
  const items = legacy.outputs.map((o) => ({
    url: o.url,
    name: o.name,
    contentType: legacy.contentType,
    displayAspect: legacy.displayAspect,
    openUrl: o.studioUrl,
  }))
  assert.equal(items[0]!.contentType, 'image')
  assert.equal(items[0]!.displayAspect, '16:9')
  assert.equal(items[0]!.openUrl, '/studio?output=o1')
})


/**
 * ⛔⛔ **AN EXPORT RENDERS, AND IT IS NOT REFERENCEABLE.**
 *
 * Someone waited for a render, so they should see it. But an exportId is not an outputId: no generate tool
 * resolves one, so Animate, Edit and Recreate would emit messages the agent cannot act on and a person
 * cannot tell were never going to work. The ABSENCE of `reference` is what hides those verbs, so it is
 * asserted rather than left to be added later by someone tidying up.
 */
test('a completed mp4 export renders, with no reference and no destination', () => {
  const res = completedExportResult(
    { exportId: 'exp-1', status: 'completed', outputUrl: 'https://media.contenthero.ai/e.mp4' },
    'mp4',
  )
  const sc = res.structuredContent as { items: Array<{ contentType: string; reference?: unknown; openUrl?: unknown }> }
  assert.ok(res._meta?.['ui/resourceUri'], 'a finished render must be visible')
  assert.equal(sc.items[0]!.contentType, 'video')
  assert.equal(sc.items[0]!.reference, null, 'an exportId is not something generate_* can name')
  assert.equal(sc.items[0]!.openUrl, null, "an export's home is a download, not a library detail view")
})

/**
 * ⚠️ pdf and pptx have no element, and a multi-slide png export comes back as a ZIP. A tile for any of them
 * shows a broken picture where the text already gives a working download link.
 */
test('formats the widget cannot draw stay text', () => {
  for (const fmt of ['pdf', 'pptx']) {
    const res = completedExportResult(
      { exportId: 'exp-1', status: 'completed', outputUrl: 'https://media.contenthero.ai/e.pdf' },
      fmt,
    )
    assert.equal(res._meta, undefined, `${fmt} must not claim a widget`)
  }
})

/**
 * ⛔ `get_export` POLLS BY ID ALONE, so it cannot know the format and can never render. That is why the two
 * builders are separate names rather than one with a flag: the completeness guard reads a shared builder as
 * "this tool emits a widget", and an invariant that has to be argued with is not one.
 */
test('a poll reports and never displays', () => {
  const res = exportJobResult({ exportId: 'exp-1', status: 'completed', outputUrl: 'https://x/e.mp4' })
  assert.equal(res._meta, undefined)
  assert.equal((res as { structuredContent?: unknown }).structuredContent, undefined)
})
