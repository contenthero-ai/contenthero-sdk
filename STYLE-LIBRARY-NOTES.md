# Style library notes (SDK, MCP, CLI)

Worktree: /Users/taylanalpan/Developer/Projects/contenthero-sdk-wt-style-libraries, branch feature/style-libraries (base main 6df46cc).
Install done with npm ci (NPM_TOKEN from GITHUB_PAT). Not committed: this file.

## Decisions
- SDK is flat methods (listSpaces style), so `styleLibraries.list/...` of the brief is `listStyleLibraries/getStyleLibrary/createStyleLibrary/updateStyleLibrary`.
- Texts live once in packages/sdk/src/tool-text.ts (approved words), MCP and CLI import them.
- Approved descriptions carry no "Requires the X scope." sentence (other MCP tools do); kept word for word.
- No op list in SDK/MCP/CLI for set_style_library: ops are passthrough, get_schema serves the catalog.

## Status
- [x] SDK (types, client, tool-text, index, tests)
- [ ] MCP
- [ ] CLI
- [ ] version bumps + changelogs (sdk 0.4.35, mcp 0.4.42, cli 0.3.32)

## Wording to approve
(filled as written)

## Status (final)
SDK, MCP, CLI done; bumps prepared (sdk 0.4.35, mcp 0.4.42, cli 0.3.32); nothing published or pushed.

## Wording to approve (new strings, not in the approved texts)
- describeStyleLibraryPins (SDK, printed by MCP get_project and CLI project get): "Style libraries pinned:", "  - NAME, version N", ", newest M", ", no longer readable", "      version X: notes".
- MCP formats: "No style libraries found.", "N style library(ies):", "Versions, newest first:", "No version published.", "Pinned by: ...", "Pinned by no project.", "Created|Updated style library NAME (id X), latest version N." / "no version published", "updated <updatedAt>".
- CLI group description "Style libraries: shared code that projects pin and import".
- CLI flags: --module <name=file> "a module by name, its whole code read from a file; repeatable"; --project-module "a module of --from-project to publish; repeatable"; --project-revision "the revision of --from-project the modules are read at"; --clear-description "remove the description"; --edits "a module's edits against --base-version, read from a JSON file; repeatable"; --drop-module "a module to drop; repeatable".
- CLI error texts: "--X takes <name>=<file>, got ...", "--from-project goes with at least one --project-module.", "--project-module and --project-revision go with --from-project.", "Give --description or --clear-description, not both."
- Deviations: flat SDK methods (listStyleLibraries etc.); CLI get flag is --at-version because --version is the program's own; list text clause changed to "when it was last updated" (approved by Taylan).
- Scope sentence left off the approved descriptions.
