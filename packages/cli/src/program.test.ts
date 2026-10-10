import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Command } from 'commander'
import { buildProgram } from './program.js'
import { CliError, EXIT } from './errors.js'
import { isRunnable } from './commands/schema.js'

/** Names of the immediate subcommands of a named top-level group. */
function subcommands(group: string): string[] {
  const program = buildProgram()
  const cmd = program.commands.find((c) => c.name() === group)
  assert.ok(cmd, `group ${group} is registered`)
  return cmd!.commands.map((c) => c.name())
}

test('every top-level command group is registered', () => {
  const names = buildProgram().commands.map((c) => c.name())
  for (const expected of [
    'auth',
    'login',
    'logout',
    'config',
    'account',
    'model',
    'generate',
    'upscale',
    'transcribe',
    'generation-status',
    'media',
    'card',
    'post',
    'tag',
    'stage',
    'space',
    'brand-kit',
    'avatar',
    'voice',
    'content',
    'tracked-account',
    'connected-account',
    'schema',
    'favorite',
    'archive',
    'project',
  ]) {
    assert.ok(names.includes(expected), `missing top-level command: ${expected}`)
  }
})

test('project exposes get + apply', () => {
  const subs = subcommands('project')
  assert.ok(subs.includes('get'), 'project should have a get subcommand')
  assert.ok(subs.includes('apply'), 'project should have an apply subcommand')
})

test('generation-status exposes get only, with wait folded into a flag', () => {
  assert.deepEqual(subcommands('generation-status'), ['get'])
  // `generation wait` was this command over an array with blocking on: the two differed by a default, not by
  // what they did. The direction is --no-wait now.
  const cmd = buildProgram().commands.find((c) => c.name() === 'generation-status')!
  const get = cmd.commands.find((c) => c.name() === 'get')!
  assert.ok(get.options.some((o) => o.long === '--no-wait'))
})

test('generate exposes the five generation subcommands', () => {
  const subs = subcommands('generate')
  for (const n of ['image', 'video', 'audio', 'board', 'lip-sync']) {
    assert.ok(subs.includes(n), `generate is missing: ${n}`)
  }
})

test('card exposes its verbs, with posts and assets folded into update', () => {
  const subs = subcommands('card')
  for (const n of ['list', 'get', 'create', 'update']) {
    assert.ok(subs.includes(n), `card is missing: ${n}`)
  }
  // Archiving moved to the universal top-level `archive` command.
  assert.ok(!subs.includes('archive'), 'card should no longer have its own archive subcommand')
  // Seven operations edited one document. Destinations and assets are now declarative fields on update,
  // and the schedule is `--schedule` on it, so these groups are gone.
  for (const n of ['destination', 'asset', 'schedule']) {
    assert.ok(!subs.includes(n), `card should no longer have a ${n} subcommand`)
  }
  // publish_post KEEPS its own command, named after it: irreversible external side effects do not belong in a patch.
  assert.ok(!subs.includes('publish'), 'publishing is `post publish`, named after publish_post')
  assert.deepEqual(subcommands('post'), ['publish'])
})

test('brand-kit exposes its verbs, with sections folded into update', () => {
  const subs = subcommands('brand-kit')
  for (const n of ['list', 'get', 'create', 'extract', 'update']) {
    assert.ok(subs.includes(n), `brand-kit is missing: ${n}`)
  }
  // The whole-list reorder is retired (9.9, the ordering contract): a kit moves by itself on `update`.
  assert.ok(!subs.includes('reorder'), 'brand-kit reorder was retired; a kit moves with update --after/--before/--position')
  // Sections are a declarative field on create/update now, keyed by (tab, sectionName).
  assert.ok(!subs.includes('section'), 'brand-kit should no longer have a section subcommand')
  // Knowledge STAYS its own group: an ingest-and-embed corpus read by similarity is not a property of
  // the document, so declaring the set would mean re-embedding to add one note.
  assert.ok(subs.includes('knowledge'))
  // Archiving moved to the universal top-level `archive` command.
  assert.ok(!subs.includes('archive'), 'brand-kit should no longer have its own archive subcommand')
})

test('avatar is a full CRUD surface and voice is still read-only', () => {
  // ⚠️ THE ASYMMETRY IS DELIBERATE, NOT AN OVERSIGHT. Avatars became writable in Phase 7; voice
  // creation stays in the app because only avatars had a demonstrated agent use case. Asserting
  // voice's shape too is what makes a later accidental voice write show up as a decision.
  assert.deepEqual(subcommands('avatar').sort(), ['create', 'delete', 'get', 'list', 'look', 'update'])
  assert.deepEqual(subcommands('voice').sort(), ['get', 'list'])
})

test('avatar look add/remove exist as their own verbs', () => {
  const look = buildProgram()
    .commands.find((c) => c.name() === 'avatar')!
    .commands.find((c) => c.name() === 'look')
  assert.ok(look, 'avatar look is registered')
  assert.deepEqual(look!.commands.map((c) => c.name()).sort(), ['add', 'remove'])
})

test('avatar create requires the traits the prompt writer needs, and offers --cost', () => {
  // age and gender are REQUIRED because the generator writes the portrait prompt from them. If they
  // ever become optional the model has nothing to describe and produces a generic face.
  const create = buildProgram()
    .commands.find((c) => c.name() === 'avatar')!
    .commands.find((c) => c.name() === 'create')!
  // ⚠️ `o.mandatory` ONLY. In Commander `o.required` means the option takes a VALUE (`--age <age>`
  // rather than `--age [age]`), which is true of an optional flag too. Filtering on `required ||
  // mandatory` passed identically after `requiredOption` was downgraded to `option`, so the first
  // version of this test could not fail. Caught by breaking it on purpose.
  const mandatory = create.options.filter((o) => o.mandatory).map((o) => o.long)
  assert.ok(mandatory.includes('--age'), '--age must be required')
  assert.ok(mandatory.includes('--gender'), '--gender must be required')
  // Creating an avatar spends credits, so it gets the same preflight every generating command has.
  assert.ok(create.options.some((o) => o.long === '--cost'), 'create must offer --cost')
})

test('universal status verbs are registered, each taking --off and naming media by id alone', () => {
  const program = buildProgram()
  for (const name of ['favorite', 'archive']) {
    const cmd = program.commands.find((c) => c.name() === name)
    assert.ok(cmd, `missing top-level command: ${name}`)
    // The output is named in the media id itself (a1B2c3D4-2), so no number travels beside it (7.44).
    assert.ok(
      !cmd!.options.some((o) => o.long === '--variation'),
      `${name} must not take --variation`,
    )
    // --off is what replaced the inverse commands: the direction is an argument, not a name.
    assert.ok(cmd!.options.some((o) => o.long === '--off'), `${name} should accept --off`)
  }
  for (const gone of ['unfavorite', 'unarchive']) {
    assert.ok(
      !program.commands.some((c) => c.name() === gone),
      `${gone} should no longer be its own command`,
    )
  }
})

test('generate image and board expose --avatar, so a generation can file itself against an avatar', () => {
  // The API has accepted `avatarId` on both endpoints since avatar looks landed. No client advertised it,
  // so generating a new LOOK for a character had no path outside the browser. That gap is invisible from
  // either side alone: the server looks complete and the CLI looks internally consistent.
  const generate = buildProgram().commands.find((c) => c.name() === 'generate')!
  for (const name of ['image', 'board']) {
    const cmd = generate.commands.find((c) => c.name() === name)
    assert.ok(cmd, `generate ${name} is registered`)
    assert.ok(
      cmd!.options.some((o) => o.long === '--avatar'),
      `generate ${name} should accept --avatar`,
    )
  }
})

test('media and brand-kit list expose the favorite/archived filters', () => {
  const program = buildProgram()
  const mediaList = program.commands
    .find((c) => c.name() === 'media')!
    .commands.find((c) => c.name() === 'list')!
  const mediaFlags = mediaList.options.map((o) => o.long)
  assert.ok(mediaFlags.includes('--favorite') && mediaFlags.includes('--archived'))
  assert.ok(mediaFlags.includes('--source'), 'media list exposes --source')

  const mediaGet = program.commands
    .find((c) => c.name() === 'media')!
    .commands.find((c) => c.name() === 'get')!
  assert.ok(mediaGet.options.map((o) => o.long).includes('--source'), 'media get exposes --source')

  const kitList = program.commands
    .find((c) => c.name() === 'brand-kit')!
    .commands.find((c) => c.name() === 'list')!
  const kitFlags = kitList.options.map((o) => o.long)
  assert.ok(kitFlags.includes('--favorite') && kitFlags.includes('--archived'))
})

test('model exposes list + get; platforms are read through schema', () => {
  assert.deepEqual(subcommands('model').sort(), ['get', 'list'])
  // One reference command replaced the platform group and three project commands (agreed 2026-09-28).
  const names = buildProgram().commands.map((c) => c.name())
  assert.ok(!names.includes('platform'))
  for (const gone of ['export-formats', 'layer-types', 'timeline-types']) assert.ok(!subcommands('project').includes(gone))
})

test('content and tracked-account each expose list + get', () => {
  // The research surface used to be `inspiration accounts|account|outliers|content` plus a separate
  // `brand-account list|performance`: two command groups over one table, split by account_type.
  for (const group of ['content', 'tracked-account']) {
    const subs = subcommands(group)
    for (const n of ['list', 'get']) {
      assert.ok(subs.includes(n), `${group} is missing: ${n}`)
    }
  }
  assert.ok(!buildProgram().commands.map((c) => c.name()).includes('inspiration'))
  assert.ok(!buildProgram().commands.map((c) => c.name()).includes('brand-account'))
})

test('schema dumps a scoped command with its options, needing no key', async () => {
  const program = buildProgram()
  program.exitOverride()
  const chunks: string[] = []
  const orig = process.stdout.write.bind(process.stdout)
  ;(process.stdout as { write: unknown }).write = (s: string) => {
    chunks.push(String(s))
    return true
  }
  try {
    await program.parseAsync(['node', 'contenthero', 'schema', 'get', 'commands', 'generate', 'image'])
  } finally {
    ;(process.stdout as { write: unknown }).write = orig
  }
  const dumped = JSON.parse(chunks.join('')) as {
    globalOptions: Array<{ flags: string }>
    commands: Array<{ command: string; options: Array<{ flags: string; required: boolean }> }>
  }
  assert.equal(dumped.commands.length, 1)
  assert.equal(dumped.commands[0]?.command, 'generate image')
  const model = dumped.commands[0]?.options.find((o) => o.flags.includes('--model'))
  assert.ok(model?.required, 'model option is marked required')
  assert.ok(dumped.globalOptions.some((o) => o.flags.includes('--api-key')))
})

/**
 * ⭐ THE CLI TRACKS THE MCP, AND THIS IS THE RATCHET FOR IT.
 *
 * The standing rule is that every MCP tool gets equal CLI coverage, and it had been enforced by
 * remembering. Stage writes are the case that made it worth ratcheting: `/api/v1/stages` was read-only,
 * so all three published surfaces had `list` and nothing else, and the two write surfaces were added
 * together rather than one now and one later.
 */
test('stage is a full CRUD surface, matching the MCP stage tools one for one', () => {
  assert.deepEqual(subcommands('stage').sort(), ['create', 'delete', 'list', 'update'])
})

/**
 * 🚨 `--space` IS REQUIRED ON THE WRITES TO AN EXISTING COLUMN, AND THAT IS THE WHOLE DEFECT THIS
 * WORKSTREAM OPENED WITH. A stage id alone does not name a board; the server used to default it to the
 * account's OLDEST space, so a rename aimed at any other board matched zero rows and reported success.
 *
 * ⚠️ `create` IS DELIBERATELY EXEMPT. Creating into "the account's default board" is a meaningful
 * answer; changing an existing column is not, because its id already decided which board it is on.
 */
test('stage update and delete require a board, and create does not', () => {
  const stage = buildProgram().commands.find((c) => c.name() === 'stage')!
  const spaceOption = (name: string) => {
    const cmd = stage.commands.find((c) => c.name() === name)
    assert.ok(cmd, `stage ${name} is registered`)
    const opt = cmd!.options.find((o) => o.long === '--space')
    assert.ok(opt, `stage ${name} takes --space`)
    return opt!
  }
  /*
    ⚠️ `mandatory`, NOT `required`. In commander `required` means the FLAG TAKES A VALUE, which is true
    of `--space <id>` however it was declared, so the first version of this test passed for both the
    right and the wrong reason and could not have caught `requiredOption` being downgraded to `option`.
    `mandatory` is the one that means "the flag must be present".
  */
  assert.equal(spaceOption('update').mandatory, true, 'a rename must name its board')
  assert.equal(spaceOption('delete').mandatory, true, 'a delete must name its board')
  assert.notEqual(spaceOption('create').mandatory, true, 'creating may fall back to the default board')
})

/**
 * ⚠️ AN EDGE NEEDS ITS OWN FLAG. "--after with no value" cannot be told apart from "--after omitted",
 * and the two mean opposite things: omitting both anchors leaves the column where it is, while moving
 * to the far left is an explicit null on the wire. `space update --no-cover` exists for the same reason.
 */
test('stage update says "move it to an end" with --position, separately from "do not move it"', () => {
  const update = buildProgram()
    .commands.find((c) => c.name() === 'stage')!
    .commands.find((c) => c.name() === 'update')!
  const longs = update.options.map((o) => o.long)
  assert.ok(longs.includes('--position'), 'an end needs a way to be said')
  assert.ok(!longs.includes('--to-start') && !longs.includes('--to-end'), 'one placement wording: --position, not edge flags')
})

/**
 * Each command is named after its MCP tool, with no hidden alias for the old name (a hard cutover). Break-verified:
 * registering any old name back turns this red.
 */
test('the old command names are gone', () => {
  const program = buildProgram()
  const find = (path: string) =>
    path.split(' ').reduce<Command | undefined>((cmd, name) => cmd?.commands.find((c) => c.name() === name), program)
  for (const old of [
    'context',
    'generation',
    'project export-status',
    'project exports',
    'project undo',
    'project redo',
    'project version copy',
    'project version rename',
    'tag remove',
    'card publish',
  ]) {
    assert.equal(find(old), undefined, `${old} is still registered`)
  }
  // `schema <kind>` and `project transcript <projectId>` became groups: they no longer run on their own.
  for (const group of ['schema', 'project transcript', 'project edit', 'generation-status', 'post']) {
    assert.equal(isRunnable(find(group)!), false, `${group} runs on its own`)
  }
  for (const current of ['view', 'generation-status get', 'project export', 'project export get', 'project export list', 'project transcript get', 'project edit undo', 'project edit redo', 'project version update', 'tag delete', 'post publish', 'schema get']) {
    assert.ok(find(current) && isRunnable(find(current)!), current)
  }
})

// A flag a kind does not take is refused, not ignored, like --platform and --format.
test('schema refuses --json-schema for a kind other than timeline or layer', async () => {
  const program = buildProgram()
  program.exitOverride()
  await assert.rejects(
    program.parseAsync(['node', 'contenthero', 'schema', 'get', 'export', '--json-schema']),
    (err: unknown) => err instanceof CliError && err.exitCode === EXIT.USAGE && /takes no --json-schema/.test(err.message),
  )
})
