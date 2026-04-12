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

export function EditTool({ part }: ToolRendererProps) {
  const input = part.input as { file_path?: string } | undefined;
  const filePath = input?.file_path ?? '';

  return (
    <Tool>
      <ToolHeader
        type={part.type}
        state={part.state}
        toolName={part.toolName}
        title={filePath ? `Edit ${filePath}` : 'Edit'}
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
