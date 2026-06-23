/**
 * `contenthero avatar` / `voice` - the account's reusable identity assets.
 *   avatar list | get <id>     avatars (base look + default voice) and their looks
 *   voice  list | get <id>     saved voices (ids feed generate audio / lip-sync)
 *
 * Reads only; creating avatars and voices stays in the app.
 */

import type { Command } from 'commander'
import type { Avatar, AvatarSummary, Voice, VoiceSummary } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit, keyValues, table } from '../output.js'

export function registerIdentity(program: Command): void {
  const avatar = program.command('avatar').description("Browse the account's avatars")

  avatar
    .command('list')
    .description('List avatars (base look + default voice)')
    .action(async (_opts, command: Command) => {
      const { client, ctx } = makeClient(command)
      const avatars = await client.listAvatars()
      emit(avatars, ctx, (rows: AvatarSummary[]) =>
        table(
          ['ID', 'NAME', 'DEFAULT', 'VOICE', 'STATUS'],
          rows.map((a) => [
            a.id.slice(0, 8),
            a.name,
            a.isDefault ? 'yes' : '',
            a.defaultVoiceId ?? '',
            a.status,
          ]),
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
          ['Id', av.id],
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
                l.id.slice(0, 8),
                l.name ?? '',
                l.lookType ?? '',
                l.isDefault ? 'yes' : '',
              ]),
            )
          : ''
        return head + looks
      })
    })

  const voice = program.command('voice').description("Browse the account's saved voices")

  voice
    .command('list')
    .description('List saved voices (favorites first)')
    .option('--favorite', 'only favorited voices')
    .action(async (opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const voices = await client.listVoices({ favorited: opts.favorite ? true : undefined })
      emit(voices, ctx, (rows: VoiceSummary[]) =>
        table(
          ['VOICE ID', 'NAME', 'PROVIDER', 'FAV'],
          rows.map((v) => [v.voiceId, v.name ?? '', v.provider ?? '', v.isFavorited ? 'yes' : '']),
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
