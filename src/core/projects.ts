import { pathsEqual } from './paths';

/** A pinned workspace wins over editor focus; removed folders never remain selected. */
export function selectedProject(folders: readonly string[], pinned?: string, editorProject?: string): string | undefined {
  return folders.find(p => pathsEqual(p, pinned))
    ?? folders.find(p => pathsEqual(p, editorProject))
    ?? folders[0];
}
