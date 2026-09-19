#!/usr/bin/env node
/**
 * What does a host actually RECEIVE for a finished generation, per medium?
 *
 * ## Why this exists
 *
 * `resource_link` attachments shipped to production and rendered in NEITHER ChatGPT nor Claude: one showed
 * a hyperlink that opened a new tab, the other showed nothing at all. Every unit test passed throughout,
 * because they all handed the formatter an attachment array built by hand. Nothing asserted what the SERVER
 * emits over the wire.
 *
 * ⭐⭐⭐ **THE POINT IS TO CLOSE THE LOOP WITHOUT A RELEASE.** Finding this cost a publish, a pin, a deploy
 * and a manual test in two hosts. This speaks real MCP to the real built server against the real API, so the
 * same question is answered in about ten seconds from a rebuild.
 *
 * ⚠️ **IT SPENDS NO CREDITS.** It reads generations that already exist by id, through `get_generation_status`,
 * which is the same formatter path a fresh generation returns. Verifying the output shape must never cost
 * money, or it stops being run.
 *
 * ## Usage
 *
 *   npm run build -w @contenthero/mcp
 *   node packages/mcp/scripts/verify-inline-media.mjs <imageOutputId> <videoOutputId> <audioOutputId>
 *
 * Any id may be omitted. Exits non-zero if a medium does not carry what it should.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ENTRY = join(HERE, '..', 'dist', 'index.js')

/**
 * What each medium MUST carry.
 *
 * ⛔ A LINK ALONE IS A FAILURE, not a smaller success. That was the shipped behavior and the feature did not
 * work. MCP's content union is `text | image | audio | resource_link | resource`: image and audio have
 * first-class blocks, video has none, so a video's inline representation is its POSTER as an image block.
 */
const EXPECTED = {
  image: { blocks: ['image'], why: 'an image block is the only thing a host renders' },
  audio: { blocks: ['audio'], why: 'MCP has a first-class audio block and it plays inline' },
  video: { blocks: ['image'], why: 'MCP has no video block, so the poster frame stands in for it' },
}

/**
 * ⚠️⚠️ **A LINE-DELIMITED PROTOCOL NEEDS A LINE BUFFER, AND THIS DID NOT HAVE ONE.**
 *
 * The first version parsed each `data` chunk on its own. That works for small text replies, which arrive in
 * a single chunk, and breaks the moment a reply is big, because a base64 image spans many chunks and no
 * individual one is valid JSON. So the harness started timing out at exactly the point the feature it
 * verifies began working, and the symptom (a hang) pointed at the server rather than at the reader.
 *
 * ⭐ The accumulate-then-split version is also the only one that can report an inline size, which is the
 * number worth watching.
 */
function rpc(child, id, method, params) {
  return new Promise((resolve, reject) => {
    let buf = ''
    const onData = (chunk) => {
      buf += chunk
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        if (!line.trim()) continue
        let msg
        try { msg = JSON.parse(line) } catch { continue }
        if (msg.id !== id) continue
        child.stdout.off('data', onData)
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
        return
      }
    }
    child.stdout.on('data', onData)
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    setTimeout(() => { child.stdout.off('data', onData); reject(new Error(`${method} timed out`)) }, 90_000)
  })
}

const ids = { image: process.argv[2], video: process.argv[3], audio: process.argv[4] }
const child = spawn('node', [ENTRY], {
  env: {
    ...process.env,
    CONTENTHERO_BASE_URL: process.env.CONTENTHERO_BASE_URL || 'https://app.contenthero.ai',
    CONTENTHERO_CONFIG_DIR: process.env.CONTENTHERO_CONFIG_DIR || join(process.env.HOME, '.contenthero'),
  },
  stdio: ['pipe', 'pipe', 'inherit'],
})

let failures = 0
try {
  // ⚠️⚠️ SETTLE BEFORE THE FIRST WRITE. The server prints its banner BEFORE attaching a stdin reader, so a
  // request sent the instant it announces itself is dropped and every later call waits forever. That looked
  // exactly like a hung server and cost two wrong hypotheses, including a fetch timeout added to fix a hang
  // that was never there. (The timeout is worth keeping on its own merits; it just was not this.)
  await new Promise((r) => setTimeout(r, 3000))
  await rpc(child, 1, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'verify-inline-media', version: '1' },
  })
  await new Promise((r) => setTimeout(r, 1500))
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')

  let n = 10
  for (const [medium, outputId] of Object.entries(ids)) {
    if (!outputId) { console.log(`  ${medium.padEnd(6)} SKIPPED (no id given)`); continue }
    const res = await rpc(child, n++, 'tools/call', {
      name: 'get_generation_status',
      // ⚠️ `outputIds`, PLURAL. The first version of this script passed `outputId` and the server answered
      // with a validation error that the script then reported as "no blocks", which looks identical to the
      // defect it exists to find. A harness that cannot tell a wrong call from a real failure is worse than
      // none, so the text of any non-media result is printed below rather than summarized away.
      arguments: { outputIds: [outputId] },
    })
    const firstText = (res.content ?? []).find((c) => c.type === 'text')?.text ?? ''
    if (/^MCP error|validation error/i.test(firstText)) {
      console.log(`  ${medium.padEnd(6)} ERROR the call itself failed: ${firstText.slice(0, 120)}`)
      failures += 1
      continue
    }
    const types = (res.content ?? []).map((c) => c.type)
    const want = EXPECTED[medium]
    const has = want.blocks.every((b) => types.includes(b))
    const bytes = (res.content ?? [])
      .filter((c) => typeof c.data === 'string')
      .reduce((a, c) => a + c.data.length, 0)
    console.log(
      `  ${medium.padEnd(6)} ${has ? 'OK  ' : 'FAIL'}  blocks=[${types.join(', ')}]` +
        `${bytes ? `  inline=${(bytes / 1024).toFixed(0)}KB` : ''}`,
    )
    if (!has) {
      failures += 1
      console.log(`         expected a ${want.blocks.join(' + ')} block: ${want.why}`)
    }
  }
} finally {
  child.kill()
}

console.log(failures ? `\n${failures} medium(s) would not render inline.` : '\nEvery medium carries something a host can render.')
process.exit(failures ? 1 : 0)
