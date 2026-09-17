#!/usr/bin/env node
/**
 * ContentHero CLI entrypoint.
 *
 * Owns the single error boundary: commander runs with exitOverride, so every
 * parse error, help/version display, and action rejection lands here and maps to
 * one exit code (see errors.ts). Errors print as JSON by default (agent-first)
 * and as a red line under --human, matching command output.
 */

import { CommanderError } from 'commander'
import pc from 'picocolors'
import { buildProgram } from './program.js'
import { EXIT, exitCodeForError, messageForError } from './errors.js'
import { releaseCliPresence } from './context.js'

/**
 * Exit only once stdout has actually reached the OS.
 *
 * `process.exit()` does NOT flush buffered stdout, and Node's stdout is ASYNCHRONOUS when
 * it is a pipe (it is synchronous for files and TTYs, which is why this never showed up
 * by hand). So a command whose output exceeds the 64KB pipe buffer had the remainder
 * discarded the moment we exited.
 *
 * Measured on cli 0.3.4: `contenthero schema` wrote 93,998 bytes to a file and 65,536
 * bytes through a pipe. The whole point of `schema` is that an agent can discover the
 * command surface, and agents read through pipes, so every agent calling it received
 * truncated JSON that could not be parsed. Any command whose output crosses 64KB was
 * affected, not just this one.
 *
 * Setting `process.exitCode` and returning would also fix the truncation, but it leaves
 * the process alive until every handle closes, and an HTTP keep-alive socket can hold it
 * open for seconds after the work is done. Draining first and then exiting keeps the
 * immediate exit and loses nothing.
 */
async function exitAfterFlush(code: number): Promise<never> {
  if (process.stdout.writableLength > 0) {
    await new Promise<void>((resolve) => process.stdout.write('', () => resolve()))
  }
  process.exit(code)
}

async function main(): Promise<void> {
  const program = buildProgram()

  // Bare invocation: show help and exit cleanly rather than erroring.
  if (process.argv.slice(2).length === 0) {
    program.outputHelp()
    await exitAfterFlush(EXIT.OK)
  }

  // Compute the exit code, then release editor presence BEFORE exiting (process.exit would skip a finally), so
  // an open editor's "Editing via CLI" badge clears immediately rather than lingering on the sliding TTL.
  let exitCode: number = EXIT.OK
  try {
    await program.parseAsync(process.argv)
  } catch (err) {
    // Help and version display, and parse errors, come through as CommanderError.
    // Commander already wrote the message; we only set the exit code.
    if (err instanceof CommanderError) {
      exitCode = err.exitCode === 0 ? EXIT.OK : EXIT.USAGE
    } else {
      exitCode = exitCodeForError(err)
      const message = messageForError(err)
      if (process.argv.includes('--human')) {
        process.stderr.write(pc.red(`Error: ${message}`) + '\n')
      } else {
        process.stderr.write(JSON.stringify({ error: message, exitCode: exitCode }, null, 2) + '\n')
      }
    }
  }

  await releaseCliPresence().catch(() => {})
  await exitAfterFlush(exitCode)
}

void main()
