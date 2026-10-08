# Changelog

## Unreleased

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
