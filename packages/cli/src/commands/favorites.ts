/**
 * `contenthero favorite | unfavorite | archive | unarchive` - the universal
 * status verbs, one pair each across asset types.
 *
 *   favorite   <assetType> <id> [--variation <n>]
 *   unfavorite <assetType> <id> [--variation <n>]
 *   archive    <assetType> <id> [--variation <n>]
 *   unarchive  <assetType> <id> [--variation <n>]
 *
 * For a top-level asset, pass its type + id. For one studio media variation
 * (an image/video/audio slot from `media get`), pass `media <outputId>
 * --variation <n>` (1-based). All four require the favorites:write scope.
 */

import type { Command } from 'commander'
import type { FavoriteInput, ArchiveInput } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit, keyValues } from '../output.js'
import { CliError, EXIT } from '../errors.js'
import { toInt } from '../args.js'

/** The 'media' positional means "a studio output variation" (needs --variation). */
const MEDIA = 'media'
const FAVORITE_TYPES = ['post', 'voice', 'brand_kit', 'project', 'inspiration_content', 'gallery', 'transition'] as const
const ARCHIVE_TYPES = ['post', 'brand_kit', 'brand_kit_section', 'project'] as const

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
    .description('Mark an asset as a favorite (requires favorites:write)')
    .argument('<assetType>', TYPES_HELP(FAVORITE_TYPES))
    .argument('<id>', 'the asset id (or studio output id when assetType is media)')
    .option('--variation <n>', '1-based studio media variation slot (media only)', toInt)
    .action(async (assetType: string, id: string, opts: Record<string, unknown>, command: Command) => {
      const target = resolveTarget(assetType, id, opts.variation as number | undefined, FAVORITE_TYPES)
      const { client, ctx } = makeClient(command)
      await client.favorite(target as FavoriteInput)
      emit({ favorited: true, ...target }, ctx, () => actionHuman('Favorited', target))
    })

  program
    .command('unfavorite')
    .description('Remove the favorite flag from an asset (requires favorites:write)')
    .argument('<assetType>', TYPES_HELP(FAVORITE_TYPES))
    .argument('<id>', 'the asset id (or studio output id when assetType is media)')
    .option('--variation <n>', '1-based studio media variation slot (media only)', toInt)
    .action(async (assetType: string, id: string, opts: Record<string, unknown>, command: Command) => {
      const target = resolveTarget(assetType, id, opts.variation as number | undefined, FAVORITE_TYPES)
      const { client, ctx } = makeClient(command)
      await client.unfavorite(target as FavoriteInput)
      emit({ favorited: false, ...target }, ctx, () => actionHuman('Unfavorited', target))
    })

  program
    .command('archive')
    .description('Archive an asset (reversible; requires favorites:write)')
    .argument('<assetType>', TYPES_HELP(ARCHIVE_TYPES))
    .argument('<id>', 'the asset id (or studio output id when assetType is media)')
    .option('--variation <n>', '1-based studio media variation slot (media only)', toInt)
    .action(async (assetType: string, id: string, opts: Record<string, unknown>, command: Command) => {
      const target = resolveTarget(assetType, id, opts.variation as number | undefined, ARCHIVE_TYPES)
      const { client, ctx } = makeClient(command)
      await client.archive(target as ArchiveInput)
      emit({ archived: true, ...target }, ctx, () => actionHuman('Archived', target))
    })

  program
    .command('unarchive')
    .description('Unarchive an asset (restore it; requires favorites:write)')
    .argument('<assetType>', TYPES_HELP(ARCHIVE_TYPES))
    .argument('<id>', 'the asset id (or studio output id when assetType is media)')
    .option('--variation <n>', '1-based studio media variation slot (media only)', toInt)
    .action(async (assetType: string, id: string, opts: Record<string, unknown>, command: Command) => {
      const target = resolveTarget(assetType, id, opts.variation as number | undefined, ARCHIVE_TYPES)
      const { client, ctx } = makeClient(command)
      await client.unarchive(target as ArchiveInput)
      emit({ archived: false, ...target }, ctx, () => actionHuman('Unarchived', target))
    })
}
