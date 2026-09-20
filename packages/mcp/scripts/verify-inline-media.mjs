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
 * What each medium MUST carry, in two layers.
 *
 * ⭐⭐⭐ **THE WIDGET IS THE PRIMARY SURFACE, FOR EVERY MEDIUM.** MCP has no video block, so blocks alone can
 * never render video. MCP Apps can, and one widget covering all three beats three special cases: the batch
 * case is exactly where the block path was already wrong, showing one variation of four.
 *
 * ⚠️ **BLOCKS REMAIN THE FALLBACK AND ARE STILL CHECKED.** A host without app support gets them, so losing
 * them would be a regression for those hosts. Image and audio have first-class blocks; video has none, so
 * its block expectation is legitimately empty rather than a poster standing in for the thing itself.
 *
 * ⛔ An earlier version of this file demanded a POSTER IMAGE BLOCK for video. That was a goalpost move: a
 * still frame is not a playing video, and treating it as equivalent would have declared the feature done
 * while it was not.
 */
/** Measured from Claude Desktop's own refusal: "Tool result is too large. Maximum size is 1MB." */
const HOST_RESULT_CEILING = 1_000_000

const EXPECTED = {
  image: { blocks: ['image'], why: 'an image block is the fallback for hosts without app support' },
  audio: { blocks: ['audio'], why: 'MCP has a first-class audio block and it plays inline' },
  video: { blocks: [], why: 'MCP has no video block; the widget is the only thing that can play it' },
}

/**
 * ⛔ `resource_link` IS DELIBERATELY ABSENT FROM EVERY EXPECTATION ABOVE.
 *
 * It was a third representation of a url that the text list and the widget's `structuredContent` both
 * already carry, and a host renders a run of them as `name: uri` with no separator, so url 1 ended flush
 * against filename 2 and anything splitting on whitespace read a corrupted token. Asserting its presence
 * would now pin the thing that was removed.
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
    const hasBlocks = want.blocks.every((b) => types.includes(b))
    const bytes = (res.content ?? [])
      .filter((c) => typeof c.data === 'string')
      .reduce((a, c) => a + c.data.length, 0)
    // ⭐ THE WIDGET IS THE PART THAT RENDERS VIDEO, so it is checked for EVERY medium, not just video.
    // `structuredContent` is what the widget reads; `_meta` is what tells the host to mount it. One without
    // the other renders nothing, and each fails silently on its own.
    const meta = res._meta ?? {}
    const boundTo = meta['ui/resourceUri'] ?? meta.ui?.resourceUri
    const feeds = Array.isArray(res.structuredContent?.outputs) && res.structuredContent.outputs.length > 0
    /**
     * ⛔⛔ THE SIZE OF THE WHOLE RESULT, MEASURED, NOT THE SIZE OF THE BLOCKS.
     *
     * Claude Desktop rejects a result over 1 MB outright with "Tool result is too large", which fails the
     * CALL rather than degrading the picture: the generation is charged and unreachable. That happened in
     * production on 2026-09-19 and no assertion here could see it, because every check was about which
     * BLOCKS were present rather than how big the envelope was.
     */
    const wireBytes = Buffer.byteLength(JSON.stringify(res))
    const overCeiling = wireBytes > HOST_RESULT_CEILING
    const hasWidget = Boolean(boundTo && feeds)
    /**
     * ⭐⭐ **WHAT ACTUALLY HAS TO HOLD: THE WIDGET RENDERS IT, AND THE RESULT FITS.**
     *
     * A fallback block is a BONUS for hosts that cannot mount an app, and for a large asset it legitimately
     * cannot exist: a 2.4 MB voiceover encodes past any budget that fits inside a 1 MB result. Failing on
     * that would be demanding the impossible, and a check that cannot be satisfied gets switched off.
     *
     * ⛔ The two real failures stay failures: no widget (nothing renders anywhere), and over the ceiling
     * (the host REJECTS the call, so the person pays for a generation they cannot reach).
     */
    const has = hasWidget && !overCeiling
    const widget = hasWidget ? 'widget' : boundTo ? 'BOUND BUT NO DATA' : feeds ? 'DATA BUT UNBOUND' : 'NO WIDGET'
    const note = has && want.blocks.length && !hasBlocks ? '  (link-only: too large to inline)' : ''
    /**
     * ⭐⭐ THE CHIP, PRINTED RATHER THAN INFERRED.
     *
     * `modelName` is null BY DESIGN when the server could not name the model, because a model id reads like
     * a label and printing one turned a lookup failure into a chip that flickered between kebab case and
     * title case with nothing logged anywhere. Null is therefore a legitimate answer here, not a failure,
     * and the only way to tell "the server sent no name" from "the widget dropped it" is to look.
     *
     * ⚠️ A deployment that does not yet return `modelDisplayName` prints `chip=-` on every row. That is the
     * expected reading until the app ships, not a regression to chase.
     */
    const sc = res.structuredContent ?? {}
    const chip =
      `chip=${sc.modelName ?? '-'}${sc.modelBrandColor ? ` ${sc.modelBrandColor}` : ''}` +
      `${sc.modelIconKey ? `/${sc.modelIconKey}` : ''}` +
      `  ar=${sc.displayAspect ?? '-'}  prompt=${sc.prompt ? `${String(sc.prompt).length}ch` : '-'}`
    console.log(
      `  ${medium.padEnd(6)} ${has ? 'OK  ' : 'FAIL'}  blocks=[${types.join(', ')}]` +
        `  wire=${(wireBytes / 1024).toFixed(0)}KB${overCeiling ? ' OVER CEILING' : ''}  ${widget}  ${chip}${note}`,
    )
    if (!has) {
      failures += 1
      if (overCeiling)
        console.log(
          `         ${(wireBytes / 1024).toFixed(0)}KB exceeds the ${(HOST_RESULT_CEILING / 1024).toFixed(0)}KB a host accepts; it will REJECT the call, not shrink it`,
        )
      if (!hasWidget) console.log('         the WIDGET is missing: needs both _meta.ui.resourceUri and structuredContent.outputs')
      if (!hasBlocks) console.log(`         no ${want.blocks.join(' + ')} fallback: ${want.why}`)
    }
  }
} finally {
  child.kill()
}

console.log(failures ? `\n${failures} medium(s) would not render inline.` : '\nEvery medium carries something a host can render.')
process.exit(failures ? 1 : 0)
