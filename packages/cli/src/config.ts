/**
 * On-disk config + credential storage for the CLI.
 *
 * Two files under the config dir (default `~/.contenthero`, override with
 * CONTENTHERO_CONFIG_DIR):
 *   - `credentials`  : the stored API key (written by `contenthero login`).
 *                      Mode 0600; it is the only secret on disk.
 *   - `config.json`  : non-secret preferences (e.g. baseUrl).
 *
 * Reads tolerate a missing or malformed file by returning empty, so a fresh
 * machine just falls through the auth ladder to env / flag. Writes create the
 * dir at 0700 first.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'

/** A stored credential. JSON so we can grow it (label, createdAt) without a format break. */
export interface StoredCredential {
  apiKey: string
  /** The key's display label, when minted via the browser flow (e.g. "CLI (host)"). */
  label?: string
  /** ISO timestamp the credential was stored. */
  createdAt?: string
}

/** Non-secret CLI preferences. */
export interface StoredConfig {
  /** Override API base URL (e.g. a preview deployment). */
  baseUrl?: string
}

export function configDir(): string {
  return process.env.CONTENTHERO_CONFIG_DIR || join(homedir(), '.contenthero')
}

export function credentialsPath(): string {
  return join(configDir(), 'credentials')
}

export function configPath(): string {
  return join(configDir(), 'config.json')
}

function ensureDir(): void {
  const dir = configDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
}

function readJson<T>(path: string): T | undefined {
  try {
    if (!existsSync(path)) return undefined
    const raw = readFileSync(path, 'utf8').trim()
    if (!raw) return undefined
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}

export function readCredential(): StoredCredential | undefined {
  return readJson<StoredCredential>(credentialsPath())
}

export function writeCredential(cred: StoredCredential): void {
  ensureDir()
  const path = credentialsPath()
  writeFileSync(path, JSON.stringify(cred, null, 2) + '\n', { mode: 0o600 })
  // writeFileSync only applies mode on create; force it in case the file existed.
  chmodSync(path, 0o600)
}

export function clearCredential(): boolean {
  const path = credentialsPath()
  if (!existsSync(path)) return false
  rmSync(path)
  return true
}

export function readConfig(): StoredConfig {
  return readJson<StoredConfig>(configPath()) ?? {}
}

export function writeConfig(config: StoredConfig): void {
  ensureDir()
  writeFileSync(configPath(), JSON.stringify(config, null, 2) + '\n', { mode: 0o644 })
}
