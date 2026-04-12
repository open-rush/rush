import { createToolRegistry } from '../tool-registry';
import { BashTool } from './bash-tool';
import { EditTool } from './edit-tool';
import { GenericTool } from './generic-tool';
import { ReadTool } from './read-tool';
import { WriteTool } from './write-tool';

/**
 * Default tool registry with Claude Code tool renderers.
 * Pattern from rush-app: each tool has a specialized renderer,
 * unknown tools fall back to GenericTool.
 */
export const defaultToolRegistry = createToolRegistry({
  // Claude Code tools
  Bash: BashTool,
  Grep: BashTool,
  Read: ReadTool,
  Write: WriteTool,
  Edit: EditTool,
  MultiEdit: EditTool,
  Glob: ReadTool,
  LS: ReadTool,
  WebFetch: GenericTool,
  TodoWrite: GenericTool,
  NotebookEdit: GenericTool,

  // Agent/subagent
  Agent: GenericTool,
});

export { BashTool } from './bash-tool';
export { EditTool } from './edit-tool';
export { GenericTool } from './generic-tool';
export { ReadTool } from './read-tool';
export { WriteTool } from './write-tool';
