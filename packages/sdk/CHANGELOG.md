# Changelog

## Unreleased

- Fixed: a wait that ends with the job still running names it as the start did. `GenerationTimeoutError` and
  `GenerationInterruptedError` carry `shortId` and `appUrl` when the start returned them (`generateAndWait`,
  `generateBoardAndWait`, `importMedia`, `exportProjectAndWait`, whose timeout now names the export instead of
  "generation"). `pendingJob(err)` returns `{ outputId, shortId?, appUrl? }`; `pendingOutputId` is derived from it.
- New: `statusTarget(job)`, the one rule for how `getStatus` follows a job (its short id alone, else its full id with
  its kind), and `statusTargetOf(status)` for reading a status again. `SubmittedJob` and `WaitCall` are exported.
- New fields, from the server (absent from an older one): `shortId` on `GenerateResult`, `Generation`,
  `EnhanceClipsJob` (with `appUrl`) and `Transcription` (with `appUrl`); `shortId` and `appUrl` on
  `ContentAnalysisResult` and `ContentScenesResult`; `generatingAppUrl` on `EditorOpResult`.
- Fixed: `describeEditorOps` named an editor effect's job by its full id with no kind, a wait the status route
  refuses. It names each job with its kind and its link, and takes `{ waitCall }` so each surface prints its own call.
- Fixed: one id the server cannot answer for no longer fails a read of several. `waitForStatus` hands it back in its
  own place as `state: 'unanswered'` with the server's reason and `httpStatus` (404 when it names no job of yours,
  400 when it needs its kind or is not an id, 403 when the key lacks the scope), and every other id still answers.
  Only what would fail every id alike (the key refused, the rate limit, no answer at all) still throws.
- New: `getStatuses(targets)`, the instant snapshot of several ids under the same per-id rule. `JobStatusUnanswered`
  and `JobStatusResult` (a `JobStatus` or a `JobStatusUnanswered`) are exported.
- Breaking (types only): `waitForStatus` returns `JobStatusResult[]`; narrow on `state !== 'unanswered'` before
  reading `kind` or `detail`.

## 0.4.27

- New: `getStatus(id, { kind? })` reads any background job (an output, an export, a brand kit read, an avatar, a
  content analysis, a transcript) from `GET /api/v1/status/{id}`, as a `JobStatus` whose `detail` is the kind's own
  resource. `waitForStatus(targets, options)` waits for several under one deadline and hands each back finished or as
  last read. `JobKind`, `JOB_KINDS`, `JobState`, `JobStep`, `JobStatus`, `JobTarget` and `TranscriptJobDetail` are
  exported.
- Breaking: `waitForGenerations` is removed; `waitForStatus` replaces it. `waitForGeneration` (behind
  `generateAndWait`, `generateBoardAndWait` and `importMedia`) now reads the status route, so the server alone
  decides when a generation is done.
- Docs: `startExport`, `listExports`, `exportProjectAndWait` and `analyzeContent` name `getStatus` for waiting;
  `getExport` reads one export.
- Breaking (hard cutover, no alias): `shareMedia` and `shareProject` are one `share(input)`, reaching
  `POST /api/v1/share` (was `/api/v1/media/share` and `/api/v1/projects/{projectId}/share`). Media is named by
  `mediaIds` (with `title`, or `shareUrl` to stop a link); anything else by `assetType` and `id`, today `'project'`.
  `shared: false` stops sharing either. Each kind keeps its scope: `studio:write` for media, `editor:write` for a
  project. `ShareInput`, `ShareItemInput` and `ShareAssetType` are exported; `ShareProjectInput` is removed.
- Breaking (hard cutover, no alias): `saveProjectVersion` is `createProjectVersion`, and `SavedProjectVersion` is
  `CreatedProjectVersion`.
- Breaking (hard cutover, no alias): `listProjectExports(projectId, page)` is `listExports(projectId, page)`, and
  `ProjectExportListResult` is `ExportListResult`. It still pages by cursor.

## 0.4.26

- Breaking: a project's settings are read by `getProject` and changed by `updateProject`. `ProjectDetail` gains
  `loudness`, `magneticTrack`, `linkage` and `linkedTracks` (`ProjectSettings`, beside `fps`); `UpdateProjectInput`
  gains `fps`, `loudness`, `magneticTrack`, `linkage` and `linkedTracks`, and `updateProject` returns the project with
  its settings (`ProjectWithSettings`). The settings belong to the project and are shared by everyone who edits it;
  a change is an edit that `undo` reverses. `getTimelineSettings`, `updateTimelineSettings`, `TimelineSettings` and
  `TimelineSettingsChange` are removed. Snapping, skimming, follow playhead and skip disabled clips are the editor's
  own, per person, and reach no tool.

- Breaking (hard cutover, no alias): `getContext` is `view`, reading `GET /api/v1/view` (was `/api/v1/context`).
  `GetContextInput` is `ViewInput` and `LiveContextResult` is `ViewResult`. `ViewInput` gains `video` (watch a range
  play; where video cannot be received the frames come back in `rendered` and the sound measured in `renderedSound`),
  and `assetId` or `mediaUrl` with `fromSec` and `toSec` to see a raw source clip, which comes back as
  `context.clip`. `sound` is sent as given: the server now renders it without `render`.
- New: `describeClip` says what a raw clip a view read is, the window read, and why it or its keyframes could not be
  read.
- Breaking: `getMediaBatch` no longer reads a clip's frames: `MediaBatchItem` drops `fromSec`, `toSec`, `frames` and
  `frameWidth` (`MediaClipWindow` is removed), and `ResolvedMediaBatchItem` drops `keyframes` and `keyframeError`; its
  `region` zooms an image only. Use `view`: `ViewInput.region` on a source clip is in the clip's own pixels and cuts
  each of its frames, and `context.clip` carries `crop` or `cropError`. New: `describeCrop` says how a region maps
  back, or why it was not cut, in one wording for get_media and a view clip; `describeClip` includes it.
- Breaking: `copyProjectVersion` is removed. A copy from a saved version is `duplicateProject(projectId, { versionId })`.
  `restoreProjectVersion` sends no body: the version route only restores.
- Breaking: `renameProjectVersion(projectId, versionId, label)` is `updateProjectVersion(projectId, versionId, { label })`,
  named after the MCP tool `update_project_version`.

## 0.4.25

- Breaking: a project's delivery loudness is a project setting. `TimelineSettings.loudness` (`Loudness`: a target
  integrated loudness in LUFS, or `'off'`) is read by `getTimelineSettings` and changed by `updateTimelineSettings`;
  unlike the other settings it belongs to the project, so every collaborator and every export follows it.
  `StartExportInput.normalizeLoudness` is removed: `loudness` sets one export's loudness in place of the project's.
  `ExportJob.loudness` and `ProjectExport.loudness` (`ExportLoudness`) report how a finished export's loudness came
  out, with `summary` as the one line the app shows; `describeExportLoudness` and `withExportLoudness` print it, and
  `describeLoudness` prints a setting.
- `shareMedia` stops sharing with `shared: false`: a generation's link by one media id, or any media link as
  `shareUrl`. `MediaShare` gains `shared`, and its `shareUrl` is null once stopped.
- New: `listProjectExports(projectId, { limit, cursor })` reads a project's exports a page at a time, as the editor's
  Exports tab lists them (`ProjectExport`, `ProjectExportListResult`), each with `appUrl` and, once finished,
  `shareUrl`.
- New: share links reach the API. `shareProject(projectId, { shared })` makes a project's public live link or revokes
  it (`editor:write`); `shareMedia({ mediaIds, title })` shares outputs of finished generations, one as its
  generation's link and several as a new set (`studio:write`). `ProjectDetail.shareUrl` and `ExportJob.shareUrl` (once
  completed) read the links. One wording for them: `describeProjectShare`, `describeProjectShareLink`,
  `describeExportShareLink`, `describeMediaShare`.

- Breaking: the preview video is retired. `createPreview`, `getPreview` and their types (`PreviewInput`, `PreviewJob`,
  `PreviewPreparing`, `PreviewStart`, `PreviewStatus`) are removed with `/api/v1/preview`. `GetContextInput.mode` is
  removed: images are the render's only medium, and frames across a range are how an agent judges motion. A render's
  `rendered` no longer reports a `mode`.
- Scope names in the docs follow the API's rename: `brand:read` (was `brandkit:read`), `brand:write` (was
  `brandkit:write`), `library:write` (was `assets:write`); `updateTrackedAccount` needs `inspiration:write`.
- Breaking: every hand-arranged list moves by neighbor or end, with one `Placement` (`afterId`, `beforeId`, or
  `position: 'top' | 'bottom'`, `PLACEMENT_ENDS`); neighbors and an end together are refused. `createCard` and
  `updateCard` (within the column, or the column it moves to), `createStage` and `updateStage`, `updateBrandKit` (the
  kit among the caller's) and each section write (within its tab, neighbors are section ids), `updateAvatar`,
  `createTemplate` and `updateTemplate` (a placement alone is a move) take it. A stage's edge is `position`, no
  longer a null neighbor.
- Breaking: `reorderBrandKits` is removed (the API refuses `orderedIds`); move one kit with `updateBrandKit`.
- Breaking: `TemplateFields.orderKey` is removed (the API refuses it).
- New: `updateTrackedAccount` moves a tracked account within its list (`PATCH /api/v1/accounts/{id}`).
- New: `updateFolder`'s `moveItem` (`FolderItemMove`) moves one item within a manual folder.
- `LIST_SORTS.cards` adds `position`: one stage's own order, top first; it needs a stage.

- Breaking: every response field is camelCase, as the API now declares it.
  - `TemplateSummary`/`Template`: `propsSchema`, `durationFrames`, `widthFraction`, `heightFraction`, `thumbnailUrl`,
    `previewUrl`, `codeMd5`, `sourceTemplateId`, `sourceTemplateVersion`, `archivedAt`, `groupKey`, `subgroupKey`,
    `createdAt`, `updatedAt`; the six artboard columns are one `artboard: { width, height, content: { x, y, width,
    height } } | null` (`TemplateArtboard`). `user_id`, `created_by`, `order_key` and `featured_rank` are gone.
  - `KlingElement`: `inputUrls`, `inputVideoUrl`, `previewUrl`, `createdAt`, and `updatedAt`.
  - `BrandKit.logos`, `assets` and `socialAccounts` are typed (`BrandKitLogo`, `BrandKitAsset`, `BrandKitSocialAccount`)
    with `isPrimary`, `isDisplay`, `aspectRatio`, `isFavorited` and `avatarUrl` (was `profile_image_url`). Logo and
    asset inputs are typed too (`BrandKitLogoInput`, `BrandKitAssetInput`) and send `isPrimary`, `isDisplay` and
    `aspectRatio`; the API refuses the snake spellings.
  - `ProjectVersion`: `createdBy`, `authorName`, `triggerReason`, `sizeBytes`, `createdAt`; a save returns the same
    shape (`SavedProjectVersion`).
  - `deleteStage` reads `movedCards`.
- Breaking: a manual position is never on the API, since a list comes back in its order and a move names neighbors.
  `sortOrder` is gone from `Stage`, `CardAsset` and `BrandKitSection`; `Folder.position` and the folder inputs'
  `position` are gone. `updateStage` returns the `Stage` (no `respaced`).
- Breaking: an editor op's id is `opId` (was `op_id`), which `applyEditorOps` mints when an op has none.

- Breaking: `listMedia` follows the library-file contract. `source` is `all` (the default when none is named),
  `creations`, `uploads` or `exports` (`MEDIA_LIST_SOURCES`); `stock` and `files` are for a single read only.
  `contentType` takes `image`, `video`, `audio`, `doc` and `other` (`MEDIA_LIST_TYPES`), not `transcript`. `kind` is
  `creation`, `board` or `look` (no `upload`: that is `source: 'uploads'`). `status` takes only `completed`. It sorts by
  `sort` and `order` (`LIST_SORTS.media`: `createdAt`, `fileName`, `sizeBytes`; `fileName` is refused for creations).
- `MediaSummary` carries `sizeBytes`; `MediaType` adds `doc` and `other`; `MediaSource` adds `exports`.
- New: `describeFileSize`, a file size in the units the app shows.
- Breaking: every sortable listing sorts by `sort` (a field of that list) and `order` (`asc` | `desc`), declared once in
  `LIST_SORTS` (`cards`, `projects`, `spaces`, `content`) with `SORT_ORDERS`; `CardSort`, `ProjectSort`, `SpaceSort` and
  `ContentSort` are typed from it. `listCards`, `listProjects`, `listSpaces` and `listContent` take them (`SortOptions`).
  `CONTENT_SORTS` is gone, and `listContent`'s `sortBy` / `sortOrder` are gone: the content fields are `relevance`
  (with a search only), `outlierScore`, `publishedAt`, `viewCount` and `engagementRate`.
- Breaking: every growable listing pages by cursor. `listAvatars`, `listVoices`, `listBrandKits`, `listTags`,
  `listTrackedAccounts`, `listConnectedAccounts`, `listKlingElements`, `listStages`, `listSpaces`, `listFolders` and
  `listTemplateCategories` take `limit` and `cursor` and return their items under their own key with `nextCursor`
  (`AvatarListResult`, `VoiceListResult`, `BrandKitListResult`, `TagListResult`, `TrackedAccountListResult`,
  `ConnectedAccountListResult`, `KlingElementListResult`, `StageListResult`, `SpaceListResult`, `FolderListResult`,
  `TemplateCategoryListResult`), where most returned a plain array before.
- Breaking: `ContentListResult` holds its items under `content` (was `outliers`). Tracked accounts arrive under
  `trackedAccounts` and connected accounts under `connectedAccounts`, as the API now sends them.
- Breaking: `Space.postCount` is `cardCount`. `listSpaces` takes `archived` (only archived spaces; was
  `includeArchived`), `favorited` and `search`.
- `listCards` takes `tag`, and `spaceId: 'all'` for every space; `CardListResult.space` is then null.
- Every wire name is camelCase, as the API now requires (an old name is refused with a 400): `listCards` sends
  `spaceId` and `isFavorite`, `listStages` `spaceId`, `listTrackedAccounts` `accountType` and `brandKitId`, `listContent`
  its filters (`contentType`, `outlierScoreMin`, `publishedAfter`, `accountIds` and the rest), `getContent` `startMs`,
  `endMs` and `transcriptSearch`; stage and space writes send `spaceId`, `afterId`, `beforeId`, `targetStageId`,
  `coverUrl`, `coverPosition` and `duplicateFrom`.
- New: `updateProject` (title, orientation, width, height, `brandKitId`, `coverPosition`, `cover`), `duplicateProject`,
  `getTimelineSettings` / `updateTimelineSettings`, the version history (`listProjectVersions`, `saveProjectVersion`,
  `restoreProjectVersion`, `copyProjectVersion`, `renameProjectVersion`, `deleteProjectVersion`), and `undo` / `redo`.
  `ProjectSummary` carries `coverSource` and `coverFrame`, as the API sends them.

## 0.4.24

- Breaking: the clip type `graphic` is retired and renamed `code`: a code clip or code layer is a video, audio or image
  whose content is code. `TemplateKind` is `'code' | 'shape' | 'emoji'` (was `'graphic'`), so `listTemplates` takes
  `kind: 'code'`.
- Breaking: `getGraphicGuide` is `getCodeGuide`, and reads `GET /api/v1/editor/code-guide` (was `graphic-guide`).
  `GraphicGuide` is `CodeGuide`, `GraphicDiagnostic` is `CodeDiagnostic`, `describeGraphicWarnings` is
  `describeCodeWarnings`, `withGraphicWarnings` is `withCodeWarnings`, and the effect list's `graphicHosts` is
  `codeHosts`.
- Breaking: the error code `GRAPHIC_FAILED` is `CODE_FAILED`, and the live-context error code `graphic_failed` is
  `code_failed`.
- Breaking: `TemplateSummary` drops `render_backend`, `lottie_url` and `lottie_recolor`. `skeleton.type` is
  `'video' | 'shape'` (was `'graphic' | 'shape'`); an animated emoji template is `{ type: 'video', emoji }`. A template
  is an emoji when `skeleton.emoji` is set, a shape when `skeleton.type` is `'shape'`, and code otherwise.
  `TemplateFields` (`code`, `lottie`, `emoji`, `shape`) is unchanged.
- The words printed for compiler findings: `Graphic warnings:` is `Code warnings:`, `Graphic code:` is `Code:`, and each
  finding reads `- code in <id> ...` (was `- graphic <id> ...`).

## 0.4.23

- Breaking: every paged listing pages by cursor. `listMedia`, `searchMedia`, `getFolder`, `listCards`, `listContent`,
  `listBrandKnowledge`, `listTemplates` and `listProjects` take `limit` and `cursor` (the shared `PageOptions`); `offset`
  is gone. Each returns its items under its own key with `nextCursor` (the shared `Paged`), null on the last page.
  `hasMore` is gone: a null `nextCursor` says it. `total` stays on cards, content and brand knowledge.
- Breaking: `listMedia` returns `MediaListResult` (`{ media, nextCursor }`), `searchMedia` returns `SearchMediaPage`
  (`{ results, nextCursor }`), `getFolder` returns `FolderContents` (`{ folder, items, nextCursor }`) and `listProjects`
  returns `ProjectListResult` (`{ projects, nextCursor }`), where they returned a plain array before.
