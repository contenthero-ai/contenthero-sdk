/**
 * `contenthero config` - inspect and set non-secret CLI preferences.
 *   config list           show the resolved config (key source, base URL)
 *   config set <k> <v>    set a preference (currently: base-url)
 *   config path           print the config + credential file paths
 *
 * The active API key is never printed; only its source and a masked prefix.
 */

import type { Command } from 'commander'
import { configPath, credentialsPath, readConfig, writeConfig } from '../config.js'
import { resolveContext } from '../context.js'
import { emit, keyValues } from '../output.js'
import { CliError, EXIT } from '../errors.js'

/** Mask a key down to its non-secret display prefix. */
function maskKey(key: string | undefined): string {
  if (!key) return '(none)'
  return key.length > 12 ? `${key.slice(0, 12)}...` : 'set'
}

const SETTABLE = ['base-url'] as const

export function registerConfig(program: Command): void {
  const config = program.command('config').description('Inspect and set CLI preferences')

  config
    .command('list')
    .description('Show the resolved configuration (key source and base URL)')
    .action((_opts, command: Command) => {
      const ctx = resolveContext(command)
      const data = {
        keySource: ctx.keySource,
        apiKeyPreview: maskKey(ctx.apiKey),
        baseUrl: ctx.baseUrl ?? 'https://app.contenthero.ai (default)',
        configFile: configPath(),
        credentialsFile: credentialsPath(),
      }
      emit(data, ctx, (d: typeof data) =>
        keyValues([
          ['Key source', d.keySource],
          ['API key', d.apiKeyPreview],
          ['Base URL', d.baseUrl],
          ['Config file', d.configFile],
          ['Credentials', d.credentialsFile],
        ]),
      )
    })

  config
    .command('set')
    .description('Set a preference. Supported keys: base-url')
    .argument('<key>', `the preference to set (${SETTABLE.join(', ')})`)
    .argument('<value>', 'the value')
    .action((key: string, value: string, _opts, command: Command) => {
      const ctx = resolveContext(command)
      if (key !== 'base-url') {
        throw new CliError(
          `Unknown config key "${key}". Supported: ${SETTABLE.join(', ')}.`,
          EXIT.USAGE,
        )
      }
      const next = readConfig()
      next.baseUrl = value
      writeConfig(next)
      emit({ ok: true, baseUrl: value }, ctx, () => `Set base-url to ${value}`)
    })

  config
    .command('path')
    .description('Print the config and credential file paths')
    .action((_opts, command: Command) => {
      const ctx = resolveContext(command)
      const data = { configFile: configPath(), credentialsFile: credentialsPath() }
      emit(data, ctx, (d: typeof data) =>
        keyValues([
          ['Config file', d.configFile],
          ['Credentials', d.credentialsFile],
        ]),
      )
    })
}
