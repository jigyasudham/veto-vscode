# Change Log

## 1.2.1
### Accessibility (a11y), Theme Resilience & Multi-Client Resume
- **Screen Reader & ARIA Accessibility**: Added accessible names (`aria-labelledby`) to active progress and workflow result regions per WCAG 2.1; added `role="status"` and live regions to the verdict badge, sync status, and console status indicator; added `role="radiogroup"` to scope selectors; added accessible labels to action and copy buttons; initialized collapsible card headers with `aria-expanded="true"`.
- **Dialog Inert Trapping**: Resume choice modal now sets `inert` across background elements when opened and restores interaction cleanly on dismiss.
- **Theme Resilience & Contrast Hardening**: Hardened status badges (`.badge.red`, `.badge.deadlock`, `.badge.green`, `.badge.yellow`), vote chips, log tags, and callouts across light, dark, and popular third-party themes (Dracula, Nord, One Dark Pro, Solarized, GitHub). Tuned inactive tab and card metadata opacity to guarantee WCAG AA contrast (>= 4.5:1 for badges and text; >= 3:1 for inactive controls) in dark mode, light mode, and high-contrast modes.
- **Antigravity CLI Resume**: Added Antigravity to supported terminal resume providers (`PLATFORMS`) in `resumeSessionInTerminal()`, allowing direct continuation of sessions via the Antigravity CLI alongside Claude, Gemini, and Codex.
- **Windows Process Headroom**: Improved subprocess timeout margin in actions deduplication test to prevent CI/load flakiness.

## 1.2.0
### Features & UI/UX Overhaul
- **5-Tab Integrated Layout**: Replaced popups and redirects with five dedicated tabs: Dashboard, Explorer, Workflows, Console, and Settings. Tab state persists across panel collapses.
- **In-Extension Settings & Diagnostics**: View and configure `cliPath`, `dbPath`, `pollInterval`, and `actionTimeoutMs` directly within the HUD. Includes live SQLite WAL, Node, and Workspace Trust diagnostic indicators.
- **In-Extension Console Streaming**: Dedicated live console stream for tool executions, subprocess logs, and background sync with log level filters, text search, auto-scroll, and copy/clear.
- **Workflow Execution Flow**: Stay on the Workflows tab during action execution with an Active Progress Card featuring an animated spinner, live elapsed timer, cancellation support, and in-place completion cards.
- **In-Extension Explorer & Detail Drawer**: Browse sessions, memory, council history, decisions, constraints, reviews, learning stats, catalog tools, agents, and transcripts with in-place search and a slide-over detail inspection drawer.
- **Project Dropdown Selector & Dual Resume**: Switch projects directly from the HUD header; resume sessions with a choice between "Run in Extension Console" or "Open in VS Code Terminal".

### Pre-release audit fixes
- **Honest action results**: failed, timed-out, cancelled, unverified, and unfinished actions now show ERROR or CANCELLED with the backend's message instead of COMPLETED. Real review, scan, council, draft, and resume result formats are recognized, including council `final_verdict` after a prose preamble.
- **One action at a time**: HUD actions are tracked by request ID; Cancel stops only the HUD's own action, and Claude's progress streams into the Console.
- **Database safety**: AI workflows refuse to run when the HUD reads a custom database that the Veto backend does not use, instead of silently writing elsewhere.
- **Workspace trust**: the Explorer's tool and specialist catalogs and `veto.openTerminal` require a trusted workspace. Catalogs honor `veto.cliPath` and show CLI errors.
- **Transcript search**: respects the backend's 20-result limit, needs a search term, and shows backend states (no archive, database mismatch, invalid request) instead of "no records". Overlapping backend calls no longer fail with a misleading version error.
- **Explorer**: Load more pagination, search for council/decision/constraint/review/catalog records, stale replies ignored, and results reset when the project or database changes.
- **Working controls**: CLI and PR Auto-Detect ask the extension and report errors; Copy Result/Copy Log handle long text; Install docs works; the project list loads on startup through a ready handshake.
- **Accessibility**: keyboard activation for Explorer cards, arrow-key tabs, and collapsible Workflows/Settings cards. The detail drawer is a real dialog with focus management, Escape, and an inert background.
- **Themes and layout**: readable High Contrast Light, 4.5:1 or better on measured status badges and active controls in all four built-in themes, the drawer stacked above the tab bar, and no clipped controls at 220 px or 200% zoom.

## 1.1.0
### Features
- **API v1 Integration**: Support for Veto 3.8.0+ API v1 commands including transcript search (`recall search`), event expansion (`recall expand`), and structured backend diagnostics.
- **Catalog Integration**: Automatic discovery of installed tools and specialist agents via `veto tools` and `veto agents`.
- **Smoke Testing & Fixtures**: Added automated extension host smoke testing and frozen API v1 schema fixtures.

## 1.0.1
### Bug fix
- HUD council verdict is now scoped to the open workspace. It previously showed the
  globally-newest debate, so a verdict from another folder could appear. The HUD now
  filters `council_outcomes` by the active project (direct `project_dir` column when the
  Veto server provides it, else a session join), invalidates its cache on workspace
  switch, and shows "No council verdict for this project." when the folder has no debate.

## 1.0.0
- Initial release: live Veto MCP dashboard (HUD, sessions, memory, council verdict, status).
