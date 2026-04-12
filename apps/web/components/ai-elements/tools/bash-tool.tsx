// @ts-nocheck
'use client';

import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool';
import type { ToolRendererProps } from '../tool-registry';

/**
 * Bash/Grep tool renderer.
 * Shows command + output.
 */
export function BashTool({ part }: ToolRendererProps) {
  const input = part.input as { command?: string } | undefined;
  const command = input?.command ?? '';

  return (
    <Tool>
      <ToolHeader
        type={part.type}
        state={part.state}
        toolName={part.toolName}
        title={command ? `$ ${command}` : part.toolName}
      />
      <ToolContent>
        {part.input && <ToolInput input={part.input} />}
        {(part.output || part.errorText) && (
          <ToolOutput output={part.output} errorText={part.errorText} />
        )}
      </ToolContent>
    </Tool>
  );
}
