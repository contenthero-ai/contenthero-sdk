/**
 * Writing files out of ContentHero to disk, streamed: the one path `download` and `media get --save` share, and the
 * one map between a file's extension and its type, which uploads read the other way.
 */

import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { CliError, EXIT } from './errors.js'

/** A file to write: the name it saves under (an extension is added from its type when it has none) and its link. */
export interface FileToSave {
  mediaId?: string
  name: string
  url: string
}

/** One file written to disk. */
export interface SavedFile {
  mediaId?: string
  name: string
  path: string
  bytes: number
}

export type FetchFile = (url: string) => Promise<Response>

/** A file's type by its extension. The first extension listed for a type is the one a saved file of that type gets. */
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', svg: 'image/svg+xml', mp4: 'video/mp4', mov: 'video/quicktime',
  webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4',
  ogg: 'audio/ogg', pdf: 'application/pdf', json: 'application/json', txt: 'text/plain',
  zip: 'application/zip', srt: 'application/x-subrip', vtt: 'text/vtt',
}

const EXT_BY_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_BY_EXT).reverse().map(([ext, mime]) => [mime, ext]),
)

/** A local file's type, read from its extension (octet-stream when it is not one we know). */
export function mimeForFile(path: string): string {
  const ext = extname(path).replace('.', '').toLowerCase()
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

/**
 * Write each file to disk, streamed. One file goes to `target` when it names a file (or into it when it is an
 * existing directory); several go into `target` as a directory, created when missing. Each lands complete or not at
 * all: it is written beside its destination and moved into place once every byte arrived.
 */
export async function saveFiles(files: readonly FileToSave[], target: string | undefined, fetchFile: FetchFile = (url) => fetch(url)): Promise<SavedFile[]> {
  if (!files.length) throw new CliError('Nothing to download: the id named no files.', EXIT.GENERAL)
  const intoDirectory = files.length > 1 || target === undefined || isDirectory(target)
  const directory = resolve(intoDirectory ? (target ?? '.') : dirname(target as string))
  if (files.length > 1 && target !== undefined && existsSync(directory) && !isDirectory(directory)) {
    throw new CliError(`${target} is a file, and this id names ${files.length} files: name a directory to write them into.`, EXIT.USAGE)
  }
  mkdirSync(directory, { recursive: true })

  const saved: SavedFile[] = []
  for (const file of files) {
    const response = await fetchFile(file.url)
    if (!response.ok || !response.body) {
      throw new CliError(`${file.name} could not be downloaded (HTTP ${response.status}). Please try again.`, EXIT.GENERAL)
    }
    const fileName = intoDirectory ? savedName(file, response) : basename(target as string)
    const dest = join(directory, fileName)
    const partial = `${dest}.part`
    try {
      await pipeline(Readable.fromWeb(response.body as unknown as WebReadableStream<Uint8Array>), createWriteStream(partial))
      renameSync(partial, dest)
    } catch (err) {
      rmSync(partial, { force: true })
      throw err
    }
    saved.push({ ...(file.mediaId ? { mediaId: file.mediaId } : {}), name: fileName, path: dest, bytes: statSync(dest).size })
  }
  return saved
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * The name a file saves under: the one its link's response gives (which carries the extension the file's type
 * calls for), else the server's name with an extension from the response's type. Only a bare file name is ever
 * taken, never a path.
 */
export function savedName(file: FileToSave, response: Response): string {
  const fromHeader = fileNameFromDisposition(response.headers.get('content-disposition'))
  const name = safeName(fromHeader ?? file.name)
  if (extname(name)) return name
  const ext = extensionFor(response.headers.get('content-type')) ?? extensionOfUrl(file.url)
  return ext ? `${name}.${ext}` : name
}

function extensionOfUrl(url: string): string | null {
  try {
    const ext = extname(new URL(url).pathname).replace('.', '')
    return ext || null
  } catch {
    return null
  }
}

function fileNameFromDisposition(header: string | null): string | null {
  if (!header) return null
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header)
  if (star) {
    try {
      return decodeURIComponent((star[1] ?? '').trim()) || null
    } catch {
      /* fall through to the plain name */
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/.exec(header)
  return plain?.[1]?.trim() || null
}

function safeName(name: string): string {
  const bare = basename(name.replace(/\\/g, '/')).replace(/[\u0000-\u001f]/g, '').trim()
  return bare && bare !== '.' && bare !== '..' ? bare : 'download'
}

function extensionFor(contentType: string | null): string | null {
  if (!contentType) return null
  return EXT_BY_MIME[(contentType.split(';')[0] ?? '').trim().toLowerCase()] ?? null
}
