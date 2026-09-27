# Batch D: extension changes and Veto backend handoff

Historical checkpoint. The subsequent API v1 integration and current validation are documented in [UPGRADE-STATUS.md](UPGRADE-STATUS.md); the missing-contract statements below describe the earlier state.

Scope agreed September 27, 2026: keep implementation in `D:\veto-vscode` and document the work required in `D:\Veto`. No backend files were changed. Branch: `feat/batch-d-visibility`, based on Batch C commit `c5af3ce`.

## Implemented in the extension

- Added a Setup and provenance card, including when the database is missing or the extension host cannot load SQLite. It displays database readability, the last successful read, compatibility warnings and read failures. Database absence no longer claims the server is uninstalled.
- Added **Veto: Setup and Data Provenance** in the command palette and the HUD. It opens a plain-text report containing the extension version, actual extension-host Node version, local/remote execution location, workspace trust, selected project and database schema/read state. This command performs no subprocess or network checks and is usable in restricted workspaces.
- Clearly labels server version, MCP registration, provider availability/authentication and live context as unknown or not checked. A readable database is not evidence of a healthy MCP connection.
- Replaced fixed provider context windows and percentage gauges with saved token counts, the recorded provider and explicit provenance. Database refresh time is separate from the age of the saved record; refreshing does not measure live activity.
- Added explanatory transcript and lesson/trial cards. These are unavailable-state UI, not implemented search or trial dashboards. The transcript card points users to `veto_session_replay` in their connected AI client. Current consent and trial progress remain unknown.
- Renamed Health to Database statistics and clarified saved-session wording in the status-bar tooltip.
- Added regression tests for setup states and execution of the actual HUD renderer. Passive rendering emits no command, including when lesson/transcript cards are shown; setup remains accessible without a database.

The extension does not read personal transcript archives or host memory, harvest notes, accept consent, deliver lessons, or evaluate the shadow trial. No new dependencies or release-version changes were introduced.

## Why full Batch D needs backend work

Inspected source, not live personal data:

| Backend source | Finding |
| --- | --- |
| `src/cli/lessons.ts` | `status`, `list` (including `--json`) and `why` call `refreshLessons`. They are not passive display endpoints. |
| `src/lessons/manage.ts` | `lessonsStatus` already assembles sharing, per-host counts, held/unlinked notes, exclusions, drift-related state and trial status, but imports storage/config internals. The extension should not import it. |
| `src/cli.ts`, `transcriptsCommand` | Transcript status/list/show are human-readable commands; no structured query/expand transport for the extension was found. The metric command's JSON output does not provide recall. |
| `src/server/handlers/session.ts` | `veto_session_replay` already exposes structured search and expansion over MCP. Expansion accepts event/archive/session references; the extension still needs a supported transport and an explicit scope/consent contract. |
| `src/transcripts/recall.ts` | Queries lazily index archives and may build semantic vectors. They belong behind explicit user actions, not HUD polling. |
| `src/transcripts/config.ts` | Capture consent and retained archives have distinct lifecycles. Disabling capture retains archives; do not infer archive-read policy from capture state. |

## Required changes in Veto's code

### 1. Versioned, passive visibility snapshot

Provide a documented mechanical endpoint, for example a JSON CLI command or a dedicated MCP method. Its name and schema are proposals, not existing APIs. Return:

- Contract version, backend version, generated-at timestamp, supported capabilities and selected project identity.
- Transcript capture/consent state: disabled, enabled, reconsent required or unknown; separately state whether archive recall is permitted.
- Lesson consent/sharing state, counts by host, held/unlinked counts and disabled-source reasons. Declare which counts are global versus project-scoped.
- Trial state derived from the backend: shadow-only mode, start/deadline, qualifying count, target, completion, outcome counts and drift warnings. Never hardcode historical dates or the old target in the extension.
- Per-section unavailable/error states so an older installation can still supply the sections it supports.

Do not call `refreshLessons`, capture/index transcripts, run trial evaluation, send data to providers, accept consent or perform migrations merely to satisfy a passive read. The existing internal `lessonsStatus` result is a useful starting point, but audit its transitive reads and DB initialization. Use an explicit read-only path with missing-schema handling rather than opening/migrating storage through `getDb` in a HUD poll.

Do not expose raw lesson source paths or arbitrary config contents. Return only required, masked provenance; fetch masked note details on demand if that feature is added.

### 2. Supported structured recall transport

Expose existing `veto_session_replay` semantics through a documented client boundary the extension can call deterministically. Prefer a narrow JSON CLI facade or a supported MCP connection; do not require an LLM to translate UI input into tool calls and parse prose back into data.

- Search input: explicit selected project, query, bounded limit/cursor and optional source filter. Reject missing scope rather than silently searching all projects.
- Search output: stable event/archive identifiers, masked snippet, source/provider, source session, timestamp, scope and retrieval provenance. Preserve the historical-data disclaimer.
- Expansion: validate the selected event/archive against the same project and return bounded masked text with source/session/range provenance. Never expose raw L0 source to the webview. Existing expansion references need project-boundary enforcement for this UI contract.
- Return distinct states for consent off/reconsent, no archive, no match, unsupported contract and backend error. Define whether deliberately searching retained archives after capture is disabled is allowed; test and document that policy rather than silently enabling capture.
- Keep indexing or optional embedding computation limited to explicit search. No discovery, capture or harvesting on dashboard refresh.

### 3. Structured setup diagnostics

Provide a machine-readable, bounded diagnostic result separating backend version, schema compatibility, MCP registration for each client, executable availability and authentication-not-checked. Any expensive or network checks must be explicit, with timestamps and cancellation. Passive DB reads cannot establish these facts.

Specify host-location behavior: local/SSH/WSL/container paths and executables must refer to the same environment. A custom extension database path must not silently cause a backend action against a different default database.

### 4. Backend review and tests

Follow `D:\Veto\AGENTS.md` for any new tool classification and required governance. This extension patch creates no server tool and does not reclassify existing ones.

Use fixture config, DBs and transcripts. Verify disabled/reconsent behavior without writes; unchanged DB/config/archive files during passive snapshots; no harvest/delivery/evaluation calls; masked output; project isolation on both search and expansion; bounded responses; missing/future schemas; and accurate shadow progress. Publish shared contract fixtures or a small versioned schema for the extension to validate.

## Follow-up in the extension after that contract ships

Implement a trusted-workspace, user-triggered, bounded/cancellable transport with quiet Windows process handling and an explicitly selected project. Add search/result/detail UI with stale-request protection and masked provenance. Populate lesson/trial cards from validated passive snapshots, retaining unavailable states for older servers. Add contract/adapter and UI tests. Verify minimum/current supported VS Code activation, remote placement and no unexpected console windows before release.

## Validation of this patch

- `npm run typecheck`: passed.
- `npm test`: 36 tests passed (34 existing and 2 new). The sandbox initially blocked test workers with `spawn EPERM`; the approved rerun passed.
- `npm run package`: passed; produced `veto-vscode-1.0.1.vsix` (30.2 KB). The sandbox initially blocked esbuild; the approved rerun passed. This is a local build, not a published release.
- No actual VS Code extension-host or remote-workspace smoke test was performed. Unit tests and packaging do not establish those runtime guarantees.

Full Batch D remains pending the backend contracts and subsequent extension integration. Batches A-C remain on the branch ancestry; this patch does not merge, publish, or release them.
