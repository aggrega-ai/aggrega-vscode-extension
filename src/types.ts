// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

// ServerEncoding is the position-encoding the daemon negotiates at
// initialize. UTF-8 wins when both sides offer it; UTF-16 is the LSP
// default fallback when initialize fails or omits the field.
export type ServerEncoding = 'utf-8' | 'utf-16';

// LspPosition is the VS Code / LSP Position shape: 0-based line, then
// 0-based column in UTF-16 code units.
export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspLocation {
  uri: string;
  range: LspRange;
}

// DaemonPosition is the daemon's Position shape: 0-based line, then
// 0-based column in the encoding negotiated at initialize.
export interface DaemonPosition {
  line: number;
  character: number;
}

export interface DaemonRange {
  start: DaemonPosition;
  end: DaemonPosition;
}

export interface DaemonLocation {
  uri: string;
  range: DaemonRange;
}

// Request param shapes for the aggrega/* methods.

// ValidateParams is the request shape for aggrega/validate.
//
// release names the Release to validate against, as a path relative to the
// workspace root — the same form aggrega/irGraph, aggrega/build and
// aggrega/buildPreview take. Naming one asks for the checks only a Release can
// answer: its closure resolved, its lockfile read for pins, its semantic
// violations reported. Omitting it asks for the checks a document answers on
// its own, which is a request in its own right rather than a malformed one, and
// is the honest shape for a workspace that holds no Release to send.
//
// It is optional on this interface for that second case alone. Every caller
// that has a selected Release sends it: the narrower answer reports none of the
// semantic findings, and it does so without raising an error, so a caller that
// silently omitted the field would present a shorter list as a clean verdict.
export interface ValidateParams {
  file: string;
  content: string;
  release?: string;
}
export interface InvalidateParams {
  file: string;
  // granularity selects the daemon's cache-eviction scope. When
  // omitted (or set to "workspace"), the daemon drops the workspace-
  // level resolved-catalog cache alongside the per-file parse +
  // diagnostics caches. The "file" value drops only the per-file
  // caches; "entity" is reserved at the daemon and currently falls
  // through to workspace behavior.
  granularity?: 'file' | 'workspace' | 'entity';
}
export interface DiagnosticsParams { file: string; }
export interface ResolveParams { uri: string; position: DaemonPosition; }
export interface FindReferencesParams { uri: string; position: DaemonPosition; }
export interface FindImplementationsParams { uri: string; position: DaemonPosition; }
export interface HoverParams { uri: string; position: DaemonPosition; }
export interface CompletionParams {
  uri: string;
  position: DaemonPosition;
  triggerCharacter?: string;
}

// JSON-RPC 2.0 framing types.
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: JsonRpcError;
}

// JsonRpcNotification is a server-push JSON-RPC 2.0 message — no
// id field, no expected response. The daemon emits
// aggrega/publishDiagnostics as a notification when diagnostic
// state changes. The Daemon class routes these by method via its
// EventEmitter using the convention `notification:<method>`.
export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

// PublishDiagnosticsParams is the params shape carried by the
// aggrega/publishDiagnostics notification. An empty diagnostics
// array signals "clear this file's DiagnosticCollection entry."
export interface PublishDiagnosticsParams {
  file: string;
  diagnostics: DaemonDiagnostic[];
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: ErrorData;
}

// ErrorData mirrors the daemon's errors_data.go errorData struct.
// All fields are optional — partial data is honest. Line and column
// are 1-based per the daemon's LSP-aligned convention; the
// extension converts to VS Code's 0-based positions at the
// surfaceDiagnostic boundary.
//
// Each path-valued field names one artifact and only that artifact, so
// reading one is enough to know what it points at — no branching on the
// error code. file is the source document line and column locate;
// lockfile is a lockfile; release is a Release.
export interface ErrorData {
  // file names the source document the position fields locate — the
  // document being validated, or the Release whose load failed. It
  // never carries a lockfile path; that has its own field.
  file?: string;
  line?: number;
  column?: number;
  // end_line and end_column carry the 1-based end position of the
  // source token, mirroring the daemon's errors_data.go fields. When
  // present alongside line and column, surfaceDiagnostic renders a
  // range spanning the whole token; absent, it falls back to a
  // point-style range at the start position.
  end_line?: number;
  end_column?: number;
  // release names the Release the error refers to, spelled the way the
  // request named it — the same value the `--release` flag takes. The
  // daemon populates it on the lockfile-absent emission so a client can
  // compose the remediating command without parsing it back out of
  // message. Consumed by error-surfaces' lockfile-absent handler.
  // Optional: an emission path that has no Release in hand omits it.
  release?: string;
  // lockfile names the lockfile a lockfile-scoped failure is about —
  // the path the daemon looked for and did not find, or could not
  // stat. Mirrors the daemon's errors_data.go field of the same name.
  // Optional: an emission path that is not about a lockfile omits it.
  lockfile?: string;
}

// Daemon application error codes (see internal/serve/errors.go).
//
// 1002 is not allocated. It reported that the daemon could not resolve a
// Release for an operation that needed one, which no request can reach: every
// operation acting on a Release is told which one, so there is no choosing left
// to fail at. The number is left unused rather than reassigned, so a later
// condition cannot be mistaken for it.
export const ERR_FILE_NOT_VALIDATED = 1001;
export const ERR_LOCKFILE_ABSENT = 1003;
export const ERR_ENTITY_NOT_RESOLVABLE = 1004;
export const ERR_SHUTTING_DOWN = 1005;

// ServerInitMetadata is the subset of the aggrega/initialize
// response that the extension surfaces in the status bar. Populated
// when the handshake completes; null until then.
//
// workspaceMarker names the marker tier that anchored the workspace
// root: "config" | "directory" | "aggregate-glob" | "release-glob" |
// "manifest-glob". Optional: daemons anchored via --workspace-root
// omit it (no marker was consulted in that path). Extensions reading
// it must tolerate undefined.
export interface ServerInitMetadata {
  workspaceRoot: string;
  configSource: string;
  workspaceMarker?: string;
}

// DaemonDiagnostic mirrors the daemon's per-file Diagnostic wire
// shape from aggrega/validate and aggrega/diagnostics. Line and
// column are 1-based per the daemon's LSP-aligned convention;
// severity is one of "error" | "warning" | "info".
export interface DaemonDiagnostic {
  line: number;
  column: number;
  severity: string;
  message: string;
  // source names the compiler layer that raised the diagnostic — the
  // layer that validates the authored documents, or the layer that runs
  // the build's analysis while inspecting a graph. The extension groups
  // the Problems panel by whatever value arrives rather than assigning a
  // source of its own, so a layer named later needs no client change.
  //
  // Optional because the extension mirrors a wire it does not control:
  // sourceForDaemonDiagnostic supplies the fallback and documents which
  // case that covers.
  source?: string;
  // end_line and end_column carry the 1-based end position of the
  // token the diagnostic spans, mirroring the daemon's Diagnostic wire
  // struct. When present, shapeForDaemonDiagnostic produces a range
  // spanning the token; absent, it falls back to a point-style range.
  end_line?: number;
  end_column?: number;
}

// ValidateResponse is the body the daemon returns for
// aggrega/validate — diagnostics are returned directly in the
// response, so no separate aggrega/diagnostics poll is needed for
// the publish path.
//
// checked says which of the two answers this is, and it arrives only on the
// narrower one: a request that named no Release is answered from the document
// alone and carries CHECKED_DOCUMENT, while a request that named one is
// answered against that Release and omits the field.
//
// The asymmetry is what makes the two answers distinguishable at all. A
// well-formed document validated without a Release comes back with an empty
// diagnostic list, which is identical on the wire to a clean full verdict — so
// a reader treating it as "nothing is wrong" would be told the semantic checks
// passed when they never ran. Its ABSENCE is the signal that a Release was
// actually validated against.
export interface ValidateResponse {
  diagnostics: DaemonDiagnostic[];
  checked?: string;
}

// CHECKED_DOCUMENT is the value ValidateResponse.checked carries when the
// request named no Release: the findings cover the document itself — whether it
// parses, and whether its own shape is admissible — and nothing that needs a
// Release was run.
export const CHECKED_DOCUMENT = 'document';

// ReleaseCandidatesResponse is the aggrega/releaseCandidates result: the
// absolute paths of the workspace's Release-kind documents, determined by the
// daemon by content (`kind: Release`). The extension delegates Release
// detection to the daemon rather than scanning by filename, so the IDE's
// candidate set matches what the daemon resolves.
export interface ReleaseCandidatesResponse {
  releases: string[];
}

// BuildNotice is one advisory a build raised that carries no position in a
// document — a withdrawn pin, an overlapping schema pillar, a parent that would
// not resolve. class names the advisory surface it came from, so the extension
// renders each in its own voice instead of parsing the text; it is the empty
// string for a surface the daemon does not name, which the extension shows as
// the bare text.
//
// These are the advisories the Problems panel does not receive. The ones that
// carry a position arrive on aggrega/publishDiagnostics instead, under the build
// layer's source, and land in that layer's own diagnostic collection.
//
// One shape serves both build requests. A build and a report of what that build
// would write raise the same advisories from the same computation, so a second
// shape would be a second spelling of one fact.
export interface BuildNotice {
  class: string;
  text: string;
}

// BuildPreviewResponse is the aggrega/buildPreview result: the output-relative
// names of the artifacts a build of the requested Release would emit, and the
// advisories that carry no document position.
//
// files are names rather than paths. That request writes nothing, so it has no
// output root to resolve them against, and reporting one would name a location
// nothing put a file at.
export interface BuildPreviewResponse {
  files: string[];
  notices?: BuildNotice[];
}

// BuildResponse is the aggrega/build result: where the build wrote, the
// output-relative names of the artifacts it wrote there, and the advisories that
// carry no document position.
//
// outputDirectory is the absolute directory the artifacts landed in, so a report
// of the build can say where to look. Each entry in files is relative to it,
// which is what makes the two together an answer a reader can act on — and it is
// why this response names a directory where the preview beside it cannot.
export interface BuildResponse {
  outputDirectory: string;
  files: string[];
  notices?: BuildNotice[];
}

// ActiveReleaseResponse is the aggrega/activeRelease result: the absolute path
// of the Release the workspace points at by default, and, where it points at
// none, an account of why.
//
// release is always present, and the empty string means the workspace offers
// none — a state the daemon reports as a successful answer rather than an
// error, so a client asking on events the reader did not request does not raise
// a remediation prompt on every one of them in a workspace that legitimately
// holds no Release.
//
// reason and trace describe the same exhausted reading at two lengths: a
// one-line summary for a compact surface, and the per-step account for a log.
// Both are omitted when a Release resolved, there being nothing to explain.
//
// trace is diagnostic prose written for a person to read, NOT a structure to
// parse: its wording, its layout and the labels it uses follow the workspace
// reading itself and change whenever that does. Pass it through; never match
// patterns against it or lift values out of it.
export interface ActiveReleaseResponse {
  release: string;
  reason?: string;
  trace?: string;
}

// ScaffoldEntityResponse is the aggrega/scaffoldEntity result: the kind the
// skeleton was derived for, and the skeleton itself as YAML text.
//
// kind is echoed rather than left for the caller to remember, so a client with
// several drafting requests outstanding attributes an answer from the answer
// itself.
//
// skeleton is a document to write, not a document that was written. Nothing is
// created and no path is chosen: where the text goes, and whether it goes
// anywhere at all, is this client's decision — which is why it lands in an
// unsaved buffer the author reads, edits or discards.
export interface ScaffoldEntityResponse {
  kind: string;
  skeleton: string;
}

// --- the cache maintenance results ---------------------------------------

// CacheScope states how far a cache answer reached: the classes it addressed
// whose contents every project on the machine shares, and the workspace the
// session was opened over.
//
// Every cache result carries one. A caller that opened a session over a
// workspace has every reason to read an answer as being about that workspace,
// and for some classes that reading is wrong — so the answer says which, rather
// than leaving this side to recognise a class name.
//
// machineWideClasses is always present and always an array, so "no machine-wide
// class was touched" is an empty list to iterate rather than an absent key to
// guess at. That holds for every collection below, which is why nothing here is
// optional and nothing defends against a null.
export interface CacheScope {
  machineWideClasses: string[];
  workspaceRoot: string;
}

// CacheElement is one enumerated entry in a cache class.
//
// digest and note are the two fields the compiler omits when it has none, so
// they are the only optional members in this group.
export interface CacheElement {
  label: string;
  size: number;
  digest?: string;
  note?: string;
}

// CacheClass is one cache class: its name, how far its contents are shared,
// whether reclaiming unreferenced entries can free it, and its entries.
//
// There is no filesystem path, and its absence is deliberate on the compiler's
// side: a question about what the caches hold is a question about content, and
// an answer carrying absolute paths into the machine's own directories would
// describe the host instead.
export interface CacheClass {
  name: string;
  reach: string;
  prunable: boolean;
  elements: CacheElement[];
}

// CacheProvenance is one recorded content digest's resolved plugin identities.
// sharedBy arrives only where more than one identity resolves to the same
// guest bytes.
export interface CacheProvenance {
  identities: string[];
  sharedBy?: number;
}

// CacheStatusResponse is the aggrega/cacheStatus result: every class with its
// entries, the recorded plugin provenance, and the totals. It removes nothing.
export interface CacheStatusResponse {
  classes: CacheClass[];
  provenance: CacheProvenance[];
  totalCount: number;
  totalSize: number;
  scope: CacheScope;
}

// CacheRemoval is one entry an operation removed, carrying the reach of the
// class it came from — so a reader shown a single removal is told its scope
// without having to consult the summary.
export interface CacheRemoval {
  class: string;
  label: string;
  reach: string;
  size: number;
}

// CacheShortfall is a set of entries an operation left behind because it has no
// basis to reclaim them, together with the operations that would. reclaimedBy
// is the compiler's own guidance about what to run next.
export interface CacheShortfall {
  class: string;
  count: number;
  size: number;
  reach: string;
  reclaimedBy: string[];
}

// CachePruneResponse is the aggrega/cachePrune result: what was removed, what
// was kept, and what could not be attributed either way.
export interface CachePruneResponse {
  removed: CacheRemoval[];
  retainedCount: number;
  reclaimedBytes: number;
  unattributedCount: number;
  unattributedSize: number;
  notPruneEligible: CacheShortfall[];
  scope: CacheScope;
}

// CacheEvictResponse is the aggrega/cacheEvict result.
//
// withinCapBefore is the case a reader most needs told apart from a failure: the
// store was already under the cap, so nothing was removed and nothing went
// wrong.
export interface CacheEvictResponse {
  withinCapBefore: boolean;
  removed: CacheRemoval[];
  totalBefore: number;
  reclaimedBytes: number;
  remainingBytes: number;
  capBytes: number;
  scope: CacheScope;
}

// CacheCleared is one whole cache subtree a wipe removed.
export interface CacheCleared {
  class: string;
  reach: string;
  size: number;
}

// CacheClearResponse is the aggrega/cacheClear result: the subtrees the wipe
// removed and the space it reclaimed.
export interface CacheClearResponse {
  cleared: CacheCleared[];
  reclaimedBytes: number;
  scope: CacheScope;
}
