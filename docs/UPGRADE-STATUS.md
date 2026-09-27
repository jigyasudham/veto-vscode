# Extension upgrade status — September 27, 2026

Branch: `feat/batch-d-visibility`. Version: `1.1.0`.

## Reconciled session and release sequence

### Acceptance against published @jigyasudham/veto@3.8.0 (September 27)

Veto 3.8.0 was published across npm, GitHub, MCP registry, and Smithery with frozen API v1 contracts.
Consumer acceptance was re-run against the published package installed in an isolated directory (`npm i --prefix <temp dir> @jigyasudham/veto@3.8.0`):

1. **Fixtures pinned to shipped contract:**
   Copied contract schemas and example envelopes from the published package's `contracts/api-v1/` into `test/fixtures/api-v1/`.
2. **Version gate:**
   `api version` is checked before every API operation:
   - Requires `data.contract === 1` and `backend_version >= 3.8.0`.
   - Older Veto versions answering `Unknown command: api` as plain text or non-JSON output throw an actionable error: `Veto 3.8.0 or later required. Run: npm i -g @jigyasudham/veto@latest`.
   - Declared minimum in `package.json` marketplace description and `README.md`.
3. **Execution transport:**
   - Invocation runs `node <cli_path> api <command> --stdin` with an argument array and `shell: false`.
   - `cli_path` is extracted from `api version` (`data.cli_path`).
   - Request is delivered as JSON on stdin. User text is never passed through `veto.cmd` or shell flags.
4. **Response parsing:**
   - Unrecognized fields in responses are ignored for forward-compatibility.
   - Unrecognized states are treated as errors, surfacing their `message` and `next_action`.
   - Within a snapshot, each section (`database`, `transcripts`, `lessons`, `trial`) handles `ok`, `unavailable`, and `error` states independently.
5. **Runtime behavior:**
   - Recall search only runs on explicit user request; timeouts apply and child processes are terminated on timeout or cancellation.
   - Snapshots are cached in memory and refreshed only on explicit action or when the database changes (WAL/data_version change).
   - Selected project is always passed. When a custom database path is configured, `db` is sent and `db_mismatch` is displayed.
6. **Packaged host and diff review:**
   - Packaged host smoke passed on VS Code 1.139.1 (trusted and restricted) and VS Code 1.101.0 (minimum supported).
   - 51 unit tests passed; TypeScript typecheck passed; VSIX packaged at 40.3 KB.
   - Veto diff review passed (`✅ PASS`).
   - Remote workspaces stay on hold as requested.

## Evidence

- **51 unit and fixture tests pass** (`npm test`).
- **TypeScript typecheck clean** (`npm run typecheck`).
- **Consumer acceptance against published 3.8.0 CLI passes** (`node scripts/api-candidate-smoke.cjs <cliPath>`).
- **Packaged host smoke passes:**
  - VS Code 1.139.1 / Node 24.20.0 (trusted)
  - VS Code 1.139.1 / Node 24.20.0 (restricted workspace)
  - VS Code 1.101.0 / Node 22.15.1 (minimum engine)
- **Veto diff review:** `✅ PASS` (code review approved with warnings, security clean, secrets clean, no decision drift).
- **VSIX package generated:** `veto-vscode-1.1.0.vsix` (40.3 KB).
