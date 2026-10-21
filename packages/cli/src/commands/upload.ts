/**
 * `contenthero upload <file...>` - local files into the library as first-class media (the MCP's `create_upload`,
 * `sign_upload_parts` and `complete_upload` in one command).
 *
 * The SDK's `upload` does the work in whichever mode the server chooses: one PUT, or parts sent a few at a time, each
 * retried on its own. A file is read from disk lazily, never held whole in memory. Each file is its own upload: one
 * that fails is named and does not stop the rest. Progress goes to stderr, so `--json` output stays clean.
 */

import { openAsBlob, statSync } from 'node:fs'
import { basename } from 'node:path'
import type { Command } from 'commander'
import { describeFileSize, type ContentHero, type UploadProgress, type UploadedMedia } from '@contenthero/sdk'
import { makeClient } from '../context.js'
import { CliError, EXIT } from '../errors.js'
import { emit, keyValues, linkRow, displayId } from '../output.js'
import { mimeForFile } from '../save-files.js'

export function uploadedHuman(m: UploadedMedia): string {
  return keyValues([
    ['Output id', displayId({ id: m.outputId, shortId: m.shortId })],
    // The name it was uploaded with, as the library lists it, so a batch reads back which file is which.
    ...(m.fileName ? [['Name', m.fileName] as [string, string]] : []),
    ...linkRow(m),
    ['URL', m.url],
  ])
}

/** One file's outcome, as `--json` prints it. */
export type UploadFileResult = { file: string; media: UploadedMedia } | { file: string; error: string }

function uploadResultsHuman(r: { files: UploadFileResult[] }): string {
  return r.files
    .map((f) => ('media' in f ? uploadedHuman(f.media) : keyValues([['File', f.file], ['Failed', f.error]])))
    .join('\n\n')
}

/** The progress line writer: updates in place on a terminal, and says only where it started and ended otherwise. */
function progressFor(name: string, total: number, write: (s: string) => void) {
  const tty = process.stderr.isTTY === true
  const size = describeFileSize(total)
  write(`Uploading ${name} (${size})${tty ? '' : '\n'}`)
  return {
    update(p: UploadProgress) {
      if (tty && total > 0) write(`\rUploading ${name} (${size}) ${Math.floor((p.uploadedBytes / total) * 100)}%`)
    },
    done(ok: boolean) {
      write(`${tty ? '\r' : ''}${ok ? 'Uploaded' : 'Failed'} ${name} (${size})${' '.repeat(tty ? 8 : 0)}\n`)
    },
  }
}

/** Upload one local file. Throws a `CliError` when the file cannot be read. */
export async function uploadFile(
  client: ContentHero,
  file: string,
  names: { name?: string; contentType?: string },
  write: (s: string) => void = (s) => void process.stderr.write(s),
): Promise<UploadedMedia> {
  let blob: Blob
  try {
    if (!statSync(file).isFile()) throw new Error('not a file')
    blob = await openAsBlob(file)
  } catch {
    throw new CliError(`Cannot read file: ${file}`, EXIT.USAGE)
  }
  const fileName = names.name ?? basename(file)
  const progress = progressFor(fileName, blob.size, write)
  try {
    const media = await client.upload(blob, {
      fileName,
      contentType: names.contentType ?? mimeForFile(file),
      onProgress: (p) => progress.update(p),
    })
    progress.done(true)
    return media
  } catch (err) {
    progress.done(false)
    throw err
  }
}

export function registerUpload(program: Command): void {
  program
    .command('upload')
    .description('Upload local files into your library as media (requires library:write)')
    .argument('<files...>', 'paths of the local files')
    .option('--content-type <mime>', 'MIME type override, for one file (else inferred from the extension)')
    .option('--name <name>', 'file name override, for one file (else the basename)')
    .action(async (files: string[], opts: Record<string, unknown>, command: Command) => {
      if (files.length > 1 && (opts.contentType !== undefined || opts.name !== undefined)) {
        throw new CliError('--content-type and --name go with one file. Upload the files one at a time to set them.', EXIT.USAGE)
      }
      const { client, ctx } = makeClient(command)
      const results: UploadFileResult[] = []
      for (const file of files) {
        try {
          const media = await uploadFile(client, file, { name: opts.name as string | undefined, contentType: opts.contentType as string | undefined })
          results.push({ file, media })
        } catch (err) {
          // One file alone fails the command with its own error, so its exit code says why.
          if (files.length === 1) throw err
          results.push({ file, error: err instanceof Error ? err.message : String(err) })
        }
      }
      emit({ files: results }, ctx, uploadResultsHuman)
      const failed = results.filter((r) => 'error' in r)
      if (failed.length > 0) {
        throw new CliError(`${failed.length} of ${results.length} files did not upload: ${failed.map((f) => f.file).join(', ')}. The others are in your library.`, EXIT.GENERAL)
      }
    })
}
