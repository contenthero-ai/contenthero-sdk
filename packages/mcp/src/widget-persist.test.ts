import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cardKey, isUnfinished, loadCard, mergePoll, preferSaved, saveCard, type CardPayload } from '../widget/src/persist.js'

/** A Storage stand-in, so the load and save paths run without a browser. */
function memoryStore(): Storage {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  }
}

const pending: CardPayload = { outputId: 'out-1', status: 'processing', expected: 2 }
const done: CardPayload = {
  outputId: 'out-1',
  status: 'completed',
  items: [{ url: 'https://media.contenthero.ai/a' }, { url: 'https://media.contenthero.ai/b' }],
}

/**
 * ⭐⭐⭐ The remount case: the host replays the pending result the call returned, and the card already watched
 * that job finish. The saved terminal state must win, so the card does not go back to skeletons or poll again.
 */
test('a saved terminal card beats a replayed processing result, and keeps expected', () => {
  const merged = preferSaved(pending, done)
  assert.equal(merged.status, 'completed')
  assert.equal(merged.items?.length, 2)
  assert.equal(merged.expected, 2, 'only the pending result knew how many were asked for')
  assert.equal(isUnfinished(merged), false, 'nothing left to poll')
})

test('a saved partial beats a replayed pending result with fewer tiles, and still polls', () => {
  const partial: CardPayload = { ...pending, items: [{ url: 'https://media.contenthero.ai/a' }] }
  const merged = preferSaved(pending, partial)
  assert.equal(merged.items?.length, 1)
  assert.equal(isUnfinished(merged), true)
})

test('a fresher incoming result beats a stale saved one, and a tie goes to the host', () => {
  assert.equal(preferSaved(done, pending).status, 'completed')
  const hostCopy = { ...done }
  assert.equal(preferSaved(hostCopy, { ...done }), hostCopy)
})

test('nothing saved, or a different card saved, leaves the incoming result alone', () => {
  assert.equal(preferSaved(pending, null), pending)
  assert.equal(preferSaved(pending, { ...done, outputId: 'out-2' }), pending)
})

test('the key comes from the result: the output id at every stage, else the items', () => {
  assert.equal(cardKey(pending), cardKey(done), 'a pending result and the finished one share a key')
  const set: CardPayload = { items: [{ url: 'u1', reference: 'r1' }, { url: 'u2' }] }
  assert.ok(cardKey(set))
  assert.equal(cardKey(set), cardKey({ items: [{ url: 'other', reference: 'r1' }, { url: 'u2' }] }))
  assert.notEqual(cardKey(set), cardKey({ items: [{ url: 'u2' }] }))
  assert.equal(cardKey({}), null, 'nothing stable to key on means nothing is saved')
})

test('a poll answer is merged over the card and keeps the original expected count', () => {
  const answer: CardPayload = { outputId: 'out-1', status: 'processing', items: [{ url: 'a' }] }
  const merged = mergePoll(pending, answer)
  assert.equal(merged.items?.length, 1)
  assert.equal(merged.expected, 2)
})

test('save then load round-trips, and a broken store reads as nothing saved', () => {
  const store = memoryStore()
  const key = cardKey(done)
  saveCard(key, { data: done, loaded: ['https://media.contenthero.ai/a'] }, store)
  const back = loadCard(key, store)
  assert.deepEqual(back, { data: done, loaded: ['https://media.contenthero.ai/a'] })

  const throwing = { ...memoryStore(), getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } } as Storage
  assert.doesNotThrow(() => saveCard(key, { data: done, loaded: [] }, throwing))
  assert.equal(loadCard(key, throwing), null)
  store.setItem(key!, 'not json')
  assert.equal(loadCard(key, store), null)
})
