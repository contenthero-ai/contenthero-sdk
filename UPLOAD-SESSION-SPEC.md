# Upload session (v1): one contract for every surface

Date: 2026-10-21. Taylan approved the design and the renames on 2026-10-21. No push, release, package publish or service deploy without his yes (release order: docs/RELEASE.md, "Order of a release that changes a tool").

## The problem and the class
`POST /api/v1/media/uploads` (lib/api/media-uploads.ts `beginMediaUpload`) can only return one `uploadUrl`. When the upload broker (lib/storage/upload-broker.ts, `begin`) picks a multipart session (a file over `R2_PART_SIZE`, or no size given) the endpoint aborts it and answers 413 or 400. The browser has its own multipart routes (`/api/storage/uploads`, `/parts`, `/complete`) that express everything the broker can do. So one operation behaves differently by surface: the connector grew a narrower parallel entry point.

The class: a capability the store has that a surface cannot express, with nothing failing when one is missing. The fix is at the contract, and a guard makes the next gap a failing check.

## What a signed URL is here (verified, do not redesign)
The broker is the only holder of R2 credentials. A writer asks where its bytes go and receives a per-write credential (a presigned PUT, or per-part presigned PUTs); the bytes travel direct to storage (Vercel caps request bodies at 4.5 MB, nothing is proxied). That credential is a temporary write permission, not a media address. After upload a file is addressed by its output id and its serving URL (`lib/media/serving-url.ts`). The media gateway serves reads only. So: keep the credential, call the concept an UPLOAD TARGET in the contract and docs, and keep it opaque: bucket, object name and upload id never leave the server. Clients hold the output id, the target and its headers.

## The contract (keep the REST paths under /api/v1/media/uploads)
- `POST /api/v1/media/uploads`, body `{ fileName, contentType, sizeBytes }`, `sizeBytes` REQUIRED (the file is local, its size is known; this removes the 400 case).
  Answer: `{ outputId, upload }` where `upload` is a discriminated union on `mode`: `{ mode: 'single', url, headers, expiresAt }` or `{ mode: 'multipart', partSize, partCount, expiresAt }`. For ONE release the single mode also carries today's `uploadUrl`, `uploadHeaders`, `storagePath`, `expiresAt` at the top level so an older client keeps working in either deploy order; mark them deprecated in the schema and remove them in the release after.
- `POST /api/v1/media/uploads/{outputId}/parts`, body `{ partNumbers: number[] }` (at most a named constant per call), answer `{ parts: [{ partNumber, url, headers }] }`. Signed on demand, so a slow or paused upload finds no dead URLs and an upload resumes by asking again for the parts it still needs (reason stated in app/api/storage/uploads/parts/route.ts). Idempotent.
- `POST /api/v1/media/uploads/{outputId}/complete`, body `{ parts?: [{ partNumber, etag }] }`. Required for a multipart upload; the server checks the count against `partCount` and the numbers are 1..partCount with none missing, then completes through the broker. Idempotent: completing twice returns the same media. A single-mode completion takes no body, as today.
- `DELETE /api/v1/media/uploads/{outputId}` aborts: aborts the multipart session at the broker and removes the pending row. Check whether abandoned pending uploads are already reaped (search for a reaper of pending `studio_outputs` uploads and of stale multipart sessions); reuse it, and if none exists for the multipart case state that plainly and add the smallest correct one.
- Session state: where the begun session's bucket, object name and upload id live today (the declaration on `asset_objects` and the pending row, read by `completeMediaUpload`); keep them server-side and look them up by `outputId` plus the authenticated user. No new table unless you prove nothing existing holds it.

## Rules
1. One canonical path. Reuse the broker (`beginUpload`/`begin`, `signUploadPart`, `completeUpload`, `abortUpload`) exactly as the browser routes do; never copy broker logic. Search first and write "Reusing X from path" in your notes.
2. Ownership comes from the authenticated user and the output id only; a part request or a completion for an output that is not the caller's answers 404 like today's complete.
3. Errors are specific and ours to prevent: a wrong part number, a missing or malformed etag, a count that does not match, an expired session each say what is wrong and how to fix it, never a code (memory rule); the last resort tells the caller to retry or contact support.
4. Principle-based text only in tool-facing descriptions: no example values and no sizes that another system owns (the part size and part count come from the response, never from prose).
5. The guard for the class: an exhaustive switch (`assertNever`) over the broker's upload kinds in the one place the v1 answer is built, so adding a broker mode without a surface fails `npm run typecheck`; a unit test that every kind maps to a schema variant; a LIVE test (`*.live.test.ts`, development environment) that uploads a file one byte over the part size through the real routes and reads it back unchanged. The Komodo acceptance file is `scratchpad/sound/lib/music/ES_Komodo - Bonsaye.mp3` (8,491,597 bytes) in the session scratchpad of the earlier session; if it is not on disk generate a file of that size.
6. Export the zod schemas of the new request and answer shapes from the app (the SDK and MCP are in another repo, /Users/taylanalpan/Developer/Projects/contenthero-sdk, and copy types by hand today: note in the final message how the SDK's types are derived so the SDK builder can reuse rather than retype).

## Names (for the SDK, MCP and CLI step, which comes after the app routes)
MCP `create_upload`, `complete_upload`, new `sign_upload_parts`; SDK `upload()` (the one-call helper, handles both modes: concurrent parts with a named bound, per-part retry, resume by output id), `createUpload`, `completeUpload`, `signUploadParts`; `importMedia` becomes `import`; CLI top-level `upload` (like `download`), `media upload` removed. Hard cutover, no aliases; sdk, mcp and cli each take a patch bump (memory: patch only). Tool wording changes need Taylan's approval of the exact text before publish.

## Not in this step
SDK, MCP and CLI code; publishing; pinning; the release.
