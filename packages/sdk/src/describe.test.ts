import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NEWER_FORMAT_LINE, describeContentVideoWindow, contentVideosPending, describeVideoCostDetail, describeAudioMap, describeAudioMapSummary, describeAudioMapWindow, describeEvidenceSheet, describeClip, describeContentVideo, describeCrop, describeInputLimits, describeEditorOps, describeExportLoudness, describeLoudness, describeRenderFailure, describeRenderProgress, describeScope, describeSoundMeasurement, describeSourceSound, withExportLoudness } from './describe.js'
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

// Break-verified: dropping the keyframe error line from describeClip turns this red.
test('describeClip says what the clip is, the window read, and why it or its keyframes could not be read', () => {
  assert.deepEqual(describeClip(null), [])
  assert.deepEqual(describeClip({ url: 'https://media.test/c.mp4', type: 'video', durationSeconds: 12, fromSec: 2 }), [
    'Raw source clip (video) (12.00s long), from 2s to its end: https://media.test/c.mp4',
  ])
  assert.deepEqual(
    describeClip({
      url: 'https://media.test/c.mp4',
      keyframeError: 'The video service is unavailable.',
      error: { code: 'clip_unreadable', message: 'The clip could not be opened.' },
    }),
    [
      'Raw source clip: https://media.test/c.mp4',
      'Keyframes not shown: The video service is unavailable.',
      'The clip could not be read. clip_unreadable: The clip could not be opened.',
    ],
  )
})

// A source's frames come in pages; the page line names the next one. Break-verified: dropping the page line turns this red.
test("describeClip names a source's page and how to read the next, and says nothing for one page", () => {
  const post = { contentId: 'p1', type: 'video', layout: 'sheets' }
  assert.deepEqual(describeClip({ ...post, page: 1, pages: 3 }), [
    'Tracked post p1, its video',
    'Page 1 of 3: ask for page 2 for the next frames.',
  ])
  assert.deepEqual(describeClip({ ...post, page: 3, pages: 3 }), ['Tracked post p1, its video', 'Page 3 of 3.'])
  assert.deepEqual(describeClip({ ...post, page: 1, pages: 1 }), ['Tracked post p1, its video'])
})

/**
 * A region reads the one way for an image get_media zoomed and for a clip view cut. Break-verified: dropping the
 * describeCrop line from describeClip turns this red.
 */
test('describeClip says the region each frame was cut to, or why it could not be cut, in the zoom wording', () => {
  const crop = { width: 640, height: 360, region: { x: 960, y: 540, width: 960, height: 540 }, pixelsPerSourcePixel: 0.6667 }
  assert.equal(
    describeCrop(crop, undefined),
    "zoom: 960x540 at (960, 540) in the file's pixels, shown at 640x360 (0.6667 px per file px)",
  )
  assert.equal(describeCrop(undefined, 'The region is outside the file.'), 'zoom not shown: The region is outside the file.')
  assert.equal(describeCrop(undefined, undefined), null)
  assert.deepEqual(describeClip({ url: 'https://media.test/c.mp4', type: 'video', crop }), [
    'Raw source clip (video): https://media.test/c.mp4',
    "Zoom: 960x540 at (960, 540) in the file's pixels, shown at 640x360 (0.6667 px per file px)",
  ])
  assert.deepEqual(describeClip({ url: 'https://media.test/c.mp4', cropError: 'The region is outside the clip.' }), [
    'Raw source clip: https://media.test/c.mp4',
    'Zoom not shown: The region is outside the clip.',
  ])
})

test('describeInputLimits states each limit a model declares, and nothing for one that declares none', () => {
  assert.deepEqual(
    describeInputLimits({
      inputLimits: { imageMaxMB: 20, videoTotalMaxSec: 15, audioMinDurationSec: 1, audioMaxDurationSec: 15, videoPlusOutputMaxSec: 30 },
    }),
    [
      'image files: up to 20 MB each',
      'audio references: each 1 to 15s',
      'video references: up to 15s together',
      'video references plus output: up to 30s together',
    ],
  )
  assert.deepEqual(describeInputLimits({}), [])
  assert.deepEqual(describeInputLimits(null), [])
})

/**
 * A tracked post is named by its contentId and slide, never by its copy's address, and its sound reads as the edit's
 * sound render does, with where its sounds start in the source's own seconds. Break-verified: printing the url for a
 * post turns the first red; keeping the state check in describeSoundMeasurement, or dropping the onset line, the second.
 */
test('describeClip names a post by contentId and slide, and describeSourceSound reads its window', () => {
  assert.deepEqual(
    describeClip({ contentId: 'post-1', slide: 4, type: 'video', durationSeconds: 10, fromSec: 2, toSec: 4 }),
    ['Tracked post post-1, its video (slide 4) (10.00s long), from 2s to 4s'],
  )
  assert.deepEqual(describeClip({ contentId: 'post-1', error: { code: 'slide_required', message: 'Name one with slide (2, 4).' } }), [
    'Tracked post post-1, its video',
    "The post's video could not be read. slide_required: Name one with slide (2, 4).",
  ])
  assert.deepEqual(
    describeSourceSound({
      kind: 'sound', fromSec: 2, toSec: 4,
      loudness: { integratedLufs: -14, truePeakDbtp: -1, loudnessRangeLu: 3, samplePeakDbfs: -1.2 },
      onsets: [{ seconds: 2.25 }, { seconds: 3.5 }], stereo: null,
    }),
    [
      'Its sound from 2s to 4s, as it is: Integrated loudness -14 LUFS, true peak -1 dBTP, loudness range 3 LU, sample peak -1.2 dBFS. 2 sounds start in it. Mono.',
      "Sounds start at 2.25s, 3.5s, in the source's own seconds.",
    ],
  )
  assert.deepEqual(describeSourceSound({ kind: 'sound', error: { code: 'no_sound', message: 'This video has no sound.' } }), [
    'The sound could not be heard. no_sound: This video has no sound.',
  ])
  assert.deepEqual(describeSourceSound(null), [])
})

test('a transcription names its post and slide, prices it, and says where it stands', async () => {
  const { transcriptionSource, describeTranscribeCost, describeTranscriptionState } = await import('./describe.js')
  assert.equal(transcriptionSource({ contentId: 'c1', slide: 2 }), 'post c1, slide 2')
  assert.equal(transcriptionSource({}), null)
  assert.equal(
    describeTranscribeCost({ getCost: true, creditsEstimate: 5, contentId: 'c1' }),
    "Transcribing post c1 costs 5 credits, priced from its video's length and charged for what is heard. Nothing ran and nothing was charged.",
  )
  assert.match(describeTranscribeCost({ getCost: true, creditsEstimate: 0, contentId: 'c1', slide: 0 }), /^The words of post c1, slide 0 already exist or are being made: transcribing it costs 0 credits\./)
  assert.equal(describeTranscriptionState({ status: 'running', contentId: 'c1' }), 'Still transcribing post c1.')
  assert.equal(
    describeTranscriptionState({ status: 'failed', contentId: 'c1', error: 'This video could not be transcribed. Please contact support.' }),
    'This video could not be transcribed. Please contact support. Nothing was charged for it.',
  )
  assert.equal(describeTranscriptionState({ status: 'completed', transcript: '', wordCount: 0, durationSeconds: 1 }), null)
})

/**
 * A video's audio map reads the same on every surface: a one-line summary, a window in lines (each sound candidate
 * numbered as the evidence sheet marks it, with what was measured of it, never a name), and the pending and
 * unavailable states. Break-verified: dropping the vs-voice null check gives a candidate no one speaks near a vs-voice
 * clause; numbering candidates from 0 puts the sheet's marks off by one; dropping the summary from describeContentVideo,
 * the last assertion.
 */
test('describeAudioMap reads a summary, a window, and the pending and unavailable states', () => {
  const summary = {
    durationSec: 30,
    speechSec: 12.34,
    soundCount: 7,
    music: { present: true, tempoBpm: 118.4, key: 'A', mode: 'minor' as const },
    duckingDropDb: 9.2,
    integratedLufs: -14.26,
  }
  assert.equal(describeAudioMapSummary(summary), 'audio map (free): 12.3s of speech in 30.0s, 7 sound candidates, music 118 BPM, A minor, drops 9 dB under speech, mix -14.3 LUFS')
  assert.equal(
    describeAudioMapSummary({ ...summary, soundCount: 1, music: { present: true, tempoBpm: null, key: null, mode: null }, duckingDropDb: null }),
    'audio map (free): 12.3s of speech in 30.0s, 1 sound candidate, music, mix -14.3 LUFS',
  )
  assert.equal(
    describeAudioMapSummary({ ...summary, soundCount: 0, music: { present: false, tempoBpm: null, key: null, mode: null }, duckingDropDb: null, integratedLufs: null }),
    'audio map (free): 12.3s of speech in 30.0s, no sound candidates, no music, mix silent',
  )

  const descriptors = {
    attackMs: 4.2,
    decayMs: 180,
    peakDb: -9.4,
    centroidHz: { start: 5240, peak: 4100, end: 640 },
    bandwidthHz: 3100,
    flatness: 0.623,
    pitchHz: null,
    lowBandShare: 0.08,
    stereoWidth: 0.4,
  }
  const window = {
    fromSec: 0,
    toSec: 6,
    durationSec: 30,
    speech: [{ fromSec: 0, toSec: 3.44 }, { fromSec: 4.1, toSec: 6 }],
    sounds: [
      { atSec: 1.24, endSec: 1.8, stem: 'other' as const, levelDb: -18.3, riseDb: 14.2, vsVoiceDb: 2.6, beatOffsetMs: -12.4, pattern: 2, descriptors },
      {
        atSec: 5,
        endSec: 5.5,
        stem: 'drums' as const,
        levelDb: -22,
        riseDb: 9,
        vsVoiceDb: null,
        beatOffsetMs: null,
        pattern: null,
        descriptors: { ...descriptors, decayMs: null, pitchHz: [880, null, 860], stereoWidth: null },
      },
    ],
    music: { present: true, tempoBpm: 118, beatsSec: [0.5, 1, 1.5], key: 'A', mode: 'minor' as const, levelDb: -24 },
    ducking: { musicUnderSpeechDb: -30, musicWithoutSpeechDb: -21, dropDb: 9 },
    loudness: { integratedLufs: -14.2, shortTerm: [{ atSec: 0, lufs: null }, { atSec: 0.5, lufs: -18.4 }, { atSec: 5.5, lufs: -12.6 }] },
    levels: { vocalsDb: -16.2, drumsDb: -24, bassDb: -28.4, otherDb: null },
  }
  assert.deepEqual(describeAudioMapWindow(window), [
    'audio map (free), 0.0s to 6.0s of 30.0s:',
    '  speech: 0.0-3.4s, 4.1-6.0s',
    '  sound candidates (measured, not identified): 2',
    '    1. 1.2s to 1.8s on other: -18 dB, +14 over its floor, +3 vs voice, -12 ms off the beat, pattern 2; attack 4 ms, decay 180 ms, peak -9 dB, centroid 5.2k/4.1k/640 Hz (start/peak/end), bandwidth 3.1k Hz, flatness 0.62, unpitched, low band 8%, width 0.4',
    '    2. 5.0s to 5.5s on drums: -22 dB, +9 over its floor; attack 4 ms, decay past its end, peak -9 dB, centroid 5.2k/4.1k/640 Hz (start/peak/end), bandwidth 3.1k Hz, flatness 0.62, pitch 880 to 860 Hz, low band 8%, width mono',
    '  music: 118 BPM, A minor, drops 9 dB under speech, 3 beats in this window',
    '  loudness: mix -14.2 LUFS over the video; short-term -18 to -13 LUFS in this window',
    '  levels: vocals -16 dB, drums -24 dB, bass -28 dB, other silent',
  ])
  assert.deepEqual(
    describeAudioMapWindow({ ...window, speech: [], sounds: [], music: { ...window.music, present: false }, ducking: null, loudness: { integratedLufs: null, shortTerm: [] } }).slice(1, 5),
    ['  speech: none', '  sound candidates (measured, not identified): none', '  music: none', '  loudness: mix silent over the video'],
  )

  assert.deepEqual(describeAudioMap({ status: 'pending' }), ['audio map: the sound analysis is still being made: read this window again to get it'])
  assert.deepEqual(describeAudioMap({ status: 'unavailable', reason: 'The audio map could not be measured just now.' }), [
    'audio map: unavailable (The audio map could not be measured just now)',
  ])
  assert.equal(describeAudioMap({ status: 'ready', summary, window }).length, 9)
  assert.deepEqual(describeAudioMap(undefined), [])
  assert.equal(
    describeContentVideo({ copy: { status: 'ready' }, audioMap: { status: 'ready', summary } }),
    'ready; audio map (free): 12.3s of speech in 30.0s, 7 sound candidates, music 118 BPM, A minor, drops 9 dB under speech, mix -14.3 LUFS.',
  )
})

/** A post window's evidence sheet says what its picture holds and how to read it, or why there is none yet. */
test('describeEvidenceSheet reads a ready sheet, and the pending and unavailable states', () => {
  const ready = {
    status: 'ready' as const,
    fromSec: 2,
    toSec: 4,
    width: 1292,
    height: 610,
    dataUrl: 'data:image/webp;base64,AA',
    frames: [{ atSec: 2.5 }],
    words: [],
    stems: ['vocals', 'drums', 'bass', 'other'] as Array<'vocals' | 'drums' | 'bass' | 'other'>,
    frequencyHz: { min: 20, max: 20000 },
    soundsMarked: 3,
  }
  assert.deepEqual(describeEvidenceSheet(ready), [
    "evidence sheet, 2.0s to 4.0s: frames along the top, the spoken words under them, then one spectrogram strip per stem (vocals, drums, bass, other; log frequency 20 Hz to 20k Hz, low at the bottom), on one time axis in the file's seconds (a rendered range's from the start of the range); its 3 sound candidates marked on the stem each is loudest in, numbered as listed under sound candidates.",
  ])
  assert.match(describeEvidenceSheet({ ...ready, soundsMarked: 0 })[0]!, /no sound candidates in this window\.$/)
  assert.deepEqual(describeEvidenceSheet({ status: 'pending', reason: 'The stems are being separated again.' }), ['evidence sheet: being made (The stems are being separated again)'])
  assert.deepEqual(describeEvidenceSheet(null), [])
})

/** A post's video copy names its detail, and the price preview lists the detail stored, offered and on offer. */
test('a copy reads with its detail, an upgrade under way keeps it readable, and the preview lists what more would cost', () => {
  assert.equal(describeContentVideo({ copy: { status: 'ready', resolution: 720 } }), 'ready at 720p.')
  const upgrading = { copy: { status: 'ready' as const, resolution: 360, upgrading: { resolution: 1080 } } }
  assert.equal(describeContentVideo(upgrading), 'ready at 360p; a 1080p copy is downloading; the 360p copy stays readable until it lands.')
  assert.equal(contentVideosPending({ copy: { status: 'ready', resolution: 360 }, videos: [upgrading] }), true)
  assert.equal(contentVideosPending({ copy: { status: 'ready', resolution: 720 }, videos: [{ copy: { status: 'ready', resolution: 720 } }] }), false)

  assert.deepEqual(
    describeVideoCostDetail({
      getCost: true, creditsEstimate: 0,
      videos: [{ stored: 360, offered: [360, 720, 1080] }],
      upgrades: [{ resolution: 720, creditsEstimate: 13 }, { resolution: 1080, creditsEstimate: 1 }],
    }),
    ['Stored copy: 360p. The platform offers: 360p, 720p, 1080p.', 'Upgrade to 720p: about 13 credits.', 'Upgrade to 1080p: about 1 credit.'],
  )
  assert.deepEqual(
    describeVideoCostDetail({ getCost: true, creditsEstimate: 0, videos: [{ stored: 720, offered: [360, 720] }], upgrades: [] }),
    ['Stored copy: 720p. The platform offers: 360p, 720p.', 'No higher resolution is offered.'],
  )
  assert.deepEqual(describeVideoCostDetail({ getCost: true, creditsEstimate: 5, videos: [{ stored: null, offered: [] }] }), ['Not downloaded yet.'])
  // An older server reports none of it.
  assert.deepEqual(describeVideoCostDetail({ getCost: true, creditsEstimate: 5 }), [])
})

/**
 * An older client never throws on a newer server's audio map: a version it does not know, or a status it does not
 * know, reads as one line saying to update, on every reader (the map, a post video's line and its window lines). A map
 * with no version (servers before it was declared) reads as today. An unknown value inside a known format (a stem
 * this client has no name for) is printed as it came. Break-verified: removing the guard from describeAudioMap throws
 * on the v1-shaped window below (it has `events`, not `sounds`).
 */
test('an audio map in a newer format reads as an update line, never a throw', () => {
  const newer = 'audio map: ' + NEWER_FORMAT_LINE
  // A future format: an unknown version with a window this client cannot read (v1's shape, no `sounds`).
  const v3 = { status: 'ready', version: 3, window: { fromSec: 0, toSec: 6, durationSec: 30, events: [] } } as never
  assert.doesNotThrow(() => describeAudioMap(v3))
  assert.deepEqual(describeAudioMap(v3), [newer])
  assert.equal(describeContentVideo({ copy: { status: 'ready' }, audioMap: v3 }), `ready; ${newer}.`)
  assert.deepEqual(describeContentVideoWindow({ audioMap: v3 }), [])

  // An unknown status (enum value) reads the same way.
  const queued = { status: 'queued' } as never
  assert.deepEqual(describeAudioMap(queued), [newer])
  assert.equal(describeContentVideo({ copy: { status: 'ready' }, audioMap: queued }), `ready; ${newer}.`)

  // The current version, declared or not, still reads; an unknown stem inside it prints as it came.
  const window = {
    fromSec: 0, toSec: 1, durationSec: 1, speech: [],
    sounds: [{ atSec: 0, endSec: 0.5, stem: 'piano', levelDb: -20, riseDb: 6, vsVoiceDb: null, beatOffsetMs: null, pattern: null,
      descriptors: { attackMs: 1, decayMs: 10, peakDb: -10, centroidHz: { start: 100, peak: 100, end: 100 }, bandwidthHz: 50, flatness: 0.1, pitchHz: null, lowBandShare: 0.5, stereoWidth: null } }],
    music: { present: false, tempoBpm: null, beatsSec: [], key: null, mode: null, levelDb: null },
    ducking: null,
    loudness: { integratedLufs: null, shortTerm: [] },
    levels: { vocalsDb: null, drumsDb: null, bassDb: null, otherDb: null },
  } as never
  for (const map of [{ status: 'ready', version: 2, window }, { status: 'ready', window }] as never[]) {
    const lines = describeAudioMap(map)
    assert.equal(lines[0], 'audio map (free), 0.0s to 1.0s of 1.0s:')
    assert.match(lines[3]!, / on piano: /)
    assert.deepEqual(describeContentVideoWindow({ audioMap: map }), lines)
  }
})
