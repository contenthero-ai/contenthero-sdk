import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectCreatedResult, projectListResult } from './format.js'

test('project replies name a project by its short id, the UUID when it has none, with its link once', () => {
  const p = { id: 'p-uuid', shortId: 'p1', type: 'editor', title: 'Reel', orientation: '9:16', width: 1080, height: 1920, revision: 0, appUrl: 'https://app/projects/p1' }
  const list = JSON.stringify(projectListResult({ projects: [p, { ...p, id: 'q-uuid', shortId: undefined }], nextCursor: null } as never))
  assert.match(list, /- p1 {2}\[editor\]/)
  assert.match(list, /- q-uuid {2}\[editor\]/)
  assert.doesNotMatch(list, /p-uuid/)
  const created = JSON.stringify(projectCreatedResult(p as never))
  assert.match(created, /project p1 \(appUrl https:\/\/app\/projects\/p1\)/)
  assert.doesNotMatch(created, /p-uuid/)
})
