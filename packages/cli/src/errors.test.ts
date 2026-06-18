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
} from '@contenthero/sdk'
import { CliError, EXIT, exitCodeForError, messageForError } from './errors.js'

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
