/**
 * `contenthero favorite | archive` - the universal status verbs, one per concern.
 *
 *   favorite <assetType> <id> [--variation <n>] [--off]
 *   archive  <assetType> <id> [--variation <n>] [--off]
 *
 * `--off` is what replaced the separate `unfavorite` and `unarchive` commands. They were their positive
 * twins with one value flipped, so the direction lived in the command NAME, which meant the SDK, the MCP
 * and this CLI each carried two of everything for one operation.
 *
 * For a top-level asset, pass its type + id. For one studio media variation (an image/video/audio slot
 * from `media get`), pass `media <outputId> --variation <n>` (1-based). Both require favorites:write.
 */

import type { Command } from 'commander'
import type { FavoriteInput, ArchiveInput } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit, keyValues } from '../output.js'
import { CliError, EXIT } from '../errors.js'
import { toInt } from '../args.js'

/** The 'media' positional means "a studio output variation" (needs --variation). */
const MEDIA = 'media'
const FAVORITE_TYPES = ['card', 'voice', 'brand_kit', 'project', 'inspiration_content', 'gallery', 'transition', 'space'] as const
const ARCHIVE_TYPES = ['card', 'brand_kit', 'brand_kit_section', 'project', 'space'] as const

type Target = { assetType?: string; id: string; variationIndex?: number }

/**
 * Resolve the CLI args into the universal target shape. `media` routes to a
 * studio output variation (requires --variation); every other type is a
 * top-level asset addressed by id alone.
 */
function resolveTarget(
  assetType: string,
  id: string,
  variation: number | undefined,
  allowed: readonly string[],
): Target {
  if (assetType === MEDIA) {
    if (variation == null) {
      throw new CliError(
        'For media, pass --variation <n>: favorite/archive state is per studio output variation.',
        EXIT.USAGE,
      )
    }
    return { id, variationIndex: variation }
  }
  if (!allowed.includes(assetType)) {
    throw new CliError(
      `Invalid asset type "${assetType}". Expected one of: ${[...allowed, MEDIA].join(', ')}.`,
      EXIT.USAGE,
    )
  }
  if (variation != null) {
    throw new CliError('--variation only applies to media (studio output variations).', EXIT.USAGE)
  }
  return { assetType, id }
}

/** Human one-liner: "Favorited brand_kit bk1" / "Archived variation 2 of out1". */
function actionHuman(verb: string, t: Target): string {
  const what =
    t.variationIndex != null ? `variation ${t.variationIndex} of ${t.id}` : `${t.assetType} ${t.id}`
  return keyValues([[verb, what]])
}

const TYPES_HELP = (allowed: readonly string[]) => `${[...allowed, MEDIA].join(' | ')}`

export function registerFavorites(program: Command): void {
  program
    .command('favorite')
    .description('Favorite an asset, or clear it with --off (requires favorites:write)')
    .argument('<assetType>', TYPES_HELP(FAVORITE_TYPES))
    .argument('<id>', 'the asset id (or studio output id when assetType is media)')
    .option('--variation <n>', '1-based studio media variation slot (media only)', toInt)
    .option('--off', 'clear the favorite instead of setting it')
    .action(async (assetType: string, id: string, opts: Record<string, unknown>, command: Command) => {
      const target = resolveTarget(assetType, id, opts.variation as number | undefined, FAVORITE_TYPES)
      const favorited = !opts.off
      const { client, ctx } = makeClient(command)
      await client.favorite({ ...target, favorited } as FavoriteInput)
      emit({ favorited, ...target }, ctx, () => actionHuman(favorited ? 'Favorited' : 'Unfavorited', target))
    })

  program
    .command('archive')
    .description('Archive an asset, or restore it with --off (reversible; requires favorites:write)')
    .argument('<assetType>', TYPES_HELP(ARCHIVE_TYPES))
    .argument('<id>', 'the asset id (or studio output id when assetType is media)')
    .option('--variation <n>', '1-based studio media variation slot (media only)', toInt)
    .option('--off', 'restore instead of archiving')
    .action(async (assetType: string, id: string, opts: Record<string, unknown>, command: Command) => {
      const target = resolveTarget(assetType, id, opts.variation as number | undefined, ARCHIVE_TYPES)
      const archived = !opts.off
      const { client, ctx } = makeClient(command)
      await client.archive({ ...target, archived } as ArchiveInput)
      emit({ archived, ...target }, ctx, () => actionHuman(archived ? 'Archived' : 'Unarchived', target))
    })
}
