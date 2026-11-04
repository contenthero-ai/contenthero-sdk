import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modelResult } from './format.js'

/**
 * get_model says what an agent needs to choose a mode and a shot kind: before 2026-10-10 it listed neither, so an
 * agent could not discover Edit Video or Auto shots, though generate_video told it get_model described the modes.
 */
const textOf = (r: ReturnType<typeof modelResult>) => (r.content[0] as { text: string }).text

const model = (capabilities: Record<string, unknown>) =>
  ({
    modelId: 'm', displayName: 'M', contentType: 'video', kind: 'generate', description: null, tags: [],
    isDefault: false, capabilities, promptReferences: null,
  }) as unknown as Parameters<typeof modelResult>[0]

test('get_model lists each input mode with what it takes, its shots and whether it keeps the source length', () => {
  const text = textOf(modelResult(model({
    inputTypes: ['startFrame', 'singleVideo', 'imageRef'],
    inputModes: {
      selector: 'toggle', default: 'a',
      modes: [
        { id: 'a', label: 'A', inputTypes: ['startFrame'] },
        { id: 'b', label: 'B', inputTypes: ['singleVideo', 'imageRef'], shotKinds: ['single'], keepsInputLength: true },
      ],
    },
  })))
  assert.match(text, /Input modes \(inputMode on generate_video picks one; without it, the attached inputs decide\):/)
  assert.match(text, /\n    a \(A\): startFrame\n/)
  assert.match(text, /\n    b \(B\): singleVideo, imageRef; shots: single; output keeps the source video's length\n/)
})

test('get_model says how to ask for each shot kind, with the written-shot limits from the registry', () => {
  const text = textOf(modelResult(model({
    shotKinds: ['single', 'auto', 'custom'],
    multiShotConfig: { maxShots: 6, minShotDuration: 1, maxShotDuration: 12, maxCharsPerShot: 512 },
  })))
  assert.match(text, /\n  Shots: single, auto, custom\n/)
  assert.match(text, /\n    auto: pass multiShot; the model plans the cuts from the prompt\.\n/)
  assert.match(text, /\n    custom: pass shots; up to 6, each 1-12s and up to 512 chars\.\n/)
})

test('a model with one kind of shot and no modes gets neither block', () => {
  const text = textOf(modelResult(model({ shotKinds: ['single'] })))
  assert.doesNotMatch(text, /Shots:|Input modes/)
})

/** The registry's Kling 4.0 declaration (capabilities as the app emits them), so the printing is tested on the real shape. */
const KLING_4 = {
  inputTypes: ['startFrame', 'endFrame', 'imageRef', 'videoRef'],
  inputModes: {
    selector: 'toggle', default: 'startEndFrame', exclusive: true,
    modes: [
      { id: 'startEndFrame', label: 'Frames', inputTypes: ['startFrame', 'endFrame'] },
      { id: 'references', label: 'References', inputTypes: ['imageRef', 'videoRef'] },
    ],
  },
  maxKeyframes: 8, maxVoices: 3, maxVideoElements: 3,
  inputQuota: { total: 15, costs: { imageRef: 1, videoRef: 1, elements: 1, voices: 1 } },
  inputLimits: { videoInputsMax: 5, referenceVideoSec: { min: 2, max: 30 }, subjectVideo: { minSec: 3, maxSec: 8, minShortSidePx: 700 } },
  namedInputs: {
    namePattern: '^[A-Za-z0-9_]+$', nameRule: 'letters, digits, underscore or Chinese characters', nameMaxChars: 20, descriptionMaxChars: 100,
    reservedNamePatterns: ['^image_\\d+$', '^first_frame$'],
  },
  frameCountByDuration: [{ fromDuration: 3, maxFrames: 4 }, { fromDuration: 4, maxFrames: 5 }],
  settings: [{ key: 'keepOriginalSound', label: 'Keep original sound', control: 'toggle', default: false, appliesWhen: 'referenceVideo' }],
}

test('get_model prints the Kling 4.0 input fields: counts, quota, limits, name rules, frame table, exclusive modes and the declared setting', () => {
  const text = textOf(modelResult(model(KLING_4)))
  assert.match(text, /A request carries the inputs of one mode only; mixing modes is refused\./)
  assert.match(text, /\n  keyframes: up to 8\n/)
  assert.match(text, /\n  voices: up to 3\n/)
  assert.match(text, /\n  video subjects: up to 3\n/)
  assert.match(text, /shared input budget: 15 in all \(each counts: imageRef 1, videoRef 1, elements 1, voices 1\)/)
  assert.match(text, /videos in all \(reference videos and video subjects\): up to 5/)
  assert.match(text, /reference videos: each 2 to 30s/)
  assert.match(text, /video subjects: a single shot of 3 to 8s, shortest side at least 700 px/)
  assert.match(text, /frames \(first, middle and last together\) by duration: from 3s up to 4, from 4s up to 5/)
  assert.match(text, /names of subjects and voices \(one namespace\): a name is letters, digits, underscore or Chinese characters; up to 20 characters; a description up to 100/)
  assert.match(text, /reserved names, taken by the model's own tags: \^image_\\d\+\$, \^first_frame\$/)
  assert.match(text, /setting keepOriginalSound \(Keep original sound\): toggle, default false \(applies while a reference video is attached\)/)
})

test('a model that declares none of the Kling 4.0 fields prints none of their lines', () => {
  const text = textOf(modelResult(model({ inputTypes: ['startFrame'] })))
  assert.doesNotMatch(text, /keyframes:|voices:|shared input budget|reserved names|setting /)
})
