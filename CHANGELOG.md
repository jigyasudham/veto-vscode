# Change Log

## 1.0.1
### Bug fix
- HUD council verdict is now scoped to the open workspace. It previously showed the
  globally-newest debate, so a verdict from another folder could appear. The HUD now
  filters `council_outcomes` by the active project (direct `project_dir` column when the
  Veto server provides it, else a session join), invalidates its cache on workspace
  switch, and shows "No council verdict for this project." when the folder has no debate.

## 1.0.0
- Initial release: live Veto MCP dashboard (HUD, sessions, memory, council verdict, status).
