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
