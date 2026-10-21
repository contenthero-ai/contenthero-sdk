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
