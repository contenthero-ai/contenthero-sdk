import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AuthenticationError,
  PermissionError,
  ValidationError,
  NotFoundError,
  RateLimitError,
  GenerationTimeoutError,
  ContentHeroError,
  InsufficientCreditsError,
  SpendCapReachedError,
} from '@contenthero/sdk'
import { CliError, EXIT, errorFieldsFor, exitCodeForError, messageForError } from './errors.js'

test('CliError carries its explicit exit code', () => {
  assert.equal(exitCodeForError(new CliError('x', EXIT.USAGE)), EXIT.USAGE)
  assert.equal(exitCodeForError(new CliError('x')), EXIT.GENERAL)
})

test('auth and permission errors map to exit 3', () => {
  assert.equal(exitCodeForError(new AuthenticationError()), EXIT.AUTH)
  assert.equal(exitCodeForError(new PermissionError()), EXIT.AUTH)
})

test('validation errors map to the usage exit code', () => {
  assert.equal(exitCodeForError(new ValidationError()), EXIT.USAGE)
})

test('generation timeout maps to exit 4 (accepted but unfinished)', () => {
  assert.equal(exitCodeForError(new GenerationTimeoutError('out_1')), EXIT.TIMEOUT)
})

test('other SDK and unknown errors fall back to general (exit 1)', () => {
  assert.equal(exitCodeForError(new NotFoundError()), EXIT.GENERAL)
  assert.equal(exitCodeForError(new RateLimitError()), EXIT.GENERAL)
  assert.equal(exitCodeForError(new ContentHeroError('boom')), EXIT.GENERAL)
  assert.equal(exitCodeForError(new Error('plain')), EXIT.GENERAL)
  assert.equal(exitCodeForError('a string'), EXIT.GENERAL)
})

test('messageForError reads Error.message and stringifies the rest', () => {
  assert.equal(messageForError(new Error('hello')), 'hello')
  assert.equal(messageForError('raw'), 'raw')
})

test('a limit refusal exits 5, says its message and ways to continue, and names its code and actions in JSON', () => {
  const actions = [{ id: 'raise_cap' as const, label: 'Raise spend cap', url: 'https://app.contenthero.ai/billing#spend-cap' }]
  const err = new SpendCapReachedError("You've reached your monthly spend cap.", { actions, cap: 500, spent: 495 })
  assert.equal(exitCodeForError(err), EXIT.LIMIT)
  assert.equal(exitCodeForError(new InsufficientCreditsError()), EXIT.LIMIT)
  assert.equal(
    messageForError(err),
    "You've reached your monthly spend cap.\nWays to continue:\n- Raise spend cap: https://app.contenthero.ai/billing#spend-cap",
  )
  assert.deepEqual(errorFieldsFor(err), { code: 'spend_cap_reached', actions })
  assert.deepEqual(errorFieldsFor(new ContentHeroError('boom')), {})
})
