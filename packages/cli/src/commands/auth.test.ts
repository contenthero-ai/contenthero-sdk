import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { awaitLoopbackKey } from './auth.js'
import { CliError, EXIT } from '../errors.js'

/** Fire a GET at the loopback callback and resolve with its HTTP status. */
function deliver(port: number, query: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/callback?${query}`, (res) => {
      res.resume()
      res.on('end', () => resolve(res.statusCode ?? 0))
    })
    req.on('error', reject)
  })
}

test('awaitLoopbackKey resolves with the key the browser hands back', async () => {
  const key = await awaitLoopbackKey({
    state: 'abc',
    onListening: (port) => {
      void deliver(port, 'state=abc&key=ch_live_resolved')
    },
  })
  assert.equal(key, 'ch_live_resolved')
})

test('awaitLoopbackKey rejects (auth) when the browser denies', async () => {
  await assert.rejects(
    awaitLoopbackKey({
      state: 'abc',
      onListening: (port) => {
        void deliver(port, 'state=abc&error=access_denied')
      },
    }),
    (err: unknown) => err instanceof CliError && err.exitCode === EXIT.AUTH,
  )
})

test('a wrong-state callback is rejected (400) and ignored; the real one still wins', async () => {
  let wrongStatus = 0
  const key = await awaitLoopbackKey({
    state: 'right',
    onListening: async (port) => {
      wrongStatus = await deliver(port, 'state=WRONG&key=ch_live_attacker')
      void deliver(port, 'state=right&key=ch_live_real')
    },
  })
  assert.equal(wrongStatus, 400)
  assert.equal(key, 'ch_live_real')
})

test('awaitLoopbackKey times out (auth) when no callback arrives', async () => {
  await assert.rejects(
    awaitLoopbackKey({ state: 'abc', timeoutMs: 50, onListening: () => {} }),
    (err: unknown) => err instanceof CliError && err.exitCode === EXIT.AUTH,
  )
})
