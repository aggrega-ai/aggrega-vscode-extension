// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

// The request and answer shapes of the compiler's language-server protocol are
// published as a generated TypeScript binding, and this file consumes that
// binding rather than restating it. Every name below that names a shape the
// compiler sends or receives is an alias of, or a projection of, a published
// declaration — so a field the compiler drops stops type-checking here instead
// of being discovered by a reader noticing its absence.
//
// The import is type-only and therefore erased: nothing from the binding is
// loaded at runtime, and the extension ships no copy of it.
import type * as wire from '@aggrega-ai/aggrega-abi/dist/servewire_gen';

// ServerEncoding is the position-encoding the daemon negotiates at
// initialize. UTF-8 wins when both sides offer it; UTF-16 is the LSP
// default fallback when initialize fails or omits the field.
export type ServerEncoding = 'utf-8' | 'utf-16';

// RequestMethod is every method a request may name, as the compiler publishes
// the set. It is carried rather than a bare string so a method this compiler
// does not answer cannot be composed at all, and a method it stops answering
// fails at every call site that still names it.
export type RequestMethod = wire.RequestMethod;

// RequestId is the identifier a request carries and its answer echoes back.
export type RequestId = wire.RequestId;

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
// 0-based column in the encoding negotiated at initialize. The shape is the
// compiler's own; the name is kept because it is what distinguishes it, at
// every call site, from the editor's own UTF-16 position above.
export type DaemonPosition = wire.Position;

export type DaemonRange = wire.Range;

export type DaemonLocation = wire.Location;

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
export type ValidateParams = wire.ValidateParams;

// granularity selects the daemon's cache-eviction scope. When omitted (or set
// to "workspace"), the daemon drops the workspace-level resolved-catalog cache
// alongside the per-file parse + diagnostics caches. The "file" value drops
// only the per-file caches; "entity" is reserved at the daemon and currently
// falls through to workspace behavior.
export type InvalidateParams = wire.InvalidateParams;
export type DiagnosticsParams = wire.DiagnosticsParams;
export type ResolveParams = wire.ResolveParams;
export type FindReferencesParams = wire.FindReferencesParams;
export type FindImplementationsParams = wire.FindImplementationsParams;
export type HoverParams = wire.HoverParams;
export type CompletionParams = wire.CompletionParams;

// JSON-RPC 2.0 framing types.
export type JsonRpcRequest = wire.Request;

// JsonRpcResponse is one answer as this client reads it: either half of the
// compiler's published pair, read before the two have been told apart. The
// published shapes state each half exactly — a success carries a result and no
// error, a failure the reverse — so a reader that has not yet branched holds
// their union and narrows on which key arrived.
export type JsonRpcResponse = Partial<wire.SuccessResponse> &
  Partial<wire.ErrorResponse> &
  Pick<wire.SuccessResponse, 'jsonrpc' | 'id'>;

// JsonRpcNotification is a server-push JSON-RPC 2.0 message — no
// id field, no expected response. The daemon emits
// aggrega/publishDiagnostics as a notification when diagnostic
// state changes. The Daemon class routes these by method via its
// EventEmitter using the convention `notification:<method>`.
export type JsonRpcNotification = wire.SessionNotification;

// PublishDiagnosticsParams is the params shape carried by the
// aggrega/publishDiagnostics notification. An empty diagnostics
// list signals "clear this file's DiagnosticCollection entry" — and the
// published shape admits null there as well as an empty array, because an
// empty collection reaches the wire as null. Both mean the same thing and
// both are read as "clear".
export type PublishDiagnosticsParams = wire.PublishDiagnosticsParams;

export type JsonRpcError = wire.ErrorObject;

// ErrorData is the structured detail an error envelope may carry. All fields
// are optional — partial data is honest. Line and column are 1-based per the
// compiler's LSP-aligned convention; the extension converts to VS Code's
// 0-based positions at the surfaceDiagnostic boundary.
//
// Each path-valued field names one artifact and only that artifact, so reading
// one is enough to know what it points at — no branching on the error code.
// file is the source document line and column locate, and never a lockfile
// path; lockfile is a lockfile; release is a Release, spelled the way the
// request named it, so a client can compose the remediating command without
// parsing it back out of the message.
export type ErrorData = wire.ErrorData;

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
export type ServerInitMetadata = Pick<
  wire.InitializeResult,
  'workspaceRoot' | 'configSource' | 'workspaceMarker'
>;

// DaemonCodeDescription mirrors the protocol's code-description structure: a
// reference to open for more information about a diagnostic.
//
// It is spelled the way the protocol spells it, both here and on the wire,
// because it IS the protocol's field rather than one of this daemon's own — a
// client that knows the protocol and nothing about this compiler renders it, and
// that is the whole reason the field was used instead of a bespoke one.
export type DaemonCodeDescription = wire.CodeDescription;

// DaemonDiagnostic is the compiler's per-file diagnostic shape, as returned by
// aggrega/validate and aggrega/diagnostics. Line and column are 1-based per the
// compiler's LSP-aligned convention; severity is one of "error" | "warning" |
// "info".
//
// How this surface reads the members it acts on, which is what the published
// shape does not say. code is what a program matches on and shortCode is what a
// person looks up, so the two travel together rather than one instead of the
// other; codeDescription is present exactly when shortCode is, which is what
// keeps a "learn more" affordance from being offered as a link to nothing. The
// Problems panel groups by whatever source arrives rather than assigning one of
// its own, so a layer named later needs no client change here, and
// sourceForDaemonDiagnostic decides in one place what an empty one falls back
// to. end_line and end_column, where they arrive, make the rendered range span
// the token rather than sit at its start.
export type DaemonDiagnostic = wire.Diagnostic;

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
export type ValidateResponse = wire.ValidateResult;

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
export type ReleaseCandidatesResponse = wire.ReleaseCandidatesResult;

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
export type BuildNotice = wire.BuildNotice;

// BuildPreviewResponse is the aggrega/buildPreview result: the output-relative
// names of the artifacts a build of the requested Release would emit, and the
// advisories that carry no document position.
//
// files are names rather than paths. That request writes nothing, so it has no
// output root to resolve them against, and reporting one would name a location
// nothing put a file at.
export type BuildPreviewResponse = wire.BuildPreviewResult;

// BuildResponse is the aggrega/build result: where the build wrote, the
// output-relative names of the artifacts it wrote there, and the advisories that
// carry no document position.
//
// outputDirectory is the absolute directory the artifacts landed in, so a report
// of the build can say where to look. Each entry in files is relative to it,
// which is what makes the two together an answer a reader can act on — and it is
// why this response names a directory where the preview beside it cannot.
export type BuildResponse = wire.BuildResult;

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
export type ActiveReleaseResponse = wire.ActiveReleaseResult;

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
export type ScaffoldEntityResponse = wire.ScaffoldEntityResult;

// --- the cache maintenance results ---------------------------------------

// Every size in this group arrives twice: the measured byte count, and the
// compiler's own rendering of it in a *Text member beside it. A caller that
// computes reads the number; a caller that shows a reader reads the text.
//
// The pairing is what keeps one spelling of a size in one place. The compiler
// reads its own spelling back, and this surface asks for a size cap in the same
// vocabulary — so a reader who copies a figure out of a cache report and types
// it into the trim prompt is copying something the compiler accepts. Rendering
// a size on this side instead would be a second statement of how a quantity of
// bytes is written, agreeing until the day either side rounded differently.

// CacheScope states how far a cache answer reached: the classes it addressed
// whose contents every project on the machine shares, and the workspace the
// session was opened over.
//
// Every cache result carries one. A caller that opened a session over a
// workspace has every reason to read an answer as being about that workspace,
// and for some classes that reading is wrong — so the answer says which, rather
// than leaving this side to recognise a class name.
//
// machineWideClasses is always present, so "no machine-wide class was touched"
// is a key to read rather than an absent one to guess at. That holds for every
// collection in this group, which is why none of them is optional — but an
// empty one reaches the wire as null rather than as an empty list, so a reader
// that iterates coalesces first.
export type CacheScope = wire.CacheScope;

// CacheElement is one enumerated entry in a cache class.
//
// digest and note are the two fields the compiler omits when it has none, so
// they are the only optional members in this group.
export type CacheElement = wire.CacheElement;

// CacheClass is one cache class: its name, how far its contents are shared,
// whether reclaiming unreferenced entries can free it, and its entries.
//
// There is no filesystem path, and its absence is deliberate on the compiler's
// side: a question about what the caches hold is a question about content, and
// an answer carrying absolute paths into the machine's own directories would
// describe the host instead.
export type CacheClass = wire.CacheClass;

// CacheProvenance is one recorded content digest's resolved plugin identities.
// sharedBy arrives only where more than one identity resolves to the same
// guest bytes.
export type CacheProvenance = wire.CacheProvenance;

// CacheStatusResponse is the aggrega/cacheStatus result: every class with its
// entries, the recorded plugin provenance, and the totals. It removes nothing.
export type CacheStatusResponse = wire.CacheStatusResult;

// CacheRemoval is one entry an operation removed, carrying the reach of the
// class it came from — so a reader shown a single removal is told its scope
// without having to consult the summary.
export type CacheRemoval = wire.CacheRemoval;

// CacheShortfall is a set of entries an operation left behind because it has no
// basis to reclaim them, together with the operations that would. reclaimedBy
// is the compiler's own guidance about what to run next.
export type CacheShortfall = wire.CacheShortfall;

// CachePruneResponse is the aggrega/cachePrune result: what was removed, what
// was kept, and what could not be attributed either way.
export type CachePruneResponse = wire.CachePruneResult;

// CacheEvictResponse is the aggrega/cacheEvict result.
//
// withinCapBefore is the case a reader most needs told apart from a failure: the
// store was already under the cap, so nothing was removed and nothing went
// wrong.
export type CacheEvictResponse = wire.CacheEvictResult;

// CacheCleared is one whole cache subtree a wipe removed.
export type CacheCleared = wire.CacheCleared;

// CacheClearResponse is the aggrega/cacheClear result: the subtrees the wipe
// removed and the space it reclaimed.
export type CacheClearResponse = wire.CacheClearResult;
