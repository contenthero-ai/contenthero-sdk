/**
 * `contenthero avatar` / `voice` - the account's reusable identity assets.
 *   avatar list | get <id>              avatars (base look + default voice) and their looks
 *   avatar create | update | delete     manage them
 *   avatar look add | remove            file existing images onto an avatar, or trash one
 *   voice  list | get <id>              saved voices (ids feed generate audio / lip-sync)
 *
 * ⚠️ VOICES ARE STILL READ-ONLY. Avatars became writable in Phase 7; voice creation stays in the app,
 * because only avatars had a demonstrated agent use case and splitting them keeps the surface honest.
 *
 * ⚠️ `avatar look add` FILES AN IMAGE THAT ALREADY EXISTS and costs nothing. To GENERATE a new look,
 * use `generate image --avatar <id>`, which spends credits.
 */

import type { Command } from 'commander'
import type { Avatar, AvatarListResult, Voice, VoiceListResult } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { costRows, emit, keyValues, table, linkRow, displayId, statusCommand, withMore } from '../output.js'
import { collect, placementFrom, toJson, withPageFlags, withPlacementFlags } from '../args.js'

export function registerIdentity(program: Command): void {
  const avatar = program.command('avatar').description("Manage the account's avatars")

  withPageFlags(avatar.command('list').description('List avatars (base look + default voice)'))
    .action(async (opts: { limit?: number; cursor?: string }, command: Command) => {
      const { client, ctx } = makeClient(command)
      const page = await client.listAvatars({ limit: opts.limit, cursor: opts.cursor })
      emit(page, ctx, (p: AvatarListResult) =>
        withMore(
          table(
            ['ID', 'NAME', 'DEFAULT', 'VOICE', 'STATUS'],
            p.avatars.map((a) => [
              displayId(a),
              a.name,
              a.isDefault ? 'yes' : '',
              a.defaultVoiceId ?? '',
              a.status,
            ]),
          ),
          p.nextCursor,
        ),
      )
    })

  avatar
    .command('get')
    .description('Get one avatar with its looks')
    .argument('<id>', 'the avatar id')
    .action(async (id: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const a = await client.getAvatar(id)
      emit(a, ctx, (av: Avatar) => {
        const head = keyValues([
          ['Name', av.name],
          ['Id', displayId(av)], ...linkRow(av),
          ['Default voice', av.defaultVoiceId ?? ''],
          ['Image', av.imageUrl ?? ''],
          ...(av.gender ? [['Gender', av.gender] as [string, string]] : []),
          ...(av.age ? [['Age', av.age] as [string, string]] : []),
          ['Looks', av.looks.length],
        ])
        const looks = av.looks.length
          ? '\n\nLooks:\n' +
            table(
              ['ID', 'NAME', 'TYPE', 'DEFAULT'],
              av.looks.map((l) => [
                displayId(l),
                l.name ?? '',
                l.lookType ?? '',
                l.isDefault ? 'yes' : '',
              ]),
            )
          : ''
        return head + looks
      })
    })

  avatar
    .command('create')
    .description('Create an avatar and start generating its first look (spends credits)')
    .argument('<name>', 'avatar name, at least 3 characters')
    .requiredOption('--age <age>', "apparent age, e.g. '20s', '35'")
    .requiredOption('--gender <gender>', 'gender presentation')
    .option('--ethnicity <ethnicity>', 'ethnicity, for a more specific likeness')
    .option('--niche <niche>', 'content niche; repeatable', collect)
    .option('--style <style>', 'visual style hint for the portrait')
    .option('-d, --description <text>', 'description of the character')
    .option('--voice <voiceId>', "default voice id (see `contenthero voice list`)")
    .option(
      '--ref <urlOrId>',
      'photo of a REAL PERSON to anchor identity to; repeatable. Only use photos of someone who agreed',
      collect,
    )
    .option('--cost', 'show the credit cost and exit without creating')
    .action(async (name: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      if (opts.cost) {
        const credits = await client.estimateAvatarCost()
        emit({ creditsEstimate: credits }, ctx, () => `Creating an avatar costs ${credits} credits.`)
        return
      }
      const created = await client.createAvatar({
        name,
        age: opts.age as string,
        gender: opts.gender as string,
        ethnicity: opts.ethnicity as string | undefined,
        niche: opts.niche as string[] | undefined,
        style: opts.style as string | undefined,
        description: opts.description as string | undefined,
        defaultVoiceId: opts.voice as string | undefined,
        referenceImageUrls: opts.ref as string[] | undefined,
      })
      // ⚠️ THE WAIT IS THE HEADLINE, not a footnote. The avatar has no image until its first look
      // finishes, so printing it like a finished record would read as "created, and empty".
      emit(created, ctx, () =>
        keyValues([
          ['Created', created.avatar.name],
          ['Id', displayId(created.avatar)], ...linkRow(created.avatar),
          ['Status', created.status],
          ...costRows(created.charge),
        ]) +
        `\n\nNot ready yet: the first look is generating. Wait for it with:\n  ${statusCommand([{ id: created.avatar.id, shortId: created.avatar.shortId, kind: 'avatar' }])}`,
      )
    })

  withPlacementFlags(
    avatar
      .command('update')
      .description("Rename an avatar, set its default look or voice, or move it among your avatars")
      .argument('<id>', 'the avatar id')
      .option('--name <name>', 'new name, at least 3 characters')
      .option('--default-look <lookId>', "look to make the default (also becomes the profile photo)")
      .option('--voice <voiceId>', 'default voice id, or "none" to clear it'),
  )
    .action(async (id: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const result = await client.updateAvatar(id, {
        ...(opts.name !== undefined ? { name: opts.name as string } : {}),
        ...(opts.defaultLook !== undefined ? { defaultLookId: opts.defaultLook as string } : {}),
        // `--voice none` is how a flag-based interface says null. Omitting the flag leaves it alone,
        // which is a different intent and must stay distinguishable.
        ...(opts.voice !== undefined
          ? { defaultVoiceId: opts.voice === 'none' ? null : (opts.voice as string) }
          : {}),
        ...placementFrom(opts),
      })
      emit(result, ctx, () => `Updated ${result.avatar.name} (${result.avatar.id}).`)
    })

  avatar
    .command('delete')
    .description('Delete an avatar (its looks survive and can be filed onto another avatar)')
    .argument('<id>', 'the avatar id')
    .action(async (id: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const result = await client.deleteAvatar(id)
      emit(result, ctx, () =>
        `Deleted avatar ${id}. Its looks are retained; file them onto another avatar with \`contenthero avatar look add\`.`,
      )
    })

  // `look` is a sub-group rather than more flags on `update`, because adding and removing a look are
  // their own verbs with their own arguments. The MCP folds them into update_avatar ops because an
  // agent benefits from one round trip; a human at a shell benefits from a name that says what it does.
  const look = avatar.command('look').description("Manage an avatar's looks")

  look
    .command('add')
    .description('File images you already own onto an avatar as looks (costs nothing)')
    .argument('<avatarId>', 'the avatar id')
    .requiredOption('--image <urlOrId>', 'image to file; repeatable', collect)
    .action(async (avatarId: string, opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const result = await client.addAvatarLooks(avatarId, opts.image as string[])
      emit(result, ctx, () => {
        const added = `Added ${result.looks.length} look${result.looks.length === 1 ? '' : 's'} to ${avatarId}.`
        // ⚠️ SKIPPED IS REPORTED, NEVER SWALLOWED. Resolution is owner-scoped, so an image this
        // account does not own is dropped rather than failing the call; silence would read as success.
        return result.skipped
          ? `${added}\nSkipped ${result.skipped} image(s) this account does not own.`
          : added
      })
    })

  look
    .command('remove')
    .description('Remove a look (trashed, recoverable for 30 days)')
    .argument('<avatarId>', 'the avatar id')
    .argument('<lookId>', 'the look id (see `contenthero avatar get`)')
    .action(async (avatarId: string, lookId: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const result = await client.removeAvatarLook(avatarId, lookId)
      emit(result, ctx, () => `Removed look ${lookId}. Recoverable for 30 days.`)
    })

  const voice = program.command('voice').description("Browse the account's saved voices")

  withPageFlags(
    voice
      .command('list')
      .description('List saved voices (favorites first)')
      .option('--favorite', 'only favorited voices'),
  )
    .action(async (opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const page = await client.listVoices({
        favorited: opts.favorite ? true : undefined,
        limit: opts.limit as number | undefined,
        cursor: opts.cursor as string | undefined,
      })
      emit(page, ctx, (p: VoiceListResult) =>
        withMore(
          table(
            ['VOICE ID', 'NAME', 'PROVIDER', 'FAV'],
            p.voices.map((v) => [v.voiceId, v.name ?? '', v.provider ?? '', v.isFavorited ? 'yes' : '']),
          ),
          p.nextCursor,
        ),
      )
    })

  voice
    .command('get')
    .description('Get one voice by its voiceId')
    .argument('<id>', 'the voice id')
    .action(async (id: string, _opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const v = await client.getVoice(id)
      emit(v, ctx, (voiceDetail: Voice) =>
        keyValues([
          ['Name', voiceDetail.name ?? ''],
          ['Voice id', voiceDetail.voiceId],
          ['Provider', voiceDetail.provider ?? ''],
          ['Accent', voiceDetail.accent ?? ''],
          ['Language', voiceDetail.language ?? ''],
          ['Gender', voiceDetail.gender ?? ''],
          ['Age', voiceDetail.age ?? ''],
          ...(voiceDetail.description ? [['Description', voiceDetail.description] as [string, string]] : []),
        ]),
      )
    })
}
