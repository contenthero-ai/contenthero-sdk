import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { awaitLoopbackKey } from './auth.js'
import { CliError, EXIT } from '../errors.js'

const BASE = 'https://app.contenthero.ai'

/** Fire a GET at the loopback callback (no redirect-follow) and return status + location. */
function deliver(port: number, query: string): Promise<{ status: number; location?: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: `/callback?${query}`, method: 'GET' },
      (res) => {
        res.resume()
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, location: res.headers.location as string | undefined }),
        )
      },
    )
    req.on('error', reject)
    req.end()
  })
}

test('awaitLoopbackKey resolves with the key and 302-redirects to the styled done page', async () => {
  let delivered: Promise<{ status: number; location?: string }> | undefined
  const key = await awaitLoopbackKey({
    state: 'abc',
    redirectBase: BASE,
    onListening: (port) => {
      delivered = deliver(port, 'state=abc&key=ch_live_resolved')
    },
  })
  const redirect = await delivered!
  assert.equal(key, 'ch_live_resolved')
  assert.equal(redirect.status, 302)
  assert.equal(redirect.location, `${BASE}/cli/auth/done?status=connected`)
})

test('awaitLoopbackKey rejects (auth) and redirects to cancelled when the browser denies', async () => {
  let delivered: Promise<{ status: number; location?: string }> | undefined
  await assert.rejects(
    awaitLoopbackKey({
      state: 'abc',
      redirectBase: BASE,
      onListening: (port) => {
        delivered = deliver(port, 'state=abc&error=access_denied')
      },
    }),
    (err: unknown) => err instanceof CliError && err.exitCode === EXIT.AUTH,
  )
  const redirect = await delivered!
  assert.equal(redirect.location, `${BASE}/cli/auth/done?status=cancelled`)
})

test('a wrong-state callback is rejected (400) and ignored; the real one still wins', async () => {
  let wrongStatus = 0
  const key = await awaitLoopbackKey({
    state: 'right',
    redirectBase: BASE,
    onListening: async (port) => {
      wrongStatus = (await deliver(port, 'state=WRONG&key=ch_live_attacker')).status
      void deliver(port, 'state=right&key=ch_live_real')
    },
  })
  assert.equal(wrongStatus, 400)
  assert.equal(key, 'ch_live_real')
})

test('awaitLoopbackKey times out (auth) when no callback arrives', async () => {
  await assert.rejects(
    awaitLoopbackKey({ state: 'abc', redirectBase: BASE, timeoutMs: 50, onListening: () => {} }),
    (err: unknown) => err instanceof CliError && err.exitCode === EXIT.AUTH,
  )
})
