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

async function main(): Promise<void> {
  const program = buildProgram()

  // Bare invocation: show help and exit cleanly rather than erroring.
  if (process.argv.slice(2).length === 0) {
    program.outputHelp()
    process.exit(EXIT.OK)
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
  process.exit(exitCode)
}

void main()
