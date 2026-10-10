import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeEditorOps, describeExportLoudness, describeLoudness, describeRenderFailure, describeRenderProgress, describeScope, describeSoundMeasurement, withExportLoudness } from './describe.js'
import type { ApplyEditorOpsResult } from './types.js'

/**
 * The words the MCP and the CLI share for a read's scope and a render's failure. One copy each, so the two surfaces
 * cannot drift into saying different things about the same response.
 *
 * Break-verified: dropping the track from `describeScope` turns the first red; ignoring a range's missing frames turns
 * the third red.
 */

test('a scoped read names its window and track, or its slide', () => {
  assert.equal(
    describeScope({ fromFrame: 600, toFrame: 629, trackId: 'main' }),
    'Scoped read (frames 600 to 629, track main): the state is that part of the project, not all of it.',
  )
  assert.equal(describeScope({ toFrame: 90 }), 'Scoped read (frames start to 90): the state is that part of the project, not all of it.')
  assert.equal(describeScope({ slideId: 's2' }), 'Scoped read (slide s2): the state is that part of the project, not all of it.')
})

test('a render with no error has nothing to say', () => {
  assert.equal(describeRenderFailure({ dataUrl: 'data:image/webp;base64,AA' }), null)
  assert.equal(describeRenderFailure(null), null)
})

test('a failed render, and the frames of a range that did not render, are said in words', () => {
  assert.equal(
    describeRenderFailure({ error: { code: 'render_unavailable', message: 'Rendering is unavailable right now.' } }),
    'The render produced no image. render_unavailable: Rendering is unavailable right now.',
  )
  assert.equal(
    describeRenderFailure({ missingFrames: [30], error: { code: 'render_failed', message: 'Lambda timed out' } }),
    '1 frame could not be rendered (frames 30). render_failed: Lambda timed out',
  )
})

test('describeFileSize reads as the app shows a size', async () => {
  const { describeFileSize } = await import('./describe.js')
  assert.equal(describeFileSize(512), '512 B')
  assert.equal(describeFileSize(2048), '2.0 KB')
  assert.equal(describeFileSize(5 * 1024 * 1024), '5.0 MB')
  assert.equal(describeFileSize(3 * 1024 * 1024 * 1024), '3.0 GB')
})

/**
 * A write's warnings are sentences of their own (a value held to a limit, 9.8): listed together they read once, each
 * without its own closing period, so the line never ends in "..". Break-verified: dropping the trim turns it red.
 */
test('an edit batch lists its warnings without doubling their periods', () => {
  const result = {
    revision: 7,
    results: [
      { ok: true, warnings: ['Set slide property "durationInSeconds" to 180, its largest value, instead of 240.'] },
      { ok: true, warnings: ['A second warning.'] },
    ],
  } as unknown as ApplyEditorOpsResult
  const text = describeEditorOps(result)
  assert.match(text, /Warnings: Set slide property "durationInSeconds" to 180, its largest value, instead of 240; A second warning\.$/m)
  assert.doesNotMatch(text, /\.\./)
})

/** A batch applies whole or not at all (2026-10-09): a refused batch says nothing was applied, never "Applied 1/2". */
test('a refused batch says nothing was applied, and lists every op with its reason', () => {
  const result = {
    revision: 7,
    results: [
      { op: 'update_clip', ok: false, error: 'Not applied: a batch applies whole or not at all, and op 2 (delete_clip) was refused.' },
      { op: 'delete_clip', ok: false, error: 'item not found' },
    ],
  } as unknown as ApplyEditorOpsResult
  const text = describeEditorOps(result)
  assert.match(text, /^Nothing was applied: a batch applies whole or not at all\. Revision 7, unchanged\.$/m)
  assert.doesNotMatch(text, /Applied \d/)
  assert.match(text, /- delete_clip: item not found/)
  assert.match(text, /- update_clip: Not applied: /)
})

test('a generation lists what it was made from, one line per input, as Studio labels them', async () => {
  const { describeReferences } = await import('./describe.js')
  assert.deepEqual(
    describeReferences([
      { label: 'Reference 1', type: 'image', role: 'reference', url: 'https://media.contenthero.ai/a/original.png?t=x' },
      { label: 'Start frame', type: 'image', role: 'first_frame', url: 'https://media.contenthero.ai/b/original.png?t=y' },
    ]),
    ['Reference 1 (image): https://media.contenthero.ai/a/original.png?t=x', 'Start frame (image): https://media.contenthero.ai/b/original.png?t=y'],
  )
  assert.deepEqual(describeReferences(undefined), [])
})

// A render that outlasted its wait, or has more pages, says how to read the rest; a sound says what it measured
// (the review loop). Break-verified: returning null while rendering turns the first red; dropping the page line, the
// second; printing a missing measure as a number, the third.
test('describeRenderProgress names the id to read a render with, and how much is ready', () => {
  assert.equal(
    describeRenderProgress({ renderId: 'r1', state: 'rendering', kind: 'picture', frameCount: 400, renderedFrameCount: 120, readyPages: [1, 2], pages: 8, page: 1 }),
    'Still rendering: 120 of 400 frames are drawn; ready: pages 1, 2 of 8. Read the rest with renderId r1 and a page number.',
  )
  assert.equal(describeRenderProgress({ renderId: 'r2', state: 'rendering', kind: 'sound' }), 'The sound is still rendering. Read it with renderId r2.')
})

test('describeRenderProgress says which page a finished render is on, and nothing for one page', () => {
  assert.equal(describeRenderProgress({ renderId: 'r1', state: 'done', pages: 3, page: 2 }), 'Page 2 of 3. Read another page with renderId r1 and its page number.')
  assert.equal(describeRenderProgress({ renderId: 'r1', state: 'done', pages: 1, page: 1 }), null)
  assert.equal(describeRenderProgress({ dataUrl: 'x' }), null)
})

test('describeSoundMeasurement reads a finished sound, and says when a measure has nothing to measure', () => {
  assert.equal(
    describeSoundMeasurement({
      kind: 'sound',
      state: 'done',
      loudness: { integratedLufs: -14.2, truePeakDbtp: -1.1, loudnessRangeLu: 6.3, samplePeakDbfs: -1.4 },
      onsets: [{ frame: 3, seconds: 0.1 }],
      stereo: { sideToMid: 0.31, correlation: 0.85 },
    }),
    'Integrated loudness -14.2 LUFS, true peak -1.1 dBTP, loudness range 6.3 LU, sample peak -1.4 dBFS. 1 sound starts in it. Stereo: side to mid 0.31, correlation 0.85.',
  )
  assert.match(
    describeSoundMeasurement({ kind: 'sound', state: 'done', loudness: { integratedLufs: null }, onsets: [], stereo: null }) ?? '',
    /^Integrated loudness nothing measurable, true peak nothing measurable, .* 0 sounds start in it\. Mono\.$/,
  )
  assert.equal(describeSoundMeasurement({ kind: 'sound', state: 'rendering' }), null)
  assert.equal(describeRenderFailure({ kind: 'sound', error: { code: 'render_failed', message: 'boom' } }), 'The sound could not be rendered. render_failed: boom')
})

test("an export's loudness is the app's one line, and nothing before it finishes or when it has no mix", () => {
  const loudness = { target: -16, outcome: 'leveled' as const, gainDb: 2.5, peakReductionDb: null, deliveredLufs: -16, deliveredTruePeakDbtp: -1.2, summary: 'Leveled to the project loudness.' }
  assert.equal(describeExportLoudness(loudness), 'Leveled to the project loudness.')
  assert.equal(describeExportLoudness(null), null)
  assert.equal(describeExportLoudness(undefined), null)
  assert.equal(withExportLoudness('Export e1 completed.', loudness), 'Export e1 completed.\nLeveled to the project loudness.')
  assert.equal(withExportLoudness('Export e1 completed.', null), 'Export e1 completed.')
})

test('a delivery loudness reads as its target in LUFS, or off', () => {
  assert.equal(describeLoudness(-16), '-16 LUFS')
  assert.equal(describeLoudness('off'), 'off')
})
