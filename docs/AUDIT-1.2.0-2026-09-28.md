# Veto VS Code 1.2.0 audit — 2026-09-28

Recommendation: fix the high-priority findings before publishing this package. Activation and data-layer tests pass, but the new HUD has functional regressions that those tests do not cover.

Audited source: master at e6ab0ec; initially clean working tree. Audited artifact: veto-vscode-1.2.0.vsix. A fresh build exactly matches the JavaScript in the artifact. No product source was changed. This report and scripts/audit-1.2.0.cjs are the audit deliverables.

## Executed checks

| Check | Result | What it establishes |
| --- | --- | --- |
| npm test | 52/52 passed | Data scoping, read-only access, WAL refresh, schema drift, stale snapshots, backend contracts, process lifecycle, message validation, basic passive rendering |
| npm run typecheck | Passed | TypeScript compilation checks |
| npm run build | Passed | Bundles successfully; output matches packaged JS exactly |
| Existing VSIX, VS Code 1.101.0, trusted | Passed | Real Electron extension host, Node 22.15.1 |
| Existing VSIX, VS Code 1.101.0, restricted | Passed | Real Electron extension host, Node 22.15.1 |
| Existing VSIX, VS Code 1.139.1, trusted | Passed | Real Electron extension host, Node 24.20.0 |
| Existing VSIX, VS Code 1.139.1, restricted | Passed | Real Electron extension host, Node 24.20.0 |
| VSIX contents | Passed | Nine expected entries; no .env, tests, source maps, local tools, or node_modules |
| node scripts/audit-1.2.0.cjs | 12 defect observations reproduced | Actual renderer in a minimal DOM fixture; actual extension routing compiled with mocked VS Code/backend dependencies; some static assertions |

The host smoke verifies activation, contributed command registration, opening the HUD, setup diagnostics, database read-only behavior, missing-database handling, and selected restricted command routes. It does not click through webview controls. Its restricted scenarios do not exercise the new Explorer message routes.

Initial sandbox attempts at tests/build failed with spawn EPERM; reruns with approval passed. This is an execution-environment restriction, not an extension defect. One successful host left a temporary fixture directory because Windows retained a file lock. Host logs also contained unrelated VS Code API/channel warnings; all four test processes exited successfully.

## Findings

### F01 — High: failed or cancelled actions can report success

Evidence: src/commands/veto.ts:89–137 returns undefined for subprocess failures, cancellation, missing correlated results, unfinished reasoning, and backend error results. src/extension.ts:345–429 treats the returned value as completed without checking it. The resume handler at line 150 does the same. hud.js:984 renders a green COMPLETED badge for done without a verdict.

Reproduction: the diagnostic harness makes the structured-tool adapter return undefined, then runs Save Checkpoint. The handler still emits status=done and logs “Saved successfully.” Console resume likewise claims restoration. In real usage, failed authentication, missing Claude, cancellation, or a rejected backend result can reach this path.

Impact: users cannot trust checkpoint, review, scan, draft, or resume completion. A cancelled operation can overwrite the cancelled UI with success when its promise settles.

Fix: return an explicit success/error/cancelled/pending result from the adapter and propagate it through every HUD action. Only claim persistence after a verified successful backend result.

### F02 — High: restricted-workspace Explorer bypasses CLI trust checks

Evidence: src/extension.ts:257–278 invokes spawnProcess for tools and agents without checking workspace.isTrusted. The older command routes in src/commands/catalog.ts:8 do check trust.

Reproduction: with isTrusted=false in the handler harness, queryExplorer/tools and queryExplorer/agents both invoke the subprocess stub. No real subprocess was launched in this reproduction.

Impact: opening these Explorer views executes the installed CLI in a workspace that the extension promises to treat as read-only. This establishes a trust-contract violation, not an arbitrary-code-execution exploit.

Fix: apply the same central trust guard to every CLI/AI/Git/terminal route. Also inspect veto.openTerminal, which is registered without the action=true guard in src/commands/index.ts:104.

### F03 — Medium: CLI Auto-Detect saves a value the backend rejects

Evidence: hud.js:1250 sets the CLI field to the literal string veto. src/commands/backend.ts:18–20 accepts only an absolute .js path when that setting is nonempty.

Reproduction: click Auto-Detect, then Save Configuration. The field becomes veto; the next backend operation rejects it. Clearing the field restores PATH-based resolution.

Fix: resolve the actual cli.js path, or leave the field empty for PATH mode. Do not advertise literal veto as a supported override.

### F04 — Medium: Explorer cannot reach later pages

Evidence: hud.js:518 always sends offset=0, and the script never consumes hasMore. Session and memory queries return 30 entries by default; council/decision queries are also paginated.

Reproduction: deliver Explorer results with hasMore=true. No next-page control appears, and further loads still request offset zero.

Impact: older records are inaccessible by browsing the HUD. A session or memory search can narrow results, but it does not provide general pagination.

Fix: implement next/previous or load-more controls and preserve scope/search with the offset.

### F05 — Medium: stale Explorer responses overwrite newer results

Evidence: hud.js:1296 checks kind but ignores requestId. Detail responses at line 1302 are accepted unconditionally.

Reproduction: deliver request 20 followed by request 19 for the same record kind. Request 19 replaces the newer results. Separately, switch to Settings and deliver an old detail reply: the drawer reopens over Settings.

Impact: rapid searches, source changes, and project switches can display stale results or details. Project changes also do not automatically requery the current Explorer list.

Fix: correlate replies with request, project/database, kind, and scope; invalidate pending work on navigation. Clear stale lists and details when the selected project changes.

### F06 — Medium: Copy Result and Copy Log silently fail for normal-length output

Evidence: hud.js:1027 and 1105 send entire output through copyId. src/ui/messages.ts limits copyId to 512 characters.

Reproduction: set the displayed result to 513 characters and click Copy Result. The real message validator returns null. Copy Log uses the same route.

Fix: use a separate bounded text-copy message with a practical limit and explicit error feedback.

### F07 — Medium: console resume records the wrong client

Evidence: src/extension.ts:150 hardcodes resuming_as=antigravity; the action adapter actually launches Claude. The supplied session platform is ignored for this route.

Reproduction: request console resume for a Codex session. The captured tool input still identifies antigravity.

Fix: identify the actual client executing the resume, or offer a provider selection and invoke that provider consistently. The embedded console currently dispatches workflows/logs; it is not an ongoing AI conversation.

### F08 — Medium: PR Auto-Detect is a placeholder

Evidence: hud.js:1058 only changes the input placeholder to “Detecting PR...”.

Reproduction: click Auto-Detect. No message is sent and no URL is populated.

Fix: wire branch/PR detection with loading, error, and success states, or remove the button until implemented.

### F09 — Medium: Explorer cards cannot be activated with the keyboard

Evidence: hud.js:545 creates focusable divs with role=button, but only click handlers are registered.

Reproduction: inspect a rendered card in the DOM fixture: tabindex=0 and role=button exist; no keydown handler exists. Divs do not provide native button activation.

Additional accessibility issues from inspection: the drawer retains aria-hidden=true when opened (hud.html and hud.js:920); the drawer/modal has no focus transfer, focus trap, Escape close, or focus restoration; tabs lack arrow-key handling. These additional issues were not tested with a screen reader.

Fix: use native buttons or implement keyboard behavior; synchronize ARIA visibility and manage dialog focus.

### F10 — Medium: project selector is not initialized reliably

Evidence: the HTML select starts empty. Default webview startup does not request getProjects. Activation never seeds HudView.currentProjects; only subsequent project/editor/workspace events and explicit requests do so.

Reproduction: the default renderer startup emits no project request. Static inspection confirms no initial postProjects call in activation's startup path. A later editor event can mask the defect.

Fix: add a webview-ready handshake that sends snapshot, projects, settings, and buffered logs. This also avoids relying on messages posted before the webview is listening.

### F11 — Low: missing-database Install docs button is inert

Evidence: hud.html uses data-cmd=veto.openInstallDocs, but the script has no data-cmd dispatcher or dedicated listener for this button.

Reproduction: the audit confirms the markup exists and no dispatch binding exists. The command itself remains available separately.

Fix: bind the button through the existing command allowlist.

F05 contains two separately reproduced observations (stale list and stale drawer), which accounts for the harness total of 12 observations across these 11 grouped findings.

## Additional inspection findings

- Search is presented across Explorer kinds, but only sessions, memory, and transcripts consume the search string. Council, decisions, reviews, tools, and specialists return unfiltered results.
- Tools/specialists swallow CLI/parse errors and display an empty list, making setup failures look like “no records.” These routes also bypass the configured cliPath.
- Static Workflows/Settings card headers present button roles and collapse chevrons but are not wired for collapsing.
- Multiple different workflow actions can overlap, while the HUD tracks only one timer/result and the cancel route cancels all tracked processes. Action request IDs are not used to protect displayed state.
- Console unknown commands say “submitted” but only append a local message. The console does not stream the structured-action subprocess output: that output goes directly to the VS Code Output channel while HUD logs show start/end summaries.

These are code-inspection findings, not additional full-browser reproductions.

## Coverage limits

- No full graphical browser automation was available locally. Actual VS Code hosts were exercised, but pixel layout, narrow-sidebar scrolling, selection contrast in light/dark/high-contrast themes, zoom, and screen-reader output were not visually certified.
- AI-provider calls were mocked for failure-path reproduction. Successful authenticated Claude workflows, actual two-phase council execution, real GitHub PR review, and paid provider behavior were not run.
- Backend contract tests use fixtures. This audit did not run writes against the user's Veto database, save test sessions into it, or send messages/publish anything.
- Windows was exercised locally. Linux/macOS, Remote SSH/WSL/containers, and long-running performance/large-database load were not executed. The repository has a Linux/Windows CI matrix, but its presence is not evidence that those remote runs passed today.
- No current third-party vulnerability-database audit was performed. Package-content inspection and existing security-related tests do not substitute for that audit.

## Suggested order

Fix F01 and F02 first, then CLI configuration, stale/project-scoped UI state, pagination, and clipboard handling. Wire the incomplete controls and address keyboard/ARIA behavior. Add meaningful end-to-end webview tests covering these paths before calling the release fully tested.

Run the diagnostic harness with node scripts/audit-1.2.0.cjs. It intentionally asserts the current defects; after fixes, replace those expectations with desired-behavior regression tests.
