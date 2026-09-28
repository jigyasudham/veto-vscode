# Veto VS Code 1.2.0 combined audit — 2026-09-28

Recommendation: hold publication until the high-priority findings are fixed. The automated suite, packaged hosts, and several authenticated workflows pass. Real-browser and authenticated failure-path testing confirmed misleading success states, unreadable High Contrast Light content, broken transcript search, and inconsistent database targeting.

This is the consolidated report from both audit passes. It supersedes the first report's coverage limits and corrects its resume-client finding using live backend evidence. Screenshots: [visual gallery](audit-evidence/index.html). Machine-readable evidence: [visual matrix](audit-evidence/visual-results.json), [contrast measurements](audit-evidence/contrast.json), and the per-workflow auth-*.json files in audit-evidence.

Audited source: master at e6ab0ec; initially clean working tree. Audited artifact: veto-vscode-1.2.0.vsix. A fresh build exactly matches the JavaScript in the artifact. No product source was changed. Added audit scripts, reports, screenshots, and evidence are the deliverables.

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

### F07 — Low: console resume requests a hardcoded client identity

Evidence: src/extension.ts:150 hardcodes resuming_as=antigravity; the action adapter actually launches Claude. The supplied session platform is ignored for this route.

First-pass reproduction: request console resume for a Codex session. The captured tool input still identifies antigravity. Live follow-up: resuming the newly saved Claude test session succeeded and the backend returned active_client=claude. Thus the request is wrong, but the first pass's claim that the stored identity would necessarily be wrong was not borne out in this live test.

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

## Additional executed visual and authenticated checks

The existing VSIX was extracted into a fresh VS Code 1.139.1 profile and run on Node 24.20.0. Chrome DevTools Protocol attached to the actual VS Code webview, not a reconstructed HTML mock. The test workspace was a disposable local Git repository. Settings, themes, and editor actions went through the real extension host; workflow buttons used the packaged handlers and the installed authenticated Claude CLI/Veto 3.8.0 backend.

### Visual matrix

- 60 view captures: Dark Modern, Light Modern, Default High Contrast, and Default High Contrast Light; requested sidebar widths 220, 300, and 480 CSS pixels; Dashboard, Explorer, Workflows, Console, and Settings.
- Measured widths were approximately 219–480 CSS pixels after real sidebar sash drags. Device scaling affects PNG dimensions; the labels are CSS sidebar widths.
- Additional drawer, keyboard, accessibility-tree, horizontal-scroll, and approximately 200% zoom checks. At zoom level 3.8, the narrow sidebar had an effective 167 CSS pixel viewport. The full-window zoom screenshot is authoritative; an initial cropped zoom capture had an offset and is excluded from the gallery.
- Programmatic geometry and computed-color checks covered every matrix entry. Representative screenshots were visually inspected across all four themes and problem layouts; this was not a human screen-reader evaluation.

What worked: five-tab switching; scrollbar/arrow movement (scrollLeft changed from 0 to about 64.8); normal Light/Dark selected-record readability; ordinary card wrapping at the tested widths; structured session details; theme updates without restarting the HUD. Findings below describe the exceptions.

### Authenticated workflow results

| Scenario | Verified result | HUD behavior / qualification |
| --- | --- | --- |
| Save Checkpoint | Successful real save, about 13 s; independently found through veto_sessions_list | Correct success; wrote to backend default DB despite custom HUD DB (F18) |
| Resume that checkpoint in Console | Real saved context restored | Successful; returned client was claude, correcting F07's original impact claim |
| Review synthetic arithmetic utility | Final llm_backed=true, generation=complete, findings and score returned, about 22 s | Completed result visible; approved verdict was not normalized; misleading “completion status unavailable” notification (F17) |
| Scan same synthetic file for secrets | Final llm_backed=true, generation=complete, no secrets, about 17 s | Completed result visible; same verdict-adapter limitation |
| Council debate | Final llm_backed=true; all seven votes, outcome ID, final_verdict=GREEN, about 27 s | HUD lost GREEN and showed generic COMPLETED (F17) |
| Commit draft, no staged changes | Backend explicitly rejected with “No staged changes. Run git add first.” | Incorrect green COMPLETED / No result data (F01) |
| Commit draft after staging | Actual conventional commit draft returned, about 14 s | Successful generation; no commit was made by the AI workflow |
| PR draft with no branch diff | Backend accurately explained there were no committed changes relative to main | Valid no-change response, not a generated change summary |
| PR draft after a synthetic feature commit | Generated title/body, one commit, and diff stat, about 23 s | Successful; test setup made the fixture commit locally; workflow did not publish |
| Review repository PR #1 | Claude reported a 601,395-character tool result exceeding its allowed output size, about 18 s | Review did not complete; HUD still said COMPLETED (F19/F01) |
| Review small public PR microsoft/vscode#338378 | Returned pass, exit_code=0, PR details and checks, about 36 s | Correct GREEN badge. Read-only test; no review/comment posted |
| Diagnostics against custom fixture DB | Actual API state=db_mismatch | Error notification but green COMPLETED result card (F01/F18) |
| Diagnostics with default DB | Actual API state=ok | Successful backend response; request used checks=[] so this is not an exhaustive provider-health certification |
| One-second action timeout | Real subprocess timeout | Incorrect COMPLETED / No result data (F01) |
| Cancel running review | Real cancellation through HUD control | Cancelled state was overwritten by COMPLETED / No result data (F01) |
| CLI Auto-Detect, Save, Diagnostics | Actual rejection: cliPath must be an absolute path to Veto cli.js | Confirms F03 through the UI and backend |
| Transcript search for synthetic content | Actual invalid_request: limit must be <=20 | HUD displayed No transcripts records found (F16) |
| Review deliberately unsafe, never-executed eval fixture | Adapter rejected changed tool arguments; result could not be verified | Correlation guard worked, but HUD again showed COMPLETED. No successful review is claimed for this case |

The one saved test checkpoint is 4667b6cc-30db-4d1a-b62b-0ae2d275c1c9. The test council outcome is 4b16d14d-d105-4405-aaf3-e9d9734acc8c. They are scoped to the disposable veto-live-audit-N6zpUZ/workspace project and labeled synthetic. Existing provider credentials were used without exposing their values. No real secret was submitted, no AI workflow changed project code, and nothing was pushed, published, or posted.

### F12 — High: High Contrast Light hides core HUD text

Actual computed styles and screenshots show white Explorer titles on a white/light background, both selected and unselected. Selected metadata also has approximately 1:1 contrast; the Veto logo disappears. The theme does not provide --vscode-list-activeSelectionForeground or --vscode-sideBarTitle-foreground in this webview, and the CSS falls back to #ffffff.

Evidence: [High Contrast Light Explorer](audit-evidence/hc-light-300-explorer.png), [computed colors](audit-evidence/visual-a11y.json). A readable result in Light Modern does not establish compatibility with High Contrast Light.

Fix: use appropriate foreground fallbacks for each background and test undefined theme tokens, rather than defaulting missing foreground variables to white.

### F13 — Medium: hardcoded colors produce poor contrast in multiple themes

Measured from actual computed colors and alpha-composited backgrounds: the yellow verdict badge is about 1.48:1 in Light Modern and 1.56:1 in High Contrast Light; the active Explorer category pill is about 1.99:1 in High Contrast Dark. Active tab text in Dark Modern is about 3.92:1. These measurements cover these specific controls, not a complete conformance certification.

Evidence: [contrast data](audit-evidence/contrast.json), [High Contrast Dark Explorer](audit-evidence/hc-dark-220-explorer.png). Fix theme-aware badge and active-control foreground/background pairs, including opacity effects.

### F14 — Medium: navigation paints over the detail drawer

With a session drawer open at 300 CSS pixels, the tab bar sits across the top of the drawer content and intercepts pointer hits. tabs-wrapper has z-index=120 while the drawer is 100 and its backdrop 90. A real hit test over the drawer returned a Dashboard tab button underneath the intended overlay.

Evidence: [drawer screenshot](audit-evidence/light-300-drawer.png), visual-results.json interactions.drawer.hitAtNav. Fix the stacking order and prevent background interaction while the dialog is open.

Live accessibility testing additionally confirmed F09: Enter did not open a focused Explorer card, Escape did not close the drawer, focus remained on the background card, aria-hidden stayed true, and no visible drawer dialog appeared in the queried accessibility tree.

### F15 — Medium: narrow sidebar controls are clipped

At approximately 220 CSS pixels in all four themes, Copy Log extends beyond the right edge. The visible backendDiagnostics result title pushes its dismiss button to x≈224–245, beyond the viewport. Console log text is squeezed into very short lines by the timestamp/tag columns. At approximately 200% zoom, the header exceeds the effective viewport and Settings inputs become very narrow, although vertical scrolling still works.

Evidence: [narrow Console](audit-evidence/dark-220-console.png), [geometry matrix](audit-evidence/visual-results.json), [zoomed full window](audit-evidence/light-zoom200-full-window.png). Fix wrapping/min-width behavior, allow toolbar controls to flow onto multiple rows, and avoid fixed metadata columns in narrow consoles.

### F16 — High: Explorer transcript search always violates the backend limit

src/extension.ts:285 sends limit=25. The shipped API v1 schema caps it at 20, and the actual Veto 3.8.0 backend rejected the request with invalid_request. The handler ignores that state, takes missing hits as an empty list, and displays “No transcripts records found.”

Evidence: [actual UI/backend error](audit-evidence/auth-transcripts.json), test/fixtures/api-v1/recall-search.request.schema.json. Fix the limit and propagate unsuccessful envelopes as errors. Add a contract-level integration test for the new HUD route; the older command path already uses 20.

### F17 — Medium: result adapter does not recognize current successful tool formats

Real review/scan results use generation=complete and verdict=approved. The council returns a text preamble followed by JSON containing final_verdict=GREEN. parseToolOutput expects one JSON object, checks verdict rather than final_verdict, and does not recognize approved or generation=complete. As a result, successful workflows show “completion status unavailable,” and the council result badge loses its actual verdict.

Evidence: auth-review.json, auth-scan.json, and auth-debate.json. The small PR review returns verdict=pass and is correctly mapped to GREEN. Fix the adapter using fixtures taken from these actual backend responses, preserving verified call correlation and avoiding success guesses from prose.

### F18 — High: custom HUD database and AI workflow target can diverge silently

The HUD was configured against the synthetic fixture.db. Save Checkpoint nevertheless persisted its result to Veto's normal backend database; veto_sessions_list independently confirmed it there, and the checkpoint became visible only after selecting the default DB. Diagnostics correctly refused the same mismatch, but the AI workflow route did not enforce database identity.

Evidence: auth-checkpoint.json, auth-diagnostics.json, auth-resume.json, and the logged HUD database path. Fix by checking backend/database identity before mutating AI workflows and providing a clear mismatch state. Do not silently write to a different store than the one shown in the HUD.

### F19 — Medium: large PR review cannot finish with the current action tool set

The repository's PR #1 produced an oversized MCP result (601,395 characters). Claude saved it to a tool-result file, but the action invocation permits only the Veto review tool and disables built-in tools, so this tested workflow did not recover and finish the review. A separate 16-line public PR completed successfully, demonstrating that authentication and the basic PR workflow work.

Evidence: auth-prreview-committed.json, auth-prreview-small-public.json, and [extension output](audit-evidence/extension-output.log). Fix or explicitly bound large-PR handling and show an actionable failure. This is not evidence that every large PR fails at exactly the same size.

## Remaining coverage limits

- Graphical tests now cover the actual packaged webview, four built-in themes, narrow/wide sidebar layouts, keyboard controls, and zoom. Third-party themes, a full screen-reader session, and every possible window size remain untested.
- Real authenticated Claude/Veto workflows were executed, including two-phase reasoning and PR review. Gemini/Codex interactive terminal resumes and other provider/account configurations remain untested.
- Synthetic session/review/council records were created by normal authorized backend workflows. The live test revealed that the custom HUD DB did not isolate AI writes (F18). No manual access to Veto's private database internals was used to reconstruct tool behavior.
- Windows was exercised locally. Linux/macOS, Remote SSH/WSL/containers, and long-running performance/large-database load were not executed. The repository has a Linux/Windows CI matrix, but its presence is not evidence that those remote runs passed today.
- No current third-party vulnerability-database audit was performed. Package-content inspection and existing security-related tests do not substitute for that audit.

## Suggested order

Fix false-success reporting, workspace-trust coverage, database targeting, transcript contract compatibility, and High Contrast Light readability first (F01, F02, F18, F16, F12). Then fix stale/project-scoped UI state, pagination, clipboard handling, incomplete controls, overlay stacking, and keyboard/ARIA behavior. Preserve the actual backend response shapes as regression fixtures and run the real-webview matrix again after fixes.

Run the diagnostic harness with node scripts/audit-1.2.0.cjs. It intentionally asserts the current defects; after fixes, replace those expectations with desired-behavior regression tests.

## Remediation — 2026-09-28 (branch fix/audit-1.2.0)

All findings F01–F19 and the additional inspection findings were addressed. Each was fixed test-first; the new tests were run against the original code to confirm they reproduced the defect before the fix was written. `npm test` went from 52 to 116 passing tests. Typecheck and build pass, and the VSIX still has nine entries.

| Finding | Fix | Regression test / live verification |
| --- | --- | --- |
| F01 false success | `runStructuredTool` returns an explicit completed/error/pending/cancelled outcome (`classifyToolStream`). Every HUD route maps it to done/error/cancelled. Diagnostics with a non-ok state is an error. | test/outcome.test.ts, test/extension-routes.test.ts. Live: 1 s timeout → ERROR, Cancel → CANCELLED, unstaged commit → ERROR "No staged changes. Run git add first." |
| F02 trust bypass | Explorer tools/agents check `workspace.isTrusted`; `veto.openTerminal` is registered as a trusted action | extension-routes, commands.test.ts |
| F03 CLI Auto-Detect | New `detectCli` route reads `cli_path` from `veto api version`; saving an invalid cliPath is refused | extension-routes, webview.test.ts. Live: detected the installed cli.js |
| F04 pagination | Load more requests the next offset and appends results | webview.test.ts |
| F05 stale replies | List and detail replies must match the latest request ID; a `scopeChanged` message clears and requeries | webview.test.ts, extension-routes |
| F06 copy limits | `copyText` message (1,000,000 characters); oversized text shows feedback | webview.test.ts, hud.test.ts |
| F07 resume identity | Console resume sends `resuming_as: claude` (the client that actually runs) and is a tracked action | extension-routes, webview.test.ts |
| F08 PR Auto-Detect | New `detectPr` route (GitHub CLI) with loading and error states | extension-routes, webview.test.ts |
| F09 keyboard/ARIA | Cards activate with Enter/Space; roving-tabindex arrow keys for tabs and pills; drawer uses aria-hidden/aria-modal, focus move/trap/restore, Escape, inert background | webview.test.ts. Live: Enter opens, Escape closes, focus moves to the close button |
| F10 project list | Webview posts `ready`; the extension replies with projects, settings, snapshot and logs | webview.test.ts, extension-routes. Live: project list populated at startup |
| F11 Install docs | `data-cmd` buttons dispatch through the command allowlist | webview.test.ts |
| F12 HC Light | Foreground fallbacks use `--vscode-foreground`, never white; HC-specific rules | webview.test.ts. Live: 0 of 28 measured control/theme pairs below 4.5:1 (was 6) |
| F13 contrast | Light-theme status ink, button-token active pill, foreground active tab | same live matrix; minimum is now 4.53:1 |
| F14 stacking | Tab bar 120, backdrop 130, drawer 140, modal 150; background inert | webview.test.ts. Live: hit test over the tab bar now lands on the drawer |
| F15 narrow layout | Wrapping toolbars, result header and inputs; stacked log metadata at ≤260 px | Live: clipped captures 8 → 0, horizontal overflow 4 → 0, zoom clipping gone |
| F16 transcripts | limit 20; non-ok states shown (no_archive/no_match as notices, others as errors); empty query asks for a search | extension-routes. Live: db_mismatch and no_archive shown accurately |
| F17 result formats | `final_verdict`, approved/rejected aliases, `generation: complete`, and a JSON object after a prose preamble | outcome.test.ts using the captured real responses in test/fixtures/tool-results |
| F18 DB divergence | AI workflows (HUD and palette) run a diagnostics identity check against a custom DB and refuse on mismatch | extension-routes, commands.test.ts. Live: checkpoint refused with the backend's mismatch message |
| F19 large PR | An oversized tool result becomes an actionable error that includes its size | outcome.test.ts |
| Additional | Search across council/decisions/constraints/reviews/catalog; catalog errors surfaced and `cliPath` honored; static cards collapse; one HUD action at a time with its own cancellation; Claude progress streamed to the Console; honest message for unknown console commands | details.test.ts, extension-routes, webview.test.ts |
| Found during re-verification | Overlapping backend API calls shared a job key; the rejection was reported as "Veto 3.8.0 or later required" | backend-commands.test.ts. Live: fixed |

Re-verification used the rebuilt VSIX. All four packaged-host smokes passed (VS Code 1.101.0 and 1.139.1, trusted and restricted). The 60-capture real-webview matrix was rerun in an isolated profile; its output was kept outside docs/audit-evidence, so the before-evidence above is unchanged. `scripts/audit-1.2.0.cjs` still asserts the original defects, so it now fails by design; the regression tests in test/ replace it.
