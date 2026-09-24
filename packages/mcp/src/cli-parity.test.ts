import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Command } from 'commander'
import { buildServer } from './server.js'
import { buildProgram } from '../../cli/src/program.js'

/**
 * ⭐⭐⭐ MCP / CLI PARITY, ENFORCED RATHER THAN REMEMBERED.
 *
 * The MCP server and the CLI are two front ends over the same SDK, and the owner's standing rule is that neither
 * can do something the other cannot. Parity used to be checked by eye at review time, and gaps kept slipping
 * through: on 2026-09-24 the CLI's `--search` still described a plain text match after the MCP was updated for
 * relevance search. This test reads BOTH surfaces as they actually register (the MCP tool list over an in-memory
 * transport, the CLI's commander tree) and fails when:
 *
 *  1. an MCP tool is neither mapped to CLI command(s) nor declared MCP-only with a reason;
 *  2. a mapped tool has an input no mapped command expresses, and it is not a declared known gap;
 *  3. a CLI command is neither the target of a tool nor declared CLI-only with a reason;
 *  4. any entry below names a tool, input, command or flag that no longer exists (so this file cannot rot into a
 *     list of stale excuses), or a known gap has since been closed (so the gap list only ever shrinks honestly).
 *
 * HOW AN INPUT IS MATCHED. First by the CLI's naming conventions (NAMING_RULES, applied to every tool), then by a
 * per-tool alias. A convention is a rule the CLI follows everywhere, so it lives once here instead of being
 * repeated per tool; an alias is a genuine one-off.
 *
 * ⚠️ WHAT THIS DOES NOT CHECK: wording (a flag can exist and describe the wrong behavior), and inputs nested
 * inside an object (only top-level inputs are compared). Both still need a reviewer.
 *
 * Lives in the MCP package because that is where tools are added; it imports the CLI's program from source.
 */

type Leaf = { path: string; flags: Set<string> }

/** MCP tool -> the CLI command(s) that together express it. */
const TOOL_TO_CLI: Record<string, string[]> = {
  generate_image: ['generate image'],
  generate_board: ['generate board'],
  generate_video: ['generate video'],
  generate_audio: ['generate audio'],
  edit_audio: ['audio isolate', 'audio enhance', 'audio enhance-clips'],
  upscale: ['upscale'],
  generate_lip_sync: ['generate lip-sync'],
  transcribe: ['transcribe'],
  list_avatars: ['avatar list'],
  get_avatar: ['avatar get'],
  create_avatar: ['avatar create'],
  update_avatar: ['avatar update', 'avatar look add', 'avatar look remove'],
  delete_avatar: ['avatar delete'],
  list_voices: ['voice list'],
  get_voice: ['voice get'],
  list_brand_kits: ['brand-kit list'],
  get_brand_kit: ['brand-kit get'],
  create_brand_kit: ['brand-kit create'],
  update_brand_kit: ['brand-kit update', 'brand-kit extract', 'brand-kit reorder'],
  search_brand_knowledge: ['brand-kit knowledge search'],
  list_brand_knowledge: ['brand-kit knowledge list'],
  get_brand_knowledge: ['brand-kit knowledge get'],
  add_brand_knowledge: ['brand-kit knowledge add'],
  remove_brand_knowledge: ['brand-kit knowledge remove'],
  list_media: ['media list'],
  search_media: ['media search'],
  get_media: ['media get', 'media watch'],
  create_media_upload: ['media upload'],
  complete_media_upload: ['media upload'],
  import_media: ['media import'],
  list_folders: ['folder list'],
  get_folder: ['folder get'],
  create_folder: ['folder create'],
  update_folder: ['folder update'],
  delete_folder: ['folder delete'],
  list_models: ['model list'],
  get_model: ['model get'],
  list_platforms: ['platform list'],
  get_platform: ['platform get'],
  list_elements: ['element list'],
  get_element: ['element get'],
  create_element: ['element create'],
  update_element: ['element update'],
  delete_element: ['element delete'],
  get_generation_status: ['generation status'],
  list_cards: ['card list'],
  get_card: ['card get'],
  create_card: ['card create'],
  update_card: ['card update'],
  publish_post: ['card publish'],
  list_spaces: ['space list'],
  get_space: ['space get'],
  create_space: ['space create'],
  update_space: ['space update'],
  delete_space: ['space delete'],
  list_stages: ['stage list'],
  create_stage: ['stage create'],
  update_stage: ['stage update'],
  delete_stage: ['stage delete'],
  list_tags: ['tag list'],
  create_tag: ['tag create'],
  update_tag: ['tag update'],
  delete_tag: ['tag remove'],
  list_accounts: ['tracked-account list'],
  get_account: ['tracked-account get'],
  list_content: ['content list'],
  get_content: ['content get'],
  list_connected_accounts: ['connected-account list'],
  get_connected_account: ['connected-account get'],
  get_balance: ['account balance'],
  favorite: ['favorite'],
  archive: ['archive'],
  list_projects: ['project list'],
  get_project: ['project get'],
  create_project: ['project create'],
  import_project: ['project import'],
  export_project: ['project export'],
  get_export: ['project export-status'],
  get_export_formats: ['project export-formats'],
  delete_project: ['project delete'],
  get_transcript: ['project transcript'],
  get_layer_types: ['project layer-types'],
  get_timeline_types: ['project timeline-types'],
  update_timeline: ['project apply'],
  update_canvas: ['project apply'],
  get_context: ['context', 'preview'],
  get_preview: ['preview'],
}

/** Tools with no CLI counterpart, BY DESIGN. */
const MCP_ONLY: Record<string, string> = {
  show_media: 'renders an inline widget in the chat host; a terminal has no equivalent display surface',
}

/** CLI commands with no MCP counterpart, BY DESIGN. */
const CLI_ONLY: Record<string, string> = {
  'auth login': 'terminal credential storage; an MCP host authenticates the connection itself',
  'auth status': 'terminal credential storage',
  'auth logout': 'terminal credential storage',
  login: 'alias of auth login',
  logout: 'alias of auth logout',
  'config list': 'local CLI configuration file',
  'config set': 'local CLI configuration file',
  'config path': 'local CLI configuration file',
  schema: "introspects the CLI's own commands for agents; MCP hosts get tool schemas from the protocol",
}

/**
 * The CLI's naming conventions for recurring MCP inputs, applied to EVERY tool. Each returns candidate flags or
 * positionals (`<name>`); an input matches when any candidate exists on a mapped command.
 */
const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
const CONVENTIONS: Record<string, string> = {
  getCost: '--cost',
  aspectRatio: '--aspect',
  numImages: '--num',
  numGenerations: '--num',
  referenceImages: '--ref',
  referenceImageUrls: '--ref',
  playheadFrame: '--playhead',
  contentType: '--type',
  favorited: '--favorite',
  includeArchived: '--archived',
}
const NAMING_RULES: Array<(input: string, tool: string) => string[]> = [
  // Same name, kebab-cased, as a flag or a positional.
  (i) => [`--${kebab(i)}`, `<${kebab(i)}>`],
  // A reference drops its type suffix: modelId -> --model, coverUrl -> --cover, durationSeconds -> --duration.
  (i) => {
    const bare = kebab(i).replace(/-(id|ids|url|urls|seconds|ms|code)$/, '')
    return [`--${bare}`, `<${bare}>`]
  },
  // A list becomes a repeatable singular flag: logos -> --logo, designPrinciples -> --design-principle.
  (i) => (i.endsWith('s') ? [`--${kebab(i).slice(0, -1)}`] : []),
  // The tool's own entity id is the command's positional id: update_stage.stageId -> <id>.
  (i, tool) => {
    const entity = tool.slice(tool.indexOf('_') + 1).replace(/s$/, '')
    return i === `${entity.replace(/_([a-z])/g, (_, c) => c.toUpperCase())}Id` ? ['<id>'] : []
  },
  (i) => (CONVENTIONS[i] ? [CONVENTIONS[i]] : []),
]

/** Genuine one-off names: tool -> input -> the flag or positional that expresses it. */
const ALIASES: Record<string, Record<string, string>> = {
  generate_board: { boardType: '--type', boardName: '--name' },
  generate_video: { audioEnabled: '--audio', negativePrompt: '--negative', referenceVideos: '--ref-video', referenceAudio: '--ref-audio' },
  edit_audio: { clipIds: '--clips' },
  generate_lip_sync: { motionPrompt: '--motion' },
  create_avatar: { defaultVoiceId: '--voice' },
  update_avatar: { defaultVoiceId: '--voice' },
  create_brand_kit: { nicheDefinition: '--niche' },
  update_brand_kit: { orderedIds: '<ids>', nicheDefinition: '--niche', isDefault: '--default' },
  add_brand_knowledge: { fileData: '--file' },
  create_folder: { type: '--smart', query: '--text' },
  update_folder: { folderIds: '--also', query: '--text', addItems: '--add', removeItems: '--remove' },
  get_media: { items: '<id>' },
  create_media_upload: { fileName: '--name' },
  import_media: { fileName: '--name' },
  create_element: { images: '--image' },
  get_generation_status: { outputIds: '<id>', wait: '--no-wait' },
  delete_stage: { targetStageId: '--target' },
  update_card: { cardIds: '--also', scheduledAt: '--schedule' },
  publish_post: { cardId: '<id>' },
  list_accounts: { accountType: '--kind' },
  get_connected_account: { accountId: '<id>' },
  list_content: {
    outlierScoreMin: '--min-score',
    outlierScoreMax: '--max-score',
    viewsMin: '--min-views',
    viewsMax: '--max-views',
    durationMin: '--min-duration',
    durationMax: '--max-duration',
    subscribersMin: '--min-followers',
    subscribersMax: '--max-followers',
    publicationDate: '--since',
    sortBy: '--sort',
    sortOrder: '--asc',
  },
  favorite: { variationIndex: '--variation', favorited: '--off' },
  archive: { variationIndex: '--variation', archived: '--off' },
  get_project: { fromFrame: '--from', toFrame: '--to' },
  get_context: { mode: '--render' },
  export_project: { watermark: '--no-watermark' },
  delete_project: { confirm: '--yes' },
  update_timeline: { userIntent: '--intent' },
  update_canvas: { userIntent: '--intent' },
}

/** Inputs the CLI expresses by STRUCTURE rather than by a flag: a subcommand, or work it does for the caller. */
const EXPRESSED_BY_STRUCTURE: Record<string, Record<string, string>> = {
  edit_audio: {
    modelId: 'the subcommand picks the model: `audio isolate` or `audio enhance`',
    enhanceClips: 'the `audio enhance-clips` subcommand',
  },
  update_avatar: { ops: '`avatar look add` / `avatar look remove`' },
  update_brand_kit: { extract: 'the `brand-kit extract` subcommand' },
  add_brand_knowledge: { sourceType: 'one flag per source type: --text, --url, --youtube, --file, --file-url' },
  create_media_upload: { sizeBytes: '`media upload` reads the size from the local file' },
  complete_media_upload: { outputId: '`media upload` runs both steps, so the id never reaches the caller' },
  get_preview: {
    renderId: '`preview` starts the render and polls it in one command',
    bucketName: '`preview` starts the render and polls it in one command',
  },
  list_projects: { kind: 'deprecated MCP alias of `surface`, which the CLI already has' },
  create_project: { kind: 'deprecated MCP alias of `surface`, which the CLI already has' },
}

/**
 * ⚠️ KNOWN GAPS: things the MCP can do that the CLI cannot, recorded so they are visible and tracked. Each is a
 * debt, not an exemption: close it by adding the flag, and this test then REQUIRES the entry to be deleted.
 * Introduced 2026-09-24 with 12 gaps (brand-kit create lacked 7 fields update had, folder update could not
 * re-query, project create could not take a brand kit, and project get / apply could not ask for a preview still);
 * all 12 closed the same day. Empty is the goal; a new entry needs a reason and a plan to close it.
 */
const KNOWN_GAPS: Record<string, Record<string, string>> = {}

async function mcpTools(): Promise<Map<string, string[]>> {
  const server = await buildServer({ getClient: () => ({ listModels: async () => [] }) as never })
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'parity', version: '0' })
  await Promise.all([server.connect(a), client.connect(b)])
  const { tools } = await client.listTools()
  await client.close()
  return new Map(tools.map((t) => [t.name, Object.keys((t.inputSchema as { properties?: object }).properties ?? {})]))
}

function cliLeaves(): Map<string, Leaf> {
  const out = new Map<string, Leaf>()
  const walk = (cmd: Command, path: string[]) => {
    if (path.length && cmd.commands.length === 0) {
      const flags = new Set<string>([
        ...cmd.options.map((o) => o.long).filter((l): l is string => Boolean(l)),
        ...cmd.registeredArguments.map((arg) => `<${kebab(arg.name())}>`),
      ])
      out.set(path.join(' '), { path: path.join(' '), flags })
    }
    for (const c of cmd.commands) walk(c, [...path, c.name()])
  }
  walk(buildProgram(), [])
  return out
}

const covered = (tool: string, input: string, flags: Set<string>) =>
  NAMING_RULES.some((rule) => rule(input, tool).some((f) => flags.has(f))) ||
  (ALIASES[tool]?.[input] !== undefined && flags.has(ALIASES[tool][input]))

test('every MCP tool maps to CLI commands or is MCP-only by design, and every CLI command is accounted for', async () => {
  const tools = await mcpTools()
  const leaves = cliLeaves()
  // Guard the guard: an empty read would make every assertion below pass vacuously.
  assert.ok(tools.size >= 80, `read only ${tools.size} MCP tools`)
  assert.ok(leaves.size >= 90, `read only ${leaves.size} CLI commands`)

  const unmapped = [...tools.keys()].filter((t) => !TOOL_TO_CLI[t] && !MCP_ONLY[t])
  assert.deepEqual(unmapped, [], `MCP tools with no CLI mapping (add to TOOL_TO_CLI, or MCP_ONLY with a reason)`)

  const staleTools = [...Object.keys(TOOL_TO_CLI), ...Object.keys(MCP_ONLY)].filter((t) => !tools.has(t))
  assert.deepEqual(staleTools, [], 'entries name MCP tools that no longer exist')

  const targeted = new Set(Object.values(TOOL_TO_CLI).flat())
  const missingCommands = [...targeted].filter((c) => !leaves.has(c))
  assert.deepEqual(missingCommands, [], 'TOOL_TO_CLI names CLI commands that do not exist')

  const orphanCommands = [...leaves.keys()].filter((c) => !targeted.has(c) && !CLI_ONLY[c])
  assert.deepEqual(orphanCommands, [], 'CLI commands with no MCP tool (map a tool to them, or CLI_ONLY with a reason)')
  assert.deepEqual(Object.keys(CLI_ONLY).filter((c) => !leaves.has(c)), [], 'CLI_ONLY names commands that no longer exist')
})

test('every input of a mapped MCP tool is expressible in the CLI, or is a recorded known gap', async () => {
  const tools = await mcpTools()
  const leaves = cliLeaves()
  const uncovered: string[] = []
  const closedGaps: string[] = []
  const stale: string[] = []

  for (const [tool, inputs] of tools) {
    const commands = TOOL_TO_CLI[tool]
    if (!commands) continue
    const flags = new Set(commands.flatMap((c) => [...(leaves.get(c)?.flags ?? [])]))
    for (const input of inputs) {
      const isCovered = covered(tool, input, flags) || EXPRESSED_BY_STRUCTURE[tool]?.[input] !== undefined
      const isGap = KNOWN_GAPS[tool]?.[input] !== undefined
      if (!isCovered && !isGap) uncovered.push(`${tool}.${input}`)
      if (isGap && covered(tool, input, flags)) closedGaps.push(`${tool}.${input}`)
    }
  }

  for (const table of [ALIASES, EXPRESSED_BY_STRUCTURE, KNOWN_GAPS]) {
    for (const [tool, entries] of Object.entries(table)) {
      for (const input of Object.keys(entries)) {
        if (!tools.get(tool)?.includes(input)) stale.push(`${tool}.${input}`)
      }
    }
  }
  for (const [tool, entries] of Object.entries(ALIASES)) {
    const flags = new Set((TOOL_TO_CLI[tool] ?? []).flatMap((c) => [...(leaves.get(c)?.flags ?? [])]))
    for (const [input, flag] of Object.entries(entries)) {
      if (!flags.has(flag)) stale.push(`${tool}.${input} -> ${flag} (flag not on the mapped command)`)
    }
  }

  assert.deepEqual(uncovered, [], 'MCP inputs the CLI cannot express. Add the CLI flag (preferred), an ALIAS if it exists under another name, or a KNOWN_GAPS entry with the reason')
  assert.deepEqual(closedGaps, [], 'these KNOWN_GAPS are now closed: delete their entries')
  assert.deepEqual(stale, [], 'entries that name inputs or flags that no longer exist')
})
