/**
 * The canonical editorial grouping of the v1 MCP tools.
 *
 * WHY THIS LIVES HERE, in the package that owns the tools, and not in a consumer.
 *
 * Three artifacts need to talk about the tool surface in domains rather than as a flat
 * list of 88 names: the published documentation (docs.contenthero.ai), the ContentHero
 * agent skill, and this package's own "advertises exactly the v1 tools" test. Before this
 * file there were going to be three separate lists of the same 88 names, which is three
 * chances to disagree and no mechanism that would notice. Grouping is EDITORIAL, so it
 * cannot be derived from tool names (a rename would silently reshuffle the docs), but it
 * can have exactly one home, and the home is next to the definitions it describes.
 *
 * Completeness is PROVEN, not asserted: `assertGroupsCoverTools` runs in this package's
 * test suite against the real `listTools()` output, so a tool added without a group fails
 * CI here, before publish, rather than in a consumer after it.
 */

export interface ToolGroup {
  /** Stable url-safe id. Used for the docs page filename, so renaming one moves a page. */
  slug: string
  title: string
  /** One sentence, written for someone who has not seen the tool list. */
  blurb: string
  tools: string[]
}

export const TOOL_GROUPS: readonly ToolGroup[] = [
  {
    slug: 'generate',
    title: 'Generate',
    blurb:
      'Create images, video, audio and boards, upscale them, and check what a generation is doing.',
    tools: [
      'generate_image', 'generate_video', 'generate_audio', 'generate_board',
      'generate_lip_sync', 'upscale', 'edit_audio', 'transcribe',
      'get_generation_status', 'get_preview',
      'list_models', 'get_model', 'get_layer_types', 'get_timeline_types',
    ],
  },
  {
    slug: 'media',
    title: 'Media',
    blurb: 'The library: browse, search, import and upload the media an account owns.',
    tools: [
      'list_media', 'get_media', 'show_media', 'search_media', 'import_media',
      'create_media_upload', 'complete_media_upload',
      'list_folders', 'get_folder', 'create_folder', 'update_folder', 'delete_folder',
      'favorite', 'archive',
    ],
  },
  {
    slug: 'characters',
    title: 'Avatars and voices',
    blurb: 'The identity layer: avatars with their looks, and the voices they speak with.',
    tools: [
      'list_avatars', 'get_avatar', 'create_avatar', 'update_avatar', 'delete_avatar',
      'list_voices', 'get_voice',
    ],
  },
  {
    slug: 'planner',
    title: 'Planner',
    blurb: 'Spaces, stages and cards: the content pipeline, and publishing from it.',
    // The vocabulary here changed in TWO directions at once, which is why prose written
    // against the old surface reads as if the whole family was deleted. What used to be a
    // POST is now a CARD; what used to be a DESTINATION is now a POST, one per platform on
    // a card. `publish_post` survived both and takes a cardId.
    tools: [
      'list_spaces', 'get_space', 'create_space', 'update_space', 'delete_space',
      'list_stages', 'create_stage', 'update_stage', 'delete_stage',
      'list_cards', 'get_card', 'create_card', 'update_card',
      'list_tags', 'create_tag', 'update_tag', 'delete_tag',
      'publish_post', 'list_connected_accounts', 'get_connected_account',
    ],
  },
  {
    slug: 'brand',
    title: 'Brand',
    blurb: 'Brand kits and the knowledge base that grounds generations in your voice.',
    tools: [
      'list_brand_kits', 'get_brand_kit', 'create_brand_kit', 'update_brand_kit',
      'list_brand_knowledge', 'get_brand_knowledge', 'add_brand_knowledge',
      'remove_brand_knowledge', 'search_brand_knowledge',
    ],
  },
  {
    slug: 'editor',
    title: 'Editor and canvas',
    blurb: 'Projects, their timelines and canvases, the elements on them, and exports.',
    tools: [
      'list_projects', 'get_project', 'create_project', 'delete_project',
      'import_project', 'export_project', 'get_export', 'get_export_formats',
      'update_timeline', 'update_canvas', 'get_transcript',
      'list_elements', 'get_element', 'create_element', 'update_element', 'delete_element',
    ],
  },
  {
    slug: 'inspiration',
    title: 'Inspiration',
    blurb:
      'The research surface: the social accounts you track, and their posts ranked by outlier score.',
    // list_accounts and get_account are TRACKED SOCIAL ACCOUNTS, not the ContentHero
    // account you are signed in as. list_accounts: "TWO KINDS, in one list: accountType
    // 'inspiration' is the creators and competitors they watch, 'brand' is their OWN
    // profiles." Filing them under "Account" misreads the entire research surface, which
    // is what the first draft of this list did.
    tools: ['list_accounts', 'get_account', 'list_content', 'get_content'],
  },
  {
    slug: 'account',
    title: 'Account',
    blurb:
      'Your balance and tier, the platforms available to publish to, and what the user is looking at.',
    tools: ['get_balance', 'get_context', 'list_platforms', 'get_platform'],
  },
]

/**
 * Throw unless the grouping and the live tool list are in exact correspondence.
 *
 * Checks all three failure directions, because each one fails differently and silently:
 * a tool in NO group vanishes from the docs and the skill; a tool in TWO groups is
 * documented twice and drifts between the copies; a group naming a tool that no longer
 * exists teaches a dead name, which is the failure that put 77 dead references into the
 * documentation for three months.
 *
 * Pass the names from a real `listTools()` call, never a hand-maintained list: a guard
 * fed by the same hand that writes the thing it guards cannot fail.
 */
export function assertGroupsCoverTools(liveToolNames: readonly string[]): void {
  const claimed = TOOL_GROUPS.flatMap((g) => g.tools)
  const live = new Set(liveToolNames)
  const problems: string[] = []

  const duplicated = claimed.filter((n, i) => claimed.indexOf(n) !== i)
  const ungrouped = liveToolNames.filter((n) => !claimed.includes(n))
  const phantom = claimed.filter((n) => !live.has(n))

  if (duplicated.length) problems.push(`claimed by two groups: ${[...new Set(duplicated)].join(', ')}`)
  if (ungrouped.length) problems.push(`in no group: ${ungrouped.join(', ')}`)
  if (phantom.length) problems.push(`grouped but not advertised: ${phantom.join(', ')}`)

  const slugs = TOOL_GROUPS.map((g) => g.slug)
  const dupeSlugs = slugs.filter((s, i) => slugs.indexOf(s) !== i)
  if (dupeSlugs.length) problems.push(`duplicate group slugs: ${dupeSlugs.join(', ')}`)

  if (problems.length) {
    throw new Error(
      'TOOL_GROUPS is out of sync with the advertised tools:\n  ' + problems.join('\n  '),
    )
  }
}

/** Every grouped tool name, in group order. The canonical ordering for generated output. */
export function groupedToolNames(): string[] {
  return TOOL_GROUPS.flatMap((g) => g.tools)
}
