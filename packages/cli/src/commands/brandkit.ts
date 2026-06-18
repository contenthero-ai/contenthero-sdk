/**
 * `contenthero brand-kit` - brand kits (the brand identity documents).
 *   brand-kit list | get | update | archive
 *   brand-kit section add | update | archive
 *
 * Reads are open; writes need brandkit:write. Free-form identity objects
 * (positioning, audience, voice profile, content strategy) and section fields
 * are passed as JSON.
 */

import type { Command } from 'commander'
import type {
  BrandKit,
  BrandKitSectionRecord,
  BrandKitSummary,
  UpdateBrandKitInput,
} from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit, keyValues, table } from '../output.js'
import { CliError, EXIT } from '../errors.js'
import { compact } from '../generation.js'
import { collect, toInt, toJson } from '../args.js'

function recordHuman(s: BrandKitSectionRecord, action: string): string {
  return keyValues([
    [action, s.sectionName],
    ['Section id', s.id],
    ['Tab', s.tab],
    ['Sort order', s.sortOrder],
    ['Fields', s.fields.length],
  ])
}

export function registerBrandKit(program: Command): void {
  const brandKit = program.command('brand-kit').description('Brand kits (brand identity documents)')

  brandKit
    .command('list')
    .description('List the account\'s brand kits (default first)')
    .action(async (_opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const kits = await client.listBrandKits()
      emit(kits, ctx, (rows: BrandKitSummary[]) =>
        table(
          ['ID', 'NAME', 'BUSINESS', 'DEFAULT', 'ACTIVE'],
          rows.map((k) => [
            k.id.slice(0, 8),
            k.name,
            k.businessName ?? '',
            k.isDefault ? 'yes' : '',
            k.isActive ? 'yes' : '',
          ]),
        ),
      )
    })

  brandKit
    .command('get')
    .description('Get one brand kit in full (the whole brand document)')
    .argument('<id>', 'the brand kit id')
    .action(async (id: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const kit = await client.getBrandKit(id)
      emit(kit, ctx, (k: BrandKit) =>
        keyValues([
          ['Name', k.name],
          ['Id', k.id],
          ['Business', k.businessName ?? ''],
          ['Niche', k.nicheDefinition ?? ''],
          ['Primary offer', k.primaryOffer ?? ''],
          ['Visual style', k.visualStyle ?? ''],
          ['Sections', k.sections.length],
          ['Brand accounts', k.brandAccounts.length],
          ['Inspiration accounts', k.inspirationAccounts.length],
          ['Knowledge items', k.knowledge.length],
        ]),
      )
    })

  brandKit
    .command('update')
    .description('Update a brand kit\'s identity fields (requires brandkit:write)')
    .argument('<id>', 'the brand kit id')
    .option('--name <text>')
    .option('--business-name <text>')
    .option('--website-url <url>')
    .option('--primary-offer <text>')
    .option('--niche <text>', 'niche definition')
    .option('--visual-style <text>')
    .option('--positioning <json>', 'positioning object (JSON)', toJson)
    .option('--audience <json>', 'audience object (JSON)', toJson)
    .option('--voice-profile <json>', 'voice profile object (JSON)', toJson)
    .option('--content-strategy <json>', 'content strategy object (JSON)', toJson)
    .option('--design-principle <text>', 'a design principle; repeatable', collect)
    .action(async (id: string, opts: Record<string, unknown>, command: Command) => {
      const input = compact<UpdateBrandKitInput>({
        name: opts.name as string | undefined,
        businessName: opts.businessName as string | undefined,
        websiteUrl: opts.websiteUrl as string | undefined,
        primaryOffer: opts.primaryOffer as string | undefined,
        nicheDefinition: opts.niche as string | undefined,
        visualStyle: opts.visualStyle as string | undefined,
        positioning: opts.positioning as Record<string, unknown> | undefined,
        audience: opts.audience as Record<string, unknown> | undefined,
        voiceProfile: opts.voiceProfile as Record<string, unknown> | undefined,
        contentStrategy: opts.contentStrategy as Record<string, unknown> | undefined,
        designPrinciples: opts.designPrinciple as string[] | undefined,
      })
      if (Object.keys(input).length === 0) {
        throw new CliError('Nothing to update. Pass at least one field to change.', EXIT.USAGE)
      }
      const { client, ctx } = makeClient(command)
      const kit = await client.updateBrandKit(id, input)
      emit(kit, ctx, (k: BrandKit) =>
        keyValues([
          ['Updated', k.name],
          ['Id', k.id],
        ]),
      )
    })

  brandKit
    .command('archive')
    .description('Archive a brand kit (reversible; requires brandkit:write)')
    .argument('<id>', 'the brand kit id')
    .action(async (id: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const k = await client.archiveBrandKit(id)
      emit(k, ctx, (kit: BrandKitSummary) =>
        keyValues([
          ['Archived', kit.name],
          ['Id', kit.id],
        ]),
      )
    })

  // -- brand-kit section ----------------------------------------------------
  const section = brandKit.command('section').description('Manage a brand kit\'s curated sections')

  section
    .command('add')
    .description('Add a curated section to a brand kit (requires brandkit:write)')
    .argument('<brandKitId>', 'the brand kit id')
    .requiredOption('--tab <tab>', 'the tab the section belongs to (e.g. voice, overview)')
    .requiredOption('--name <name>', 'the section title')
    .option('--sort-order <n>', 'order within the tab (default end)', toInt)
    .option('--fields <json>', 'field objects as a JSON array: [{ key, label, type, value }]', toJson)
    .action(async (brandKitId: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const s = await client.addBrandKitSection(brandKitId, {
        tab: opts.tab as string,
        sectionName: opts.name as string,
        sortOrder: opts.sortOrder as number | undefined,
        fields: opts.fields as unknown[] | undefined,
      })
      emit(s, ctx, (rec: BrandKitSectionRecord) => recordHuman(rec, 'Added section'))
    })

  section
    .command('update')
    .description('Update a brand-kit section (requires brandkit:write)')
    .argument('<brandKitId>', 'the brand kit id')
    .argument('<sectionId>', 'the section id (from `brand-kit get`)')
    .option('--name <name>', 'new section title')
    .option('--sort-order <n>', 'new order within the tab', toInt)
    .option('--fields <json>', 'replacement field objects as a JSON array', toJson)
    .action(async (brandKitId: string, sectionId: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const s = await client.updateBrandKitSection(brandKitId, sectionId, {
        sectionName: opts.name as string | undefined,
        sortOrder: opts.sortOrder as number | undefined,
        fields: opts.fields as unknown[] | undefined,
      })
      emit(s, ctx, (rec: BrandKitSectionRecord) => recordHuman(rec, 'Updated section'))
    })

  section
    .command('archive')
    .description('Archive a brand-kit section (soft delete, reversible; requires brandkit:write)')
    .argument('<brandKitId>', 'the brand kit id')
    .argument('<sectionId>', 'the section id to archive')
    .action(async (brandKitId: string, sectionId: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const s = await client.archiveBrandKitSection(brandKitId, sectionId)
      emit(s, ctx, (rec: BrandKitSectionRecord) => recordHuman(rec, 'Archived section'))
    })
}
