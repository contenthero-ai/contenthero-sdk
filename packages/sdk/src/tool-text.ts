/**
 * The descriptions of the tools every ContentHero agent shares, written once (gap closure D7): the MCP registers them
 * from here, and the app's in-app agent imports them from this package once it is published, so the two surfaces can no
 * longer describe one tool two ways. Until then the app holds the same strings, and its own test holds them free of
 * values.
 *
 * Each text is principle-based: it says what the tool does and the rules it follows, never an example value or a limit
 * the server enforces, because a restated limit is wrong the moment the server changes. Where a text names the place an
 * agent reads ids from, it says it for its audience: get_project for an MCP agent, the editorContext system message for
 * the in-app agent.
 */

/** Who reads a description: an MCP agent, or the in-app agent. */
export type ToolTextAudience = 'mcp' | 'in-app'

const IDS_FROM: Record<ToolTextAudience, string> = {
  mcp: 'get_project',
  'in-app': 'the editorContext system message',
}

/** `view`: see what the user is looking at, and see or hear your own work or a source. */
export function viewDescription(audience: ToolTextAudience): string {
  return [
    "See what the user is looking at, and see or hear your own work or a source. A view returns only what it names: your render, a source, or the user's screen; add live to a render to also get what the user is looking at.",
    "With nothing to render and no source, it returns the live context of the open app: the active surface, the focused element, the playhead and the selection, from the most recently active session, with the live participants. capture adds a picture of the user's screen as shown now, including unsaved and transient state; it takes a moment and briefly interrupts the page.",
    "render shows your work as it will play, rendered from the saved project: one composed frame or slide, the one in focus unless frame, slideId or slideIndex names another; for a timeline, frames, a count over a range, or perSecond over a range name several. count spreads that many frames from the first frame of the window to its last; perSecond steps from the first; frames and atSec are exact. Several frames come back one by one when they fit one result and otherwise as contact sheets with each frame labeled under its tile, in pages; nothing caps how many. width is the width of each image returned, the crop's when a region is named; without width a region comes back at native pixels. Each image names the frames it shows, sampled says how many were rendered, and anything the server changed is listed in adjusted with why.",
    "trackIds and clipIds render only those tracks and clips, picture and sound, on the timeline's own frame numbers, leaving the project untouched, so the person can keep editing while you review.",
    "sound renders a range of the mix as an export mixes it, before an export's delivery leveling, and measures it (integrated loudness, true peak, loudness range, sample peak, where sounds start, stereo width, band balance), with a waveform and spectrogram picture and a link to the audio. Its sound is also analyzed and rendered as one evidence sheet, as a source's window is below, on the sound's own seconds from the start of the range; the measurement stays the loudness to deliver by. " +
      (audience === 'mcp'
        ? 'video watches a range play with its sound; where video cannot be received, as here, it returns frames across the range and the sound measured.'
        : 'video watches a range play with its sound.'),
    "To see and hear a source rather than your edit, name a clip of the user's with assetId (the id get_project reports in a clip's source) or mediaUrl, or a tracked post's video with contentId (and slide for a carousel) once analyze_content kind video has downloaded it, and window it with fromSec and toSec in its own seconds. A source's frames follow the same rules as your edit's, labeled with their seconds. A source read carries the source alone, and only the parts asked for. sound measures the window as it is, beside any frames; with video you watch it play. With sound, a stored source's window also carries its sound analysis for that window: speech, sound candidates with their measured descriptors, levels against the voice, offset from the beat and repetition pattern, music and beats, loudness, and each stem's level; made once per file, and made the first time its sound is read. The window also comes as one evidence sheet: its frames, the spoken words and a spectrogram strip per stem on one time axis, each sound candidate marked by its number. A candidate is measured, never named: judge what it is from its strip and its descriptors.",
    "find, where and picture ask a source, or a project's window over fromFrame and toFrame, of its picture analysis and answer in numbers rather than images, so a view with only them returns no frames. A file's picture analysis is made once and shared: a coarse one, one picture per shot, exists from upload, and the full one is made the first time the file is studied; until the full one is ready, the answer says it is coarse and how the full one stands. Every list in their answer comes a page at a time: limit sets how many of each list a page holds, and passing the answer's nextCursor back as cursor reads the next page of all of them.",
    "Anything not ready yet (a render's page, a sound analysis, an evidence sheet, a where) says when it started, when it is expected, the exact inputs that read it again (readWith, or the same inputs again when it names none), and why it has not ended when it is blocked or late. Read it again with exactly those inputs. A render that is not ready answers with a renderId: read it again with that id instead of rendering again. When rendering is busy the answer says how many seconds to wait before asking again. When the user is charged credits for what a view made, the answer says how many. Renders are ephemeral and need no live tab, only a projectId when no one is viewing. Check your work here, never with export, which makes a file the user keeps.",
    audience === 'mcp'
      ? 'Requires the context:read scope.'
      : 'A video is watched whole, so the longest you can watch is the most video your context holds at once; watch a longer stretch in parts.',
  ].join(' ')
}

/** `view`'s picture inputs, described once for every surface (the MCP's schema and the in-app agent's parameters). */
export const VIEW_PICTURE_INPUT_TEXT = {
  find: "Describe what to look for in the picture. Returns the moments of the source or project window that show it, best first, as times (and timeline frames for a project), matching what is pictured, the text on screen and the words spoken over it, each naming which of the three found it. The moments are candidates: confirm the ones that matter by viewing frames at their times, or ask where.",
  where: "Also where on the frame each thing find describes may be: candidates, best first, each with an id, a confidence, its time span, its box normalized to the frame, what found it, and a time and box to check it on. View that frame to confirm the one you mean, then pass its id as track. When none is the thing, view the window's frames yourself, find it, and pass its time and box as track. Small things are found less often: check their candidates before trusting the first. Slower the first time a phrase is asked of a file, and a read after that.",
  track: "Follow one thing on every frame of the window: a candidate's id from a where answer, or a time of the source and a box on its frame that you found yourself. Returns one track per stretch it is seen, its box on each frame as keyframes, and its edges where it appears and leaves. An edge is not always on the exact frame: view the frames either side before cutting on it. A thing without a firm outline is followed with a loose box, and very fast motion can end a track early or split it. Slower the first time a seed is asked, and a read after that.",
  detector: "The class of thing where answers from the file's own analysis instead of a phrase: a screen recording's pointer, or faces (where, never who). Leave find out. With track, a box you give is followed as that class.",
  picture: "The window's picture analysis: its cuts, fades, black, camera movement, the text on screen and where faces are (never who), each with its times and position. For a project it reads each clip's source and maps it to the timeline, and adds the edit's own cuts in editCuts: where a clip starts where the one before it ends without playing on from it. It does not see what covers a clip or what has no source, and names each clip it does not see with why; a render of the range shows those. Where a screen recording's pointer is, and its shape. To follow it to the exact frame, ask where with detector pointer and track the candidate.",
  limit: 'How many items of each list a page of find, where or picture holds. Omit for the default.',
  cursor: "Read the next page of every list of find, where or picture: pass the answer's nextCursor, with the same other inputs.",
} as const

/** `get_project`: read a project, its settings, and its composition, summarized or whole. */
export function getProjectDescription(audience: ToolTextAudience): string {
  return [
    "Read a project: its title, revision and settings (its canvas size, and for a video project its frame rate, delivery loudness, magnetic main track, linkage and the kinds of track linkage reaches), with a summary of its composition by default or the whole composition with detail 'full'.",
    "The summary is each track's id, name, type, whether it is the main track and whether it is muted or hidden, and each clip's id, type, place on the timeline, speed, whether it is disabled and source: a clip plays a file (its assetId, the same id view and get_media take, and the window of the file it plays, in the file's seconds) or code (the project modules it imports). Clips that share an assetId were cut from one recording; a clip's id never says so. For a canvas, the summary is each slide with its layers' ids, types and the start of each text layer's text.",
    "A timeline read can be narrowed to a frame window or one track, and a canvas read to one slide; a narrowed full read carries only the modules its clips import and names the rest. A read that names clipIds, moduleNames, sourceAssetId or modulesIndex returns those parts alone: each clip named as its summary line, or whole with its code and the modules it imports with detail 'full'; each module named with its code; modulesIndex, every module's name, how many clips draw it, whether none does, and its size, without code; and with sourceAssetId and atSec, where moments of a recording play on the timeline: every clip and frame each second lands on, none where it was cut out. A read names parts or narrows the whole, not both.",
    "A project's read also lists the problems its code, modules and geometry hold, of the whole project or of the parts a read names: code reading what a project module does not provide, the compiler's warnings, modules no clip imports, and a zoom that shows a pinned region's own picture outside the pin.",
    'Pass the returned revision as expectedRevision for an edit that must not overwrite a concurrent change. update_project changes the settings.',
    ...(audience === 'mcp' ? ['Requires the editor:read scope.'] : []),
  ].join(' ')
}

/** `update_timeline`: edit a video timeline with a batch of operations read from the catalog. */
export function updateTimelineDescription(audience: ToolTextAudience): string {
  return [
    'Edit a video timeline with a batch of operations, the same ones every ContentHero agent uses, applied by the server and shown in the open editor at once. Each operation is an object with an `op` name and its fields.',
    "get_schema kind 'timeline' lists every operation with its shape and the rules they all follow; read an operation in full by its name before using one you have not read, and build a clip from its type's example there. A code clip imports project modules, which an operation sets.",
    `Read clip, track and transition ids from ${IDS_FROM[audience]}.`,
    'A batch is ordered and atomic: when any operation is refused, nothing is stored, and the result says which and why. The result reports each operation, with what the compiler found in any code an operation wrote, and what the edit left in the project that may not render as intended, clip by clip.',
    'Prefer an edit the person can review and turn back over one that cannot be reversed, and make a destructive one only when they asked for it. A clip\'s length on the timeline follows its source and its speed: change its speed, not its length.',
    'Project settings change with update_project. expectedRevision is optional: pass the revision you read to fail on a concurrent change rather than overwrite it. Every edit can be undone, and each returns the new revision.',
    'A retry that repeats the same operation id returns the revision already committed and never applies the batch twice.',
    ...(audience === 'mcp' ? ['Requires the editor:write scope.'] : []),
  ].join(' ')
}

/** `update_canvas`: edit a canvas with a batch of operations read from the catalog. */
export function updateCanvasDescription(audience: ToolTextAudience): string {
  return [
    'Edit a canvas (slides and layers) with a batch of operations, applied by the server and shown in the open editor at once. Each operation is an object with an `op` name and its fields.',
    "get_schema kind 'layer' lists every operation with its shape and the rules they all follow; read an operation or a layer type in full by its name before using one you have not read.",
    `Read slide and layer ids from ${IDS_FROM[audience]}.`,
    'A batch is ordered and atomic: when any operation is refused, nothing is stored, and the result says which and why. The result also reports what the edit left in the project that may not render as intended, layer by layer.',
    'Project settings change with update_project. expectedRevision is optional: pass the revision you read to fail on a concurrent change rather than overwrite it. Every edit can be undone, and each returns the new revision.',
    ...(audience === 'mcp' ? ['Requires the editor:write scope.'] : []),
  ].join(' ')
}

/**
 * The words of the four style library tools, in one place: the approved texts of the app's
 * `.claude/plans/style-library-tool-texts-v1.md` (Taylan, 2026-10-19), word for word, which the app holds in
 * `lib/ai/style-library-tool-text.ts`. The MCP registers them from here and the CLI's help reads them from here.
 */
export const LIST_STYLE_LIBRARIES_TEXT =
  'List the style libraries on this account. A style library is shared code that projects pin and import: components, design tokens, motion and sound cues, never a CSS style. Each entry gives its name, description, latest version and when it was last updated. Archived libraries are left out unless archived is true. Returns a page at a time; pass the answer\'s cursor for the next.'

export const GET_STYLE_LIBRARY_TEXT =
  'Read one style library by name: its description and every published version with its notes, newest first. With a version, read that version\'s modules instead, each by name with its code. A published version never changes. A project uses a library only after set_style_library pins a version in it.'

export const CREATE_STYLE_LIBRARY_TEXT =
  "Create a style library on this account, and publish its first version when modules are sent. A style library is shared code, not a CSS style. Its modules come from `modules` sent inline, from `fromProject` (modules of one project, read from its saved state, with imports between them rewritten to the library's own), or both; a name sent by both is refused. A library module may import the sandbox's modules and its own library's modules, never a project module. The name is fixed once created, because the code of every clip that imports the library names it. Publishing runs the same checks as saving a project module: code that does not compile, an import it cannot resolve, or a module that reads something another module does not provide is refused with the reason."

export const UPDATE_STYLE_LIBRARY_TEXT =
  'Publish the next version of a style library, edit its description, or both. A published version never changes: publishing adds one, and `notes` says what changed. Send modules inline (`code`, `edits` against `baseVersion`, or `null` to drop a module), from a project with `fromProject`, or both. A project that pins an earlier version is untouched until its own set_style_library moves it. Archive a style library with the archive tool, never by deleting: its versions are kept so every project that pins one still renders.'

/** The style library parameter descriptions, by parameter name. */
export const STYLE_LIBRARY_PARAMETER_TEXT = {
  archived: 'Only archived style libraries.',
  search: 'Search style library names.',
  name: 'The style library name.',
  version: "The version to read, with each module's code.",
  description: 'What the style library is for.',
  notes: 'What this version changes.',
  baseVersion: 'The version the change builds on.',
  modules: 'Modules by name: { code }, { edits } against baseVersion, or null to drop one.',
  fromProject: 'Modules of one project: { projectId, modules, revision }. The revision guards against a project that changed.',
} as const

/**
 * The words of the three upload tools, in one place. The MCP registers them from here, and the CLI and any other
 * surface read them from here too, so the tools cannot describe one operation two ways. Drafted for Taylan's approval
 * (WORDING-FOR-APPROVAL.md); nothing here states a size or a limit, because the part size and part count come from
 * the server's answer.
 */
export const CREATE_UPLOAD_TEXT =
  "Begin uploading local files as library media. Takes each file's name, type and size in bytes, and answers for each an upload target, which is a temporary write permission and not a media address. A single target: PUT the whole file to its url with exactly its headers. A multipart target: the file goes in parts of the size it states, each signed with sign_upload_parts; PUT each part to its url and keep the ETag header of the store's answer. Then call complete_upload once for the batch. The finished media is referenced by its outputId in generate_* and on a card via update_card. For a file already at a public address, use import. Requires the library:write scope."

export const SIGN_UPLOAD_PARTS_TEXT =
  "Sign parts of a multipart upload. Takes the outputId create_upload answered and the numbers of the parts to send, counted from 1. Answers a url and headers for each: PUT that part's bytes to its url with exactly those headers and keep the ETag header of the store's answer. Part n starts at (n - 1) times the part size create_upload stated and is that long, the last part ending where the file ends. Signed when asked and safe to ask again, so a slow or interrupted upload asks only for the parts it still needs. Requires the library:write scope."

export const COMPLETE_UPLOAD_TEXT =
  "Finish uploads once their bytes were sent. Takes each file's outputId and, for a multipart file, the number and ETag of every part, exactly as the store answered. Finish a batch together, so the person sees it as one card. Publishes each file and answers its outputId and URL. Finishing twice answers the same media. Requires the library:write scope."

/** The upload parameter descriptions, by parameter name. */
export const UPLOAD_PARAMETER_TEXT = {
  files: 'The files to upload.',
  fileName: 'The file name, used for its extension.',
  contentType: 'The MIME type of the file.',
  sizeBytes: 'The size of the file in bytes. The store chooses how the file is uploaded from it.',
  outputId: 'The outputId create_upload answered for the file.',
  partNumbers: 'The numbers of the parts to sign, counted from 1.',
  uploads: 'The files to finish.',
  parts: 'Multipart files only: the number and ETag of every part, exactly as the store answered its PUT.',
  partNumber: 'The part number, counted from 1.',
  etag: "The ETag header of the store's answer to the part's PUT, exactly as received.",
} as const
