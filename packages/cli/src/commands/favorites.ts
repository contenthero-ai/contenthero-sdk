/**
 * `contenthero favorite | archive` - the universal status verbs, one per concern.
 *
 *   favorite <assetType> <id> [--off]
 *   archive  <assetType> <id> [--off]
 *
 * `--off` is what replaced the separate `unfavorite` and `unarchive` commands. They were their positive
 * twins with one value flipped, so the direction lived in the command NAME, which meant the SDK, the MCP
 * and this CLI each carried two of everything for one operation.
 *
 * For a top-level asset, pass its type + id. For media (one output of a generation, an upload, stock), pass
 * `media <mediaId>`: the id `media list`, `media search` and `folder get` print (`a1B2c3D4-2` for one output of
 * several). `--variation` is gone: the output is named in the id itself (7.44). Both require favorites:write.
 */

import type { Command } from 'commander'
import type { FavoriteInput, ArchiveInput } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit, keyValues } from '../output.js'
import { CliError, EXIT } from '../errors.js'

/** The 'media' positional means "a media item, named by its media id". */
const MEDIA = 'media'
const FAVORITE_TYPES = ['card', 'voice', 'brand_kit', 'project', 'inspiration_content', 'gallery', 'transition', 'space'] as const
const ARCHIVE_TYPES = ['card', 'brand_kit', 'brand_kit_section', 'project', 'space'] as const

type Target = { mediaId: string } | { assetType: string; id: string }

/** Resolve the CLI args into the universal target shape: `media` names a media item by its media id. */
function resolveTarget(assetType: string, id: string, allowed: readonly string[]): Target {
  if (assetType === MEDIA) return { mediaId: id }
  if (!allowed.includes(assetType)) {
    throw new CliError(
      `Invalid asset type "${assetType}". Expected one of: ${[...allowed, MEDIA].join(', ')}.`,
      EXIT.USAGE,
    )
  }
  return { assetType, id }
}

/** Human one-liner: "Favorited brand_kit bk1" / "Archived media a1B2c3D4-2". */
function actionHuman(verb: string, t: Target): string {
  const what = 'mediaId' in t ? `media ${t.mediaId}` : `${t.assetType} ${t.id}`
  return keyValues([[verb, what]])
}

const TYPES_HELP = (allowed: readonly string[]) => `${[...allowed, MEDIA].join(' | ')}`

export function registerFavorites(program: Command): void {
  program
    .command('favorite')
    .description('Favorite an asset, or clear it with --off (requires favorites:write)')
    .argument('<assetType>', TYPES_HELP(FAVORITE_TYPES))
    .argument('<id>', "the asset id, or the media id when assetType is media (a1B2c3D4-2 for one output of several)")
    .option('--off', 'clear the favorite instead of setting it')
    .action(async (assetType: string, id: string, opts: Record<string, unknown>, command: Command) => {
      const target = resolveTarget(assetType, id, FAVORITE_TYPES)
      const favorited = !opts.off
      const { client, ctx } = makeClient(command)
      await client.favorite({ ...target, favorited } as FavoriteInput)
      emit({ favorited, ...target }, ctx, () => actionHuman(favorited ? 'Favorited' : 'Unfavorited', target))
    })

  program
    .command('archive')
    .description('Archive an asset, or restore it with --off (reversible; requires favorites:write)')
    .argument('<assetType>', TYPES_HELP(ARCHIVE_TYPES))
    .argument('<id>', "the asset id, or the media id when assetType is media (a1B2c3D4-2 for one output of several)")
    .option('--off', 'restore instead of archiving')
    .action(async (assetType: string, id: string, opts: Record<string, unknown>, command: Command) => {
      const target = resolveTarget(assetType, id, ARCHIVE_TYPES)
      const archived = !opts.off
      const { client, ctx } = makeClient(command)
      await client.archive({ ...target, archived } as ArchiveInput)
      emit({ archived, ...target }, ctx, () => actionHuman(archived ? 'Archived' : 'Unarchived', target))
    })
}
