/**
 * `contenthero share` - an item's public link, one command for every shareable kind, as `favorite` and `archive` are.
 *
 *   share media <mediaIds...> [--title <title>]     outputs of your finished generations
 *   share media <mediaId> --off                     stop a generation's link
 *   share media --off --link <shareUrl>             stop any media link by its address
 *   share project <id> [--off]                      a project's live link
 *
 * The kind keeps the scope of the surface that owns it: studio:write for media, editor:write for a project.
 */

import type { Command } from 'commander'
import { describeMediaShare, describeProjectShare, type ShareItemInput } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit } from '../output.js'
import { CliError, EXIT } from '../errors.js'

/** The 'media' positional names media by its media ids; every other kind is an item named by its id. */
const MEDIA = 'media'
const ITEM_TYPES = ['project'] as const satisfies readonly ShareItemInput['assetType'][]

export function registerShare(program: Command): void {
  program
    .command('share')
    .description(
      "Make an item's public link, or stop sharing it with --off; a stopped link never opens again. Media: one output gives its generation's link, several a new link to them as a set (requires studio:write). A project: its live link, which shows it as it is now (requires editor:write)",
    )
    .argument('<assetType>', [MEDIA, ...ITEM_TYPES].join(' | '))
    .argument('[ids...]', 'for media, one or more media ids as the media commands print them (with --off, one); otherwise the item id')
    .option('--title <title>', 'for media: a title for a set of two or more')
    .option('--off', 'stop sharing instead')
    .option('--link <shareUrl>', 'for media, with --off: the media link to stop')
    .action(async (assetType: string, ids: string[], opts: Record<string, unknown>, command: Command) => {
      const title = opts.title as string | undefined
      const link = opts.link as string | undefined
      const shared = opts.off ? { shared: false } : {}

      if (assetType === MEDIA) {
        const { client, ctx } = makeClient(command)
        const share = await client.share({
          ...(ids.length ? { mediaIds: ids } : {}),
          ...(title !== undefined ? { title } : {}),
          ...shared,
          ...(link !== undefined ? { shareUrl: link } : {}),
        })
        emit(share, ctx, () => describeMediaShare(share, ids))
        return
      }

      if (!(ITEM_TYPES as readonly string[]).includes(assetType)) {
        throw new CliError(`Invalid asset type "${assetType}". Expected one of: ${[MEDIA, ...ITEM_TYPES].join(', ')}.`, EXIT.USAGE)
      }
      if (ids.length !== 1 || title !== undefined || link !== undefined) {
        throw new CliError(`share ${assetType} takes one id, and --title and --link belong to media.`, EXIT.USAGE)
      }
      const { client, ctx } = makeClient(command)
      const share = await client.share({ assetType: assetType as ShareItemInput['assetType'], id: ids[0]!, ...shared })
      emit(share, ctx, () => describeProjectShare(share))
    })
}
