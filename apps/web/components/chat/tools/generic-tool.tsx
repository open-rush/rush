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
 * Fallback renderer for unknown/custom tools.
 */
export function GenericTool({ part }: ToolRendererProps) {
  return (
    <Tool>
      <ToolHeader
        type={part.type}
        state={part.state}
        toolName={part.toolName}
        title={part.toolName}
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
