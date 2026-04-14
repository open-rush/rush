'use client';

import {
  ChevronRightIcon,
  MonitorIcon,
  RadioIcon,
  ToggleLeftIcon,
  ToggleRightIcon,
  TrashIcon,
  WifiIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { McpItem } from './mcp-card';

interface McpListItemProps {
  mcp: McpItem;
  onToggle?: (mcp: McpItem) => void;
  onDelete?: (mcp: McpItem) => void;
  onClick?: (mcp: McpItem) => void;
}

function getTransportIcon(transport: string) {
  switch (transport) {
    case 'stdio':
      return MonitorIcon;
    case 'sse':
      return RadioIcon;
    case 'streamable-http':
      return WifiIcon;
    default:
      return MonitorIcon;
  }
}

export function McpListItem({ mcp, onToggle, onDelete, onClick }: McpListItemProps) {
  const TransportIcon = getTransportIcon(mcp.transport);

  return (
    <div
      className="flex items-center gap-4 rounded-lg border border-border bg-background px-4 py-3 transition-colors hover:bg-accent/30 cursor-pointer"
      onClick={() => onClick?.(mcp)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onClick?.(mcp);
      }}
      role="button"
      tabIndex={0}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950">
        <TransportIcon className="h-4 w-4 text-emerald-500" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{mcp.name}</span>
          {mcp.enabled && (
            <Badge className="bg-green-100 text-green-700 hover:bg-green-100 px-1.5 py-0 text-[10px]">
              Active
            </Badge>
          )}
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
            {mcp.transport}
          </Badge>
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
            {mcp.scope}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {mcp.description || (mcp.transport === 'stdio' ? mcp.command : mcp.url) || 'No description'}
        </p>
      </div>

      {mcp.toolCount !== undefined && mcp.toolCount > 0 && (
        <span className="hidden md:inline text-xs text-muted-foreground shrink-0">
          {mcp.toolCount} tools
        </span>
      )}

      <div className="flex items-center gap-1 shrink-0">
        {onToggle && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(mcp);
            }}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            {mcp.enabled ? (
              <ToggleRightIcon className="h-4 w-4 text-green-500" />
            ) : (
              <ToggleLeftIcon className="h-4 w-4" />
            )}
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(mcp);
            }}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      <ChevronRightIcon className="h-4 w-4 text-muted-foreground shrink-0" />
    </div>
  );
}
