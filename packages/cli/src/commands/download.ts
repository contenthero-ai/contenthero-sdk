/**
 * `contenthero download <id> [path]` - any file of the account's out of ContentHero, written to disk.
 *
 * The server answers each file the id names as a save link (`download` in the SDK): it names the file, needs no
 * sign-in and does not expire. This follows each link and streams the bytes straight to disk, never holding a whole
 * file in memory. `path` is the file to write for one file, or the directory to write into for several; without it,
 * the files land in the current directory under the names the server gives them. Never spends.
 */

import type { Command } from 'commander'
import { describeFileSize } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { emit, keyValues } from '../output.js'
import { saveFiles, type SavedFile } from '../save-files.js'

export function registerDownload(program: Command): void {
  program
    .command('download')
    .description("Download any file of yours to disk: a generation, one of its outputs, an upload, an import, a library file, or a project's export (free)")
    .argument('<id>', 'a media id (a generation, -<n> for one of its outputs, an upload, an import, a library file) or an export id')
    .argument('[path]', 'the file to write for one file, or the directory to write into for several (default: the current directory, under the names the server gives)')
    .action(async (id: string, path: string | undefined, _opts: Record<string, unknown>, command: Command) => {
      const { client, ctx } = makeClient(command)
      const { files } = await client.download(id)
      const saved = await saveFiles(files, path)
      emit({ files: saved }, ctx, (r: { files: SavedFile[] }) =>
        r.files.map((f) => keyValues([['Saved', f.path], ['Size', describeFileSize(f.bytes)]])).join('\n\n'),
      )
    })
}
