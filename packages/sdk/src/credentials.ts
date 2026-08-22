/**
 * Where a ContentHero API key lives on a machine, and the order it is looked for in.
 *
 * ## Why this is in the SDK and not in the CLI
 *
 * It used to live only in `@contenthero/cli`, so the CLI could read a key written by `contenthero login`
 * and the MCP server could not. The MCP read `process.env.CONTENTHERO_API_KEY` and stopped there, which is
 * why every ContentHero MCP entry in `.mcp.json` carries a plaintext `ch_live_` key inline in its command
 * string, and why pointing the MCP at a different account meant editing three of them.
 *
 * The fix is not to copy the twenty lines into the MCP. "Where does the key live" would then have two
 * implementations that agree until the day one of them learns about a new location. Both packages already
 * depend on the SDK, so it belongs here and both read it.
 *
 * ## Why a separate entry point
 *
 * The SDK's main entry has zero dependencies and touches nothing but `fetch`, so it runs anywhere. This
 * module imports `node:fs` and `node:os`. Putting it behind `@contenthero/sdk/credentials` keeps that cost
 * on the callers that actually want it, rather than making the whole SDK Node-only for one feature.
 *
 * ## Switching accounts
 *
 * `CONTENTHERO_CONFIG_DIR` selects the whole profile directory, so a second account is a second directory
 * rather than a second copy of the config. One env var, no secret in any config file.
 *
 * ⚠️ A CHANGE OF ACCOUNT ALWAYS NEEDS THE CONSUMER RESTARTED. The MCP server caches its client for the
 * process lifetime, and that is deliberate rather than an oversight: a key that could change underneath a
 * running session would let a generation land in, and bill, an account nobody at the keyboard chose.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

/** A stored credential. JSON so it can grow (label, createdAt) without a format break. */
export interface StoredCredential {
  apiKey: string;
  /** The key's display label, when minted via the browser flow (e.g. "CLI (host)"). */
  label?: string;
  /** ISO timestamp the credential was stored. */
  createdAt?: string;
}

/** Non-secret preferences that sit beside the credential. */
export interface StoredConfig {
  /** Override API base URL (e.g. a preview deployment). */
  baseUrl?: string;
}

/** Where a key came from, so a caller can tell the user which account it is about to act as. */
export type KeySource = 'flag' | 'env' | 'file' | 'none';

export function configDir(): string {
  return process.env.CONTENTHERO_CONFIG_DIR || join(homedir(), '.contenthero');
}

export function credentialsPath(): string {
  return join(configDir(), 'credentials');
}

export function configPath(): string {
  return join(configDir(), 'config.json');
}

/**
 * Read a JSON file, tolerating absence and corruption alike.
 *
 * A missing or malformed file returns undefined rather than throwing, so a fresh machine simply falls
 * through the ladder to the next source instead of failing to start.
 */
function readJson<T>(path: string): T | undefined {
  try {
    if (!existsSync(path)) return undefined;
    const raw = readFileSync(path, 'utf8').trim();
    if (!raw) return undefined;
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export function readCredential(): StoredCredential | undefined {
  return readJson<StoredCredential>(credentialsPath());
}

export function readConfig(): StoredConfig {
  return readJson<StoredConfig>(configPath()) ?? {};
}

export interface ResolvedAuth {
  apiKey?: string;
  keySource: KeySource;
  baseUrl?: string;
}

/**
 * The auth ladder: an explicit value, then the environment, then the stored credential.
 *
 * ⚠️ THE ORDER IS THE CONTRACT, not an implementation detail. An explicit override has to beat a stored
 * profile or `--api-key` would silently do nothing on a machine that has logged in, and the environment has
 * to beat the file so a CI runner needs no filesystem state. Every consumer resolves through this one
 * function so they cannot disagree about which account is in effect.
 */
export function resolveAuth(explicit?: { apiKey?: string; baseUrl?: string }): ResolvedAuth {
  let apiKey: string | undefined;
  let keySource: KeySource = 'none';

  if (explicit?.apiKey) {
    apiKey = explicit.apiKey;
    keySource = 'flag';
  } else if (process.env.CONTENTHERO_API_KEY) {
    apiKey = process.env.CONTENTHERO_API_KEY;
    keySource = 'env';
  } else {
    const stored = readCredential();
    if (stored?.apiKey) {
      apiKey = stored.apiKey;
      keySource = 'file';
    }
  }

  const baseUrl = explicit?.baseUrl || process.env.CONTENTHERO_BASE_URL || readConfig().baseUrl || undefined;

  return { apiKey, keySource, baseUrl };
}
