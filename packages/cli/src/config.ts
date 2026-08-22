/**
 * Credential and config WRITES for the CLI (`contenthero login` / `logout`).
 *
 * ⚠️ THE READ HALF MOVED TO `@contenthero/sdk/credentials`. It is shared with the MCP server, which
 * previously could not see a key written here at all and so read only the environment. Two implementations of
 * "where does the key live" agree right up until one of them learns about a new location, so paths, shapes and
 * the resolution order now have exactly one definition and this file re-exports it.
 */

import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import {
  configDir,
  configPath,
  credentialsPath,
  readConfig,
  readCredential,
  type StoredConfig,
  type StoredCredential,
} from '@contenthero/sdk/credentials'

// Re-exported so every existing CLI import keeps working and there is still one obvious place to look.
export { configDir, configPath, credentialsPath, readConfig, readCredential }
export type { StoredConfig, StoredCredential }

/** The write half needs the directory to exist; reads tolerate its absence. */
function ensureDir(): void {
  const dir = configDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
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

export function writeConfig(config: StoredConfig): void {
  ensureDir()
  writeFileSync(configPath(), JSON.stringify(config, null, 2) + '\n', { mode: 0o644 })
}
