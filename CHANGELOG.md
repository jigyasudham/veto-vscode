# Change Log

## 1.2.0
### Features & UI/UX Overhaul
- **5-Tab Integrated Layout**: Replaced popups and redirects with five dedicated tabs: Dashboard, Explorer, Workflows, Console, and Settings. Tab state persists across panel collapses.
- **In-Extension Settings & Diagnostics**: View and configure `cliPath`, `dbPath`, `pollInterval`, and `actionTimeoutMs` directly within the HUD. Includes live SQLite WAL, Node, and Workspace Trust diagnostic indicators.
- **In-Extension Console Streaming**: Dedicated live console stream for tool executions, subprocess logs, and background sync with log level filters, text search, auto-scroll, and copy/clear.
- **Workflow Execution Flow**: Stay on the Workflows tab during action execution with an Active Progress Card featuring an animated spinner, live elapsed timer, cancellation support, and in-place completion cards.
- **In-Extension Explorer & Detail Drawer**: Browse sessions, memory, council history, decisions, constraints, reviews, learning stats, catalog tools, agents, and transcripts with in-place search and a slide-over detail inspection drawer.
- **Project Dropdown Selector & Dual Resume**: Switch projects directly from the HUD header; resume sessions with a choice between "Run in Extension Console" or "Open in VS Code Terminal".

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
