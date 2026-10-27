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

Status: for approval. Reason for all of it: `transcribe` now reads a public video page (`videoUrl`) through the one link implementation (lib/api/link-transcript.ts), and the in-app link tool `get_transcript` retires.

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
