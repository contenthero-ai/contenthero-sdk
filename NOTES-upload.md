# ROUND 3 (two connector gaps), 2026-10-22
NO APP-SIDE FINDING: the app already accepts kind logo (lib/editor/element-sections.ts:51 ELEMENT_KINDS = code, shape, emoji, logo; app/api/v1/templates/route.ts:21,34 validates against it; lib/api/templates.ts:284 handles kind logo and returns rows with kind logo).
GAP 1 cause: this repo's kind enum is stale (sdk types.ts TemplateKind, mcp server.ts list_templates, cli commands/template.ts KINDS) and omits logo. Fix: add logo in all three, tests. Not an alias of category: kind is how a row is drawn, logo is a real kind in the app's single list.
GAP 2: already fixed in the code here (commit 22f20c6, unreleased: describeTranscribeCost names the post by itemHandle, short id plus appUrl; the app sends shortId/appUrl, lib/transcripts/transcribe-post.ts:106). The connector that showed a UUID runs an older published build. Only add missing tests (sdk, cli) for the cost text with a handle.
Progress: DONE. Both committed; build, npm test (sdk 180, mcp 397, cli 175) and check:spelling green; mcp/cli resolve sdk via node_modules symlinks to this worktree. Wording: the list_templates description still says 'code, a shape or an animated emoji' (not edited; see final message).

# NOTES-upload (untracked)
Setup: npm ci OK (public packages). node_modules/@contenthero/sdk -> ../../packages/sdk (this worktree, symlink). Verify dist path later.
## Done
- read spec + app contract
## Todo
SDK, MCP, CLI, tests, README/CHANGELOG, stale refs, WORDING-FOR-APPROVAL.md
## Stale refs elsewhere
(none yet)
- SDK done: upload.ts (runUpload), client methods createUpload/signUploadParts/completeUpload/abortUpload/upload/import, types, tool-text consts, upload.test.ts. Break-verify of resume + ETag order done (both failed when mechanism removed).
- Renames: ImportMediaInput->ImportInput; ImportedMedia/UploadedMedia kept.

## Progress
- SDK committed. MCP committed (396 tests). CLI upload.ts written, media upload removed; CLI tests next, then docs, WORDING, stale grep.

Reusing download.ts from packages/cli/src/commands for the top-level command shape; mimeForFile from packages/cli/src/save-files.ts; uploadedHuman moved to commands/upload.ts; local http server test pattern from style-library.test.ts; EXPRESSED_BY_STRUCTURE from cli-parity.test.ts; tool-text.ts constants pattern from LIST_STYLE_LIBRARIES_TEXT.

## Done
SDK, MCP, CLI, docs, WORDING-FOR-APPROVAL.md committed. Build, mcp tsc, cli tsc, npm test pass (sdk 169, mcp 396, cli 175).

## Stale references elsewhere (not edited)
- contenthero-docs/mcp/tools/media.mdx lines 153-170: create_media_upload and complete_media_upload sections; contenthero-docs/guides/pipeline.mdx line 64 and contenthero-skills/skills/contenthero/references/planner.md line 73 describe uploaded media generically (check wording only).
- contenthero-skills/COOKBOOK.md line 73 and skills/contenthero/references/media-library.md lines 35-38: old tool names and the 25-file cap wording. CHANGELOG.md line 83 mentions import_media in history (leave).
- contenthero-app-wt-uploads: no SDK client calls to uploadMedia/importMedia found. Matches are app-internal functions (completeMediaUpload in lib/api/media-uploads.ts, importMedia helpers, tests) and the plan .claude/plans/upload-session-v1.md; the app route files app/api/v1/media/uploads/** name them in comments.

# ROUND 2 (resume from the server), started 2026-10-22
Found: SDK already has client-held `resume: UploadResume` (object). Plan: replace with output id string (server is truth; branch unreleased). Error on failure gets outputId + resumable.
Todo: [ ] SDK listUploadParts+resume+error outputId  [ ] MCP sign_upload_parts prose + WORDING  [ ] CLI --resume  [ ] tests + break-verify  [ ] build/test/clean
- Round2 SDK committed (22 upload tests, break-verified resume-only-missing). Next MCP.
- Round2 MCP committed + WORDING. Next CLI --resume.
- Round2 CLI+docs committed; root build/test green (sdk 175? see final). DONE.

# ROUND 3 (audio facts, project summary flags), 2026-10-22
Reusing describeFileSize (packages/sdk/src/describe.ts) for the shared audio facts line; process-test pattern from packages/cli/src/commands/project-scope.test.ts; fakeClient/connect from packages/mcp/src/server.test.ts.
Findings (briefing assumed things that do not exist):
- MCP get_media uses client.getMediaBatch (ResolvedMediaBatchItem), never getMedia/MediaItem.variations, and the app's batch path does not carry `audio`. So the MCP has no surface that renders a variation's audio facts; nothing changed there (description accurate, no edit).
- No shared project-summary formatter exists: MCP get_project and CLI project get print `state` as raw JSON (CLI --human prints no composition for a whole read). Flags pass through; no formatter was added. Added exported types ProjectSummaryTrack/ProjectSummaryClip in the SDK.
Done: SDK audio + describeAudioFacts + types + tool-text edit; CLI media get Audio block; tests; changelogs. Next: root build/test, final.
