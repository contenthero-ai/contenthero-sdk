/**
 * `contenthero platform` - the publish-destination discovery catalog.
 *   platform list                          platforms you can publish to + formats
 *   platform get <platform> [--format f]   one platform's full post shape
 *
 * The source of truth for which platforms/formats exist and the exact fields a
 * post requires per format; use it instead of hardcoding when scripting a post.
 */

import type { Command } from 'commander'
import { makeClient } from '../context.js'
import { emit, keyValues, table } from '../output.js'
import type { PlatformSummary, PlatformSchema } from '@contenthero/sdk'

export function registerPlatform(program: Command): void {
  const platform = program
    .command('platform')
    .description('Discover the platforms you can publish to and what a post requires')

  platform
    .command('list')
    .description('List the platforms you can publish to (formats + connected flag)')
    .action(async (_opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const platforms = await client.listPlatforms()
      emit(platforms, ctx, (rows: PlatformSummary[]) =>
        table(
          ['PLATFORM', 'NAME', 'FORMATS', 'CONNECTED'],
          rows.map((p) => [
            p.platform,
            p.name,
            p.formats.map((f) => f.value).join(', '),
            p.connected ? 'yes' : 'no',
          ]),
        ),
      )
    })

  platform
    .command('get')
    .description("Get one platform's full publishing shape (the fields a post requires)")
    .argument('<platform>', 'platform id (from `platform list`)')
    .option('--format <format>', 'narrow to one format (e.g. reel, short, story, thread)')
    .action(async (platformId: string, opts: { format?: string }, command: Command) => {
      const { client, ctx } = makeClient(command)
      const p = await client.getPlatform(platformId, { format: opts.format })
      emit(p, ctx, (schema: PlatformSchema) => {
        const fieldRows = schema.formats.map(
          (fmt) =>
            [fmt, Object.keys(schema.fieldTemplatesByFormat[fmt] ?? {}).join(', ') || '(none)'] as [
              string,
              string,
            ],
        )
        const enumRows = Object.entries(schema.enums).map(
          ([k, vals]) =>
            [
              k,
              vals
                .map((v) =>
                  v && typeof v === 'object' && 'id' in (v as Record<string, unknown>)
                    ? String((v as Record<string, unknown>).id)
                    : String(v),
                )
                .join(', '),
            ] as [string, string],
        )
        const limitRows = schema.characterLimits
          ? Object.entries(schema.characterLimits).map(([k, n]) => [k, String(n)] as [string, string])
          : []
        return keyValues([
          ['Platform', schema.platform],
          ['Name', schema.name],
          ['Formats', schema.formats.join(', ')],
          ['Posting modes', schema.postingModes.join(', ')],
          ...fieldRows.map(([fmt, fields]) => [`Fields (${fmt})`, fields] as [string, string]),
          ...enumRows.map(([k, vals]) => [`Options (${k})`, vals] as [string, string]),
          ...limitRows.map(([k, n]) => [`Limit (${k})`, n] as [string, string]),
        ])
      })
    })
}
