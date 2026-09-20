#!/usr/bin/env node
/**
 * The checks that must run BEFORE anything else looks at this file.
 *
 * ⛔⛔ **ORDER IS THE WHOLE POINT.** This used to live inside `build.mjs`, which the package script ran
 * AFTER `tsc`. A stray backtick in the stylesheet is a syntax error, so tsc failed first with three
 * `TS1005: ',' expected` pointing at prose inside a comment, and the guard that names the actual cause
 * never got to run. A guard placed after the thing it explains is not a guard.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
export const ENTRY = join(HERE, 'src', 'main.tsx')

/**
 * ⚠️⚠️ **A BACKTICK INSIDE THE CSS TEMPLATE ENDS IT, AND THE ERROR NAMES THE WRONG THING.**
 *
 * The stylesheet is one long template literal, so a comment inside it that quotes an identifier in
 * backticks closes the string early and the rest of the CSS is parsed as JavaScript. This has happened
 * twice: once from a comment containing a CSS declaration in backticks, once from a comment naming a
 * custom property in backticks.
 *
 * ⛔ esbuild does report it, but as `Expected ";" but found "cols"` pointing at prose inside a comment,
 * which describes the symptom and not the cause. Checking here costs nothing and names the actual rule:
 * inside that template, write identifiers plain.
 */
const source = readFileSync(ENTRY, 'utf8')
const CSS_OPEN = 'const styles = `'
const cssStart = source.indexOf(CSS_OPEN)
if (cssStart < 0) throw new Error('the stylesheet template was not found in the entry')
const cssEnd = source.indexOf('\n`\n', cssStart)
if (cssEnd < 0) throw new Error('the stylesheet template is not closed')
const strayBackticks = source.slice(cssStart + CSS_OPEN.length, cssEnd).split('`').length - 1
if (strayBackticks > 0) {
  throw new Error(
    `${strayBackticks} backtick(s) inside the CSS template literal will END it early. ` +
      'Comments in there must name identifiers without quoting them.',
  )
}

