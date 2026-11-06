# Wording for approval: upload session

Status: ALL wording in this file, including the resume line added 2026-10-22, was approved by Taylan on 2026-10-22. The code already carries it verbatim.

Every new or changed tool and parameter description, verbatim from the SDK constants in packages/sdk/src/tool-text.ts, plus the two sentences written inline in the MCP. Each carries a one-line reason. Nothing here states a size, a count or a limit another system owns.

## create_upload

Reason: replaces create_media_upload; the size is now required and the answer is a target that is one URL or a part plan.

> Begin uploading local files as library media. Takes each file's name, type and size in bytes, and answers for each an upload target, which is a temporary write permission and not a media address. A single target: PUT the whole file to its url with exactly its headers. A multipart target: the file goes in parts of the size it states, each signed with sign_upload_parts; PUT each part to its url and keep the ETag header of the store's answer. Then call complete_upload once for the batch. The finished media is referenced by its outputId in generate_* and on a card via update_card. For a file already at a public address, use import. Requires the library:write scope.

Parameters:
- files: The files to upload.
  Reason: Names the batch without repeating the per-file fields.
- fileName: The file name, used for its extension.
  Reason: Same role as before: the extension tells the type.
- contentType: The MIME type of the file.
  Reason: Unchanged role.
- sizeBytes: The size of the file in bytes. The store chooses how the file is uploaded from it.
  Reason: New and required: the server picks single or multipart from it, so the caller needs no rule of its own.

## sign_upload_parts

Reason: new tool; a multipart part URL is a short permission signed on demand and safe to ask again, which is what makes resume cheap.

> Sign parts of a multipart upload. Takes the outputId create_upload answered and the numbers of the parts to send, counted from 1. Answers a url and headers for each: PUT that part's bytes to its url with exactly those headers and keep the ETag header of the store's answer. Part n starts at (n - 1) times the part size create_upload stated and is that long, the last part ending where the file ends. Signed when asked and safe to ask again, so a slow or interrupted upload asks only for the parts it still needs. Requires the library:write scope.

Parameters:
- outputId: The outputId create_upload answered for the file.
  Reason: Ties the request to the upload that create_upload began.
- partNumbers: The numbers of the parts to sign, counted from 1.
  Reason: Lets a caller ask only for the parts it still needs.

## complete_upload

Reason: replaces complete_media_upload; it now carries the ETags a multipart file needs, and finishing twice is safe.

> Finish uploads once their bytes were sent. Takes each file's outputId and, for a multipart file, the number and ETag of every part, exactly as the store answered. Finish a batch together, so the person sees it as one card. Publishes each file and answers its outputId and URL. Finishing twice answers the same media. Requires the library:write scope.

Parameters:
- uploads: The files to finish.
  Reason: One call finishes the batch so it shows as one card.
- outputId: The outputId create_upload answered for the file.
  Reason: Ties each entry to its upload.
- parts: Multipart files only: the number and ETag of every part, exactly as the store answered its PUT.
  Reason: Only multipart files send it, since the store needs every ETag to assemble the file.
- partNumber: The part number, counted from 1.
  Reason: Orders the part.
- etag: The ETag header of the store's answer to the part's PUT, exactly as received.
  Reason: The store's own proof of the part, passed back untouched.

## add_post_asset (changed sentence)

Reason: the sentence named the removed tools.

> ADD media in ContentHero by its output id: a generation, a file uploaded from a device (create_upload then complete_upload), or a file imported from a url (import). "<id>-2" is variation 2 of a batch.

## Tool result prose (written in packages/mcp/src/format.ts, read by the calling agent)

- create_upload result: single file line "[n] name (id X), single: PUT the whole file to this URL before it expires at T:" then the URL and each header exactly as the server answered. Reason: the agent executes it, so the headers are listed, never described.
- create_upload result: multipart line "[n] name (id X), multipart: N parts of S bytes each, the last one ending where the file ends. Parts can be signed until T." Reason: states the plan as received, so no number is written in the prose.
- create_upload result steps: "1. Send each file's bytes. A single file: PUT it to its URL, sending EXACTLY the headers listed under it, unchanged.", "   A multipart file: call sign_upload_parts with its id and the part numbers to send, PUT each part's bytes to the URL it answers with the headers it lists, and keep the ETag header of each answer exactly as received." (only when a multipart file exists), "2. Call complete_upload once with uploads [skeleton] to finish them together, each multipart file with the number and ETag of every one of its parts." Reason: the next step is named at the moment it is needed.
- sign_upload_parts result: "Signed N part(s) of upload X. PUT each part's bytes to its URL, sending EXACTLY the headers listed under it, and keep the ETag header of the answer exactly as received:" then "part n:", the URL and the headers or "(no headers to add)". Reason: same executed-by-an-agent rule as above.

## Added 2026-10-22: resume

Reason: an agent that lost its state mid-upload can finish, because sign_upload_parts now also lists the parts the store already holds (the tool reads the server's record; no new tool, no change to any approved tool description). The line is added to the sign_upload_parts result, first, only when the store holds at least one part:

- sign_upload_parts result: "The store already holds N part(s) of this upload, which need no sending again and go into complete_upload exactly as listed: part 1 ETag X; part 3 ETag Y." (N, the part numbers and the ETags are the server's, printed as received.)


# Group 5b: transcribe takes a public video link (2026-10-27)

Status: approved by Taylan 2026-10-27 (W1 to W14 in https://claude.ai/artifact/H8UTuCvbPPhScyN5sJ7ceq); item 6 below is deleted instead, by a follow-up migration. Reason for all of it: `transcribe` now reads a public video page (`videoUrl`) through the one link implementation (lib/api/link-transcript.ts), and the in-app link tool `get_transcript` retires.

## Tool text changes

### transcribe (MCP description, written once in the agent tool contract, read by the MCP and the in-app tool)

Before:

> Transcribe speech to text from one source: an audio file by its public URL (audioUrl), or a tracked post's video (contentId, with slide for a carousel's video) once analyze_content kind video has downloaded it. SPENDS CREDITS, metered by the length heard. Pass getCost to see the price first: nothing runs and nothing is charged. A post is priced from its stored copy's length and an audio file from its own; a file whose length cannot be read is priced only once it is transcribed, and the preview says so. A file run on the account's own ElevenLabs key costs nothing. A post is transcribed word by word: its one video becomes the post's transcript, which get_content then returns word-timed with transcript='words'; a carousel slide's words stay with that slide. A post is charged once, to whoever asks first, for what was heard, and is free once its words exist or are being made. A long video returns running: call this again with the same contentId and slide to follow it, which is free.

After:

> Transcribe speech to text from one source: an audio file by its public URL (audioUrl), a public video page by its link (videoUrl: YouTube, Instagram, TikTok, X), or a tracked post's video (contentId, with slide for a carousel's video) once analyze_content kind video has downloaded it. SPENDS CREDITS, metered by the length heard. Pass getCost to see the price first: nothing runs and nothing is charged. A post is priced from its stored copy's length and an audio file from its own; a file whose length cannot be read is priced only once it is transcribed, and the preview says so. A file run on the account's own ElevenLabs key costs nothing. A video link is priced by where its words come from: nothing when the words are already held, a flat price when the platform has them written, a higher flat price when they must be generated from the audio; it answers with the words, the video's title, channel, view count and length where the platform gives them, and the charge. A post is transcribed word by word: its one video becomes the post's transcript, which get_content then returns word-timed with transcript='words'; a carousel slide's words stay with that slide. A post is charged once, to whoever asks first, for what was heard, and is free once its words exist or are being made. A long video returns running: call this again with the same contentId and slide to follow it, which is free.

### transcribe parameters

- audioUrl. Before: "Public URL of the audio file to transcribe. Pass this or contentId." After: "Public URL of the audio file to transcribe. Pass one of audioUrl, videoUrl or contentId."
- contentId. Before: "... Its video must be downloaded first with analyze_content kind video. Pass this or audioUrl." After: "... Its video must be downloaded first with analyze_content kind video. Pass one of audioUrl, videoUrl or contentId."
- videoUrl (new). "Link to a public video page (YouTube, Instagram, TikTok, X) whose spoken words to transcribe. Pass one of audioUrl, videoUrl or contentId."

### CLI

- `contenthero transcribe` description. Before: "Transcribe speech to text: an audio URL, or a tracked post's downloaded video with --content-id (spends credits; price it first with --cost)". After: "Transcribe speech to text: an audio URL, a public video page with --video-url, or a tracked post's downloaded video with --content-id (spends credits; price it first with --cost)".
- New option `--video-url <url>`: "link to a public video page (YouTube, Instagram, TikTok, X) whose spoken words to transcribe".
- Source argument. Before: "public URL of the audio to transcribe (or name a post with --content-id)". After: "public URL of the audio to transcribe (or name a video page with --video-url, or a post with --content-id)".

### In-app tools (the chat agent)

- transcribe: the in-app text is now the contract's (above); it was a hand-written copy that said "the user's own ElevenLabs key" and "This waits a while for a long video; one still running at the end returns running: ...". The contract text says "the account's own ElevenLabs key" and drops the waiting sentence.
- get_transcript: the old in-app tool (read a public link through the transcript provider, metadata-only mode) retires. The name now belongs to the MCP's tool (projectId or mediaId, with a source-seconds window), so the chat agent reads the same text the MCP serves (contract tool get_transcript, unchanged).
- discover_social tool text, last sentence. Before: names get_transcript for a discovered video's spoken words. After: "To get the spoken words of a discovered video, chain with transcribe, passing its link as videoUrl."
- Video link answer wording (SDK describe.ts, used by MCP and CLI), new: cost "Transcribing this video costs N credits, a flat price set by where its words come from. Nothing ran and nothing was charged." or "The words of this video are already held: transcribing it costs 0 credits. Nothing ran and nothing was charged."; answer "Transcript of <platform> video <url> (<title>, <channel>, <views> views, <length>):" then the words; no words "No transcript for <platform> video <url>: <reason> Nothing was charged for it."

## Mechanical prompt edits

Migration 20261027102704_tool_transcribe_reads_video_links.sql in the app (not applied; the lead applies it). Rename and accuracy only. Prompt row: agent_prompts.slug = researcher_system. Each replacement was checked to occur once in the development database.

1. Before: `gathering URLs to pass to get_transcript.` After: `gathering URLs to pass to transcribe as videoUrl.`
2. Before: `**get_transcript** - Retrieves transcripts from video content. YouTube URLs use the YouTube Data API for metadata plus Supadata for transcript text. Non-YouTube URLs (Instagram, TikTok, Twitter/X) use Supadata directly. Supports metadata-only mode when a transcript is not needed. Use for: analyzing what a creator says in a video, extracting talking points, understanding spoken content structure.` After: `**transcribe** - Transcribes the speech of a public video from its link, passed as videoUrl (YouTube, Instagram, TikTok, Twitter/X). Pass getCost to see the price first. Use for: analyzing what a creator says in a video, extracting talking points, understanding spoken content structure.`
3. Before: `then chain get_transcript for spoken content` After: `then chain transcribe for spoken content`
4. Before: `- Video content or what a creator said: get_transcript` After: `- Video content or what a creator said: transcribe with videoUrl`
5. Before: `then get_transcript (extract what they said in top posts)` After: `then transcribe (extract what they said in top posts)`
6. Before: `Use metadata-only mode for get_transcript when transcript text is not needed.` After: `Pass getCost to transcribe to see its price before spending it.` (the metadata-only mode no longer exists; getCost is the nearest accurate statement of the same cost-awareness. If this reads as a new instruction, drop the sentence instead: say so.)
7. Before: `without calling get_transcript` After: `without calling transcribe`

Assignments (agent_tool_assignments, not prompt text): transcribe is enabled for every agent that had the old link tool (remixer, video_producer, strategist, researcher, video_editor); the new get_transcript (project or media words) is enabled for every agent that has get_project. Both only keep what each agent could already do.

Code-only text edits, same kind: chat history verb for get_transcript "Fetched transcript" becomes "Read transcript" (the tool now reads stored words). ChatPanel's silent-tool list, lib/api/media.ts, lib/api/projects.ts, lib/editor/*, and the media-transcripts route already name the MCP's get_transcript and stay.

## Tool text changes (sync)

The SDK, MCP and CLI no longer keep tool text of their own: `packages/sdk/src/tool-text.ts` is deleted and every description and input text is read from the app's agent contract (vendored at `packages/sdk/contract/agent-contract.json`, version stamped as `AGENT_CONTRACT_VERSION`). The MCP listing is the contract's, verbatim. Compared tool by tool against the listing the previous build served (110 tools on both sides). Almost all text was already equal to the contract's; what differs is below.

### MCP tools

- update_avatar. Description, one word added to the field list. Before: "Fields: name, defaultLookId (also becomes the avatar's profile photo), defaultVoiceId." After: "Fields: name, description, defaultLookId (also becomes the avatar's profile photo), defaultVoiceId." Rest unchanged.
- update_avatar, new input `description`: "What the avatar is, in words. An empty string clears it." (the contract declares it; the old MCP listing lacked it. SDK `UpdateAvatarRequest.description` and the CLI flag below added to match.)
- create_card, new input `contentType`: "What kind of content the card holds, in a word." (same reason; forwarded to the API.)
- update_card, new input `contentType`: "What kind of content the card holds, in a word. An empty string clears it."
- create_project and list_projects: the `surface` and `kind` inputs, both worded "Deprecated alias for `type`, accepted for one release window.", are removed (hard cutover; `type` is the only name).
- generate_video: the `elements` input ("Deprecated alias for `klingElements`, accepted for one release window.") and the `elementId` field inside a `klingElements` item ("Deprecated alias for `klingElementId`, accepted for one release window.") are removed. `References.elements` and `References.elementId` leave the SDK types the same way.
- All other tools, descriptions and input texts: identical meaning and identical words. Form only (no wording): optional-or-null inputs are now declared as a type list instead of an any-of, and inputs whose allowed values depend on the chosen model carry an `x-dynamic` marker (create_brand_kit, update_brand_kit, update_avatar, update_card, update_folder, update_project, update_style_library; the marker on edit_audio, generate_audio, generate_image, generate_lip_sync, generate_video, get_model, upscale).

### CLI

- `generate --element <id>` (hidden alias of `--kling-element`) is removed; `--kling-element` is the only flag.
- New `card create --content-type <word>` and `card update --content-type <word>`, text from the contract (above).
- New `avatar update --description <text>`, text from the contract (above).
- `project apply` description is now the contract's update_timeline text for the CLI audience (one source). Before: the CLI carried its own paragraph that named the individual ops (create_clip, insert_track, move_clip, add_keyframe, remove_silence and the rest), templates and modules. After: the same contract sentence the MCP serves, which points to `get_schema` (kind timeline) for ops and never names one. This is a meaning change for the CLI help: the op list is gone from help on purpose (op names live only in the app's type catalog).
- `project apply --expected-revision` and `project update --expected-revision`, `view` flags (`--find`, `--where`, `--picture`, `--detector`, `--track`, `--limit`, `--cursor`) and the `style-library` command texts: same words as before, now read from the contract.

### SDK and CLI source comments (not user-facing)

- `types.ts` and `commands/project.ts` no longer list op names in comments; they point to `get_schema`.

## Group 5b, task (c2): contract gaps and hard cutover

No tool or field description text changed. Behavior and help-text changes a user can see:

- CLI: `project list` and `project create` no longer accept `--surface` (it was a hidden alias of `--type`); the hidden `element` command group (alias of `kling-element`) is removed. Both now fail as unknown.
- MCP: nested objects in tool inputs (for example the items of `get_media`) are now closed, as the app already treated them, so an unknown key is refused instead of passed through.

## Phase B SDK follow-ups

Status: approved by Taylan 2026-10-27, with "Phase B final" below (P1 to P7 in https://claude.ai/artifact/9JbvZLB7nwyqc365ekaAFy).

- MCP `search_media` and CLI `media search`, when a search finds nothing and the server gives a reason. Before: "No matching media found." Now: the same line, then "Why empty: <the server's message>".
- CLI `brand-kit get`, when the kit import kept accounts as they were. New row, before: none. Now: "Accounts kept as they were: <n> (already tracked as the other kind)".
- No tool or field description text changed.

### Phase B SDK follow-ups, second pass

No tool, field or help text changed. SDK type comments were added for the new fields (`seed`, `voiceSettings`, `lookOutputId`, `archive`, `notes`, `coverPosition`, `status`, `script`, `fps`, redo `revision`, `accountsKept`); they reuse the app wire's own descriptions. `listProjects` no longer accepts the `surface` and `kind` aliases, and the project summary no longer types them.

## Phase B final

One media item across the four reads, and the last aliases gone. The contract carries the new words (synced, version 4c25bbd9e074); the entries below are what a person or an agent reads.

### Tool input: list_media

- Parameter `kind` is now `origin`. Before: "Creations only. Narrow to one kind of generation: 'creation' (normal generations), 'board' (reference boards), or 'look'. Omit to list all." Now: "Creations only. Narrow to one kind of generation: 'creation' (normal generations), 'board' (reference boards), or 'look'. The same word an item's origin says. Omit to list all." Same three values.
- CLI: `media list --kind <kind>` is now `media list --origin <origin>`; help text before: "creations only: filter by asset class: creation, board, look". Now: "creations only: filter by what the generation is: creation, board, look". The SDK option is `origin` too.

### What a media item says (MCP text, CLI tables)

`kind` now means the media kind on every read: image, video or audio (empty for a document or an unknown file). What `kind` used to say on a listed item (creation, board, look, upload, stock) is now `origin` (creation, board or look; empty for anything a generation did not make). Which library an item is in was already `source`.

- MCP `list_media` row. Before: `- [image] model (id) ... | board:character | creations | prompt`. Now: the same row, where `[image]` is the media kind and a `| board:character` or `| look` tag comes from the origin. A document or an unknown file shows `[file]` where it showed `[doc]` or `[other]`.
- MCP stock row. Before: `- [image] name (media id ...)`. Now: the same, `[image]` is the media kind.
- MCP `get_media` batch lines. Before: `image Abc12345`, `video (url)`; for a transcript the note "(transcript: text only)". Now: same lines from the media kind; a transcript file has no media kind, so that note is gone and the line reads `media Abc12345`.
- CLI `media list` table. Before columns: ID, FAV, TYPE, SOURCE, KIND, NAME/MODEL, SIZE, DESCRIPTION, PROMPT. Now: ID, FAV, KIND, SOURCE, ORIGIN, NAME/MODEL, SIZE, DESCRIPTION, PROMPT. Stock table: TYPE column is now KIND.
- CLI `media get` header. Before rows: "Type" (image) and "Kind" (creation, or empty). Now rows: "Kind" (image) and "Origin" (creation, board, look, or empty).

### Fields (JSON output)

- Every item read (list, get, batch, search, folder contents): `kind` is image, video, audio or null. The batch item's `type` is now `kind`; the list item's `type` is now `kind`, and its old `kind` is now `origin`.
- `description` is always present on a list item and a batch item (null when nothing was said). Before: absent when none.
- `appUrl` is absent, not null, for a stock item.
- Removed: placement result `surface` (use `projectType`), export formats `surfaces` (use `projectTypes`), card `coverIsDerived`, SDK types `ProjectKind` and `ProjectSurface` (use `ProjectType`). `POST_PLATFORMS` is now `PLATFORMS_OR_GENERAL` (same eight values). `expectedRevision` is refused below 0.

- Removed, the last deprecated aliases (hard cutover): `surface` on the timeline and canvas schema reads and their indexes (use `projectType`); card asset `assetId` (read `contentId`, `projectId`, or the new `outputId` for a generation, each the same name the write takes); the upload answer's top-level `uploadUrl`, `uploadHeaders`, `storagePath` and `expiresAt` (read `upload`); the route `/api/v1/elements` (use `/api/v1/kling-elements`); the SDK methods `listElements`, `getElement`, `createElement`, `updateElement`, `deleteElement` and types `Element`, `ReferenceElement`, `CreateElementRequest` (use the Kling-named ones). The CLI `element` command and `--element` flag were already refused. The CLI `card get` ID column now shows the content, project or output id of the asset.

No other tool or field description text changed.

## Wording for approval: music composition plans

Status: approved by Taylan on 2026-10-31. Agent contract 5684028e2847 (app commit fac93a9a13). Only generate_audio changed; every other tool, input and closed value set is unchanged. The texts below are verbatim as the synced contract carries them.

### generate_audio description

Before: "Generate audio: speech (TTS), music, or a sound effect. Returns the audio URL directly (synchronous, no polling). Optionally pass projectId to place the generated audio onto that editor project's timeline in the same call, controlled by an optional placement; omit projectId to save a standalone library output. The result LINKS each output so the user sees it inline; to SEE it yourself (judge a face, check legibility, pick between variations) call get_media with the outputId. SPENDS CREDITS: pass getCost to preview the price first, which runs nothing and charges nothing."

After: "Generate audio: speech (TTS), music, or a sound effect. Returns the audio URL directly (synchronous, no polling). Music takes either a prompt or a compositionPlan: the song section by section, each chunk with its lyrics, length and styles. withTimestamps returns the sung words with their times, and storeForInpainting keeps the song so a later plan can reuse stretches of it and rewrite one section. Optionally pass projectId to place the generated audio onto that editor project's timeline in the same call, controlled by an optional placement; omit projectId to save a standalone library output. The result LINKS each output so the user sees it inline; to SEE it yourself (judge a face, check legibility, pick between variations) call get_media with the outputId. SPENDS CREDITS: pass getCost to preview the price first, which runs nothing and charges nothing."

### Changed input

- `prompt`. Before: "For music / sfx: what to generate." After: "For music / sfx: what to generate. For music, send a prompt or a compositionPlan, not both."

### New inputs

- `compositionPlan`: "Music only, instead of prompt: the song section by section. Its length is the sum of its chunks, so durationSeconds is not sent with it."
- `compositionPlan.chunks`: "The song in order: chunks the model writes, and stretches kept from earlier songs."
- A generation chunk (written by the model):
  - `text`: "The chunk: an optional section name in square brackets first (e.g. [Verse 1]), then the lyric lines, with inline directions in curly braces (e.g. {spoken})."
  - `durationMs`: "Length of the chunk in milliseconds. The provider enforces it exactly."
  - `positiveStyles`: "Styles and musical directions present in this chunk, in English. The first chunk sets the genre and tone of the song."
  - `negativeStyles`: "Styles and musical directions to keep out of this chunk."
  - `contextAdherence`: "How closely the chunk follows the chunks around it. Defaults to high."
  - `conditioningRef`: "Earlier music this chunk should sound like."
    - `source`: "The output id of an earlier music generation of yours (its short id or UUID)."
    - `startMs`: "Where the stretch starts in that song, in milliseconds."
    - `endMs`: "Where the stretch ends in that song, in milliseconds (exclusive)."
  - `conditionStrength`: "How strongly the chunk follows conditioningRef."
- An audio chunk: "A stretch of an earlier song kept as it is. To edit one section of a song, keep the stretches around it as audio chunks and write the new section as a generation chunk."
  - `source`: "The output id of an earlier music generation of yours (its short id or UUID)."
  - `startMs`: "Where the stretch starts in that song, in milliseconds."
  - `endMs`: "Where the stretch ends in that song, in milliseconds (exclusive)."
- `seed`: "For music with a compositionPlan: a seed, so the same plan gives a more consistent result. Not taken with a prompt."
- `withTimestamps`: "Music only: also return the sung words with their start and end times, and save them as the song's transcript."
- `storeForInpainting`: "Music only: keep the song with the provider so a later compositionPlan can reuse stretches of it, which is how one section is edited."

### Clients (forwarding the new inputs)

The sync alone listed the new inputs without sending them: the MCP's generate_audio handler builds its request field by field, so the four inputs would have been dropped. They are now forwarded by the SDK (`GenerateRequest.compositionPlan`, `withTimestamps`, `storeForInpainting`, with `seed` as before), the MCP and the CLI, and the answer's new fields are read (`GenerateResult.wordTimestamps`, `storedForInpainting`).

- MCP result, new lines (only when the answer carries them): "Stored for inpainting: a later compositionPlan can reuse stretches of this song by its outputId." and "Sung words (N, start to end in seconds):" followed by one line per word, for example "1.20 to 1.45 Hello". The structured result also carries `wordTimestamps` and `storedForInpainting`.
- CLI `generate audio`, new flags whose help is the contract text above: `--composition-plan <json>`, `--seed <n>`, `--with-timestamps`, `--store-for-inpainting`. The human table adds the rows "Stored for inpainting: yes" and "Sung words: N (each with its times in --json)".


# Group 6: Kling 4.0 inputs on the developer surface (2026-11-04)

Status: PROPOSED, awaiting Taylan. Reason for all of it: Kling 4.0 takes video subjects, a voice for a subject, keyframes, named voices and a keep-original-sound setting, and get_model and `model get` must say what a model declares. Nothing below states a number or limit another system owns: every count, length and pattern printed is read from the model's registry entry at call time.

## Contract text (written in the app's agent contract, vendored here by contract:sync)

- `klingElements[].video`: "Inline Kling element made of one video instead of images: a URL or a previous output id. Only for models that take video subjects."
- `klingElements[].voice`: "Inline Kling element: an audio file the subject speaks with, a URL or a previous output id. Only for a subject made of images, on models that take it."

## CLI help

- `generate video --inline-kling-element <json>`: "define a Kling element in the call: a JSON object with name and any of description, images, video, voice (each a URL or output id; model get says what the model takes); repeatable". Reason: the CLI had no way to express an inline element, which is where `video` and `voice` live.
- Error for a value that is not an object: "Expected a JSON object, got \"<value>\"."

## get_model and `model get` lines (shared, written once in packages/sdk/src/describe.ts; the numbers are the registry's)

- Input modes heading and line (new): "A request carries the inputs of one mode only; mixing modes is refused." Reason: states the registry's `inputModes.exclusive`.
- "keyframes: up to N", "voices: up to N", "video subjects: up to N" (from maxKeyframes, maxVoices, maxVideoElements).
- "shared input budget: N in all (each counts: imageRef 1, ...)" (from inputQuota).
- "videos in all (reference videos and video subjects): up to N" (inputLimits.videoInputsMax).
- "reference videos: each A to Bs" (inputLimits.referenceVideoSec).
- "video subjects: a single shot of A to Bs, shortest side at least N px" (inputLimits.subjectVideo).
- "frames (first, middle and last together) by duration: from As up to N, ..." (frameCountByDuration).
- "names of subjects and voices (one namespace): a name is <the registry's rule>; up to N characters; a description up to N" (namedInputs).
- "reserved names, taken by the model's own tags: <patterns>" (namedInputs.reservedNamePatterns).
- "setting <key> (<label>): toggle, default <value> (applies while a reference video is attached)" (declared settings).

## Flat generate_video inputs (contract text, written in the app, vendored by contract:sync)

- `keyframes`: "Middle frames between the first and last frame, in order, for models that take them (URL or output id). They need a startFrame."
- `voices`: "Named voices, each addressable in the prompt as @name, on models that take them."
  - `voices[].name`: "The voice name, addressed in the prompt as @name. It must follow the model's naming rules (get_model)."
  - `voices[].audio`: "The audio file the model speaks this voice with (URL or output id)."
- `keepOriginalSound`: "On a model that offers it, with a reference video: keep that video's own sound in the result. get_model lists the model's settings and when each applies."

## CLI help for them

- `--keyframe <urlOrId>`: "middle frame between the first and last, in order (URL or output id); repeatable; needs --start-frame"
- `--voice <name:urlOrId>`: "a named voice, addressed in the prompt as @name, with the audio it speaks with (URL or output id); repeatable"
- `--keep-original-sound`: "on a model that offers it, with a reference video: keep that video's own sound in the result"
- Error for a malformed voice: "Expected name:audio (the voice name, a colon, then a URL or output id), got \"<value>\"."

## Reference tags in `model get`

- Row "Reference tags" (CLI), same list as the MCP's "tokens:" line: each tag the registry declares, with "(up to N)" when more than one. Written once in `describePromptReferenceTags`.


## GPT Image controls

Status: approved by Taylan 2026-11-06.

The existing generate_image tool description is unchanged. MCP input descriptions and CLI flag help read the same contract text.

### Parameters

1. `quality`: "Quality mode, for models that expose it separately. Validated per model."

   Reason: Exposes the model quality declaration without copying its choices.

2. `outputFormat`: "Output format declared by the model, subject to its input and background restrictions."

   Reason: Exposes the model format declaration and its compatibility rules.

3. `background`: "Background handling declared by the model, subject to output format compatibility."

   Reason: Exposes background handling through the existing parameters path.

4. `frameCount`: "GIF frame count declared by the model. Available only for GIF output."

   Reason: Exposes GIF frame counts as the model declares them.

5. `frameDurationMs`: "GIF frame duration in milliseconds, subject to the model limits."

   Reason: Names the unit while the model owns the range and step.

6. `frameSize`: "GIF frame pixel size, subject to the model sprite sheet limits."

   Reason: Leaves dimension and sheet rules with the model declaration.

### Discovery output

Reason: the shared formatter lets MCP and CLI callers discover the model declaration before submission. Every substituted value comes from discovery.

1. Setting detail adds "; options: VALUE (LABEL), ...", "; custom values: allowed" or "; custom values: refused", "; range: MIN to MAX; step: STEP", and " (applies to GIF output)" when declared.
2. Selectable fields: "KEY: VALUES (default DEFAULT)" and, when declared, "; locked to VALUE".
3. "formats with reference images: VALUES" and "formats with transparent background: VALUES".
4. "GIF fields: frame count KEY; frame duration KEY; frame size KEY". Frame size is omitted when absent.
5. "GIF sprite sheet: side at most MAX px; at most MAX pixels; aspect at most MAX; frame dimensions a multiple of MULTIPLE".
6. "GIF sheet packings (columns and rows may swap): MIN to MAX frames: COLUMNS x ROWS; ...".
7. "model defaults: JSON".
8. CLI model list adds the column "CONTROLS" using these same lines. MCP list_models also includes these lines.

## Video controls

Status: approved by Taylan 2026-11-06.

MCP parameter descriptions and CLI flag help read the existing canonical contract. No tool description changed.

1. `draft`: "Enable Draft on a model that declares the setting. Its declared resolution applies."
2. `upgradeFromOutputId`: "Upgrade a completed draft output owned by the caller. The model must declare draftUpgrade. Shot settings are inherited and cannot change."
3. `upgradeSlot`: "The output slot of the source draft. Omitted selects the first output."
4. `outputFormat`: "Output format for a draft upgrade, validated by the server."
5. `returnLastFrame`: "Also return the last frame of a draft upgrade."

Discovery output additions, with values supplied by the model declaration:

1. "inputs: VALUES".
2. "draft upgrade: RESOLUTION; available for SECONDSs after creation".
3. Setting details add "; resolution when enabled: RESOLUTION" for a toggle that declares it.
4. Model lists include the existing input mode descriptions already used by model details.

SDK request comments added:

1. "Upgrade a completed draft owned by the caller. Shot settings are inherited and cannot change."
2. "Source draft output slot. Omitted selects the first output."
3. "Enable the model's declared Draft setting and resolution."
4. "Output format for a draft upgrade, validated by the server."
5. "Also return the last frame of a draft upgrade."


## Lip sync video sources

Status: approved by Taylan in advance on November 6, 2026, as recorded in the brief.

The MCP tool description and CLI command description read the canonical contract verbatim:

> Synchronize speech to a portrait image or an existing video, according to the selected model. get_model declares which source the model takes: imageUrl for a portrait or referenceVideos for a video. Provide that source plus a voice source: either audioUrl (an existing speech clip) or script + voiceId (we synthesize the speech). Optional motionPrompt nudges expression/motion. Returns at once with an outputId; get_status waits for the render. SPENDS CREDITS: pass getCost to preview the price first, which runs nothing and charges nothing. A retry that repeats the same operation id or output id returns the work already started and never charges twice. The reply names the id to read its progress.

The changed image description, new video input, and CLI option descriptions read the following canonical text. The video description also replaces generate_video.referenceVideos text because both tools now reuse the REST declaration.

1. `modelId` (`--model`): "The model id: a lip-sync model. list_models (contentType video) names them; get_model gives one model's resolutions and inputs."
2. `imageUrl` (`--image`): "The portrait to animate, as an image URL or a previous output id. Required for models that take an image; get_model declares the source the model takes."
3. `referenceVideos` (`--ref-video`): "Video references (URL or output id)."
4. `audioUrl` (`--audio`): "An existing speech clip: an audio URL or a previous output id. Use this OR script + voiceId."
5. `script` (`--script`): "Text for the subject to speak. Requires voiceId; synthesized to speech. Use this OR audioUrl. Before writing directions into the script, read the speech model's promptGuide with get_model."
6. `voiceId` (`--voice`): "The voice to speak the script (list_voices names them; required with script)."
7. `voiceName` (`--voice-name`): "Human-readable voice name (display only)."
8. `motionPrompt` (`--motion`): "Optional motion / expression hint for the animation."
9. `resolution` (`--resolution`): "e.g. 480p, 720p, 1080p. Model-dependent."
10. `audioDurationSeconds` (`--audio-duration`): "Length of audioUrl in seconds (audio mode only; improves cost accuracy)."

Reason: the source depends on the model; CLI help now shares the contract wording for every lip sync input. Existing voice and resolution meanings remain the contract meanings.

Shared discovery additions, conditional on kind lip sync and the declared inputTypes:

1. "visual source: imageUrl (portrait)" for singleImage.
2. "visual source: referenceVideos (video)" for singleVideo.

Reason: callers can identify the tool field from the model declaration on list and detail surfaces. No model identifier or limit is embedded.

SDK References.videos comment:

> Video references, including a source video for lip sync (URL or output id).

Reason: the shared REST reference bucket also carries the source video.

Package guide replacements:

1. sdk: For lip sync, read the model declaration first. Supply a portrait in `references.images` when it declares `singleImage`, or a source video in `references.videos` when it declares `singleVideo`. Supply existing speech in `references.audio`, or use `text` with `voiceId`. `estimateCost` previews the same request. The server validates the source required by the model.
2. mcp: For `generate_lip_sync`, read `get_model` first. Supply `imageUrl` for a model declaring `singleImage`, or `referenceVideos` for a model declaring `singleVideo`. Add `audioUrl`, or `script` with `voiceId`. Pass `getCost` to preview the same request. The server validates the source required by the model.
3. cli: For `generate lip-sync`, read `model get` first. Supply `--image` for a model declaring `singleImage`, or `--ref-video` for a model declaring `singleVideo`. Add `--audio`, or `--script` with `--voice`. Pass `--cost` to preview the same request. The server validates the source required by the model.

Reason: the app contract now exposes the video source, so the previous blocked feature note no longer applies.
