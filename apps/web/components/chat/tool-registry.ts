// @ts-nocheck
/**
 * Tool Registry — maps tool names to renderer components.
 * Pattern from rush-app: extensible, supports Claude Code tools + custom tools.
 */

import type { DynamicToolUIPart, UIMessage } from 'ai';
import type { ComponentType } from 'react';

export interface ToolRendererProps {
  part: DynamicToolUIPart;
  message: UIMessage;
  isStreaming: boolean;
  isLastMessage: boolean;
}

export type ToolRenderer = ComponentType<ToolRendererProps>;

export interface ToolRegistry {
  getRenderer(toolName: string): ToolRenderer | null;
  register(toolName: string, renderer: ToolRenderer): void;
  has(toolName: string): boolean;
}

export function createToolRegistry(tools: Record<string, ToolRenderer> = {}): ToolRegistry {
  const registry = new Map<string, ToolRenderer>(Object.entries(tools));

  return {
    getRenderer(toolName: string) {
      return registry.get(toolName) ?? null;
    },
    register(toolName: string, renderer: ToolRenderer) {
      registry.set(toolName, renderer);
    },
    has(toolName: string) {
      return registry.has(toolName);
    },
  };
}
