'use client';

import {
  MonitorIcon,
  RadioIcon,
  ToggleLeftIcon,
  ToggleRightIcon,
  TrashIcon,
  WifiIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export interface McpItem {
  id: string;
  name: string;
  transport: string;
  command?: string | null;
  url?: string | null;
  enabled: boolean;
  scope: string;
  description?: string;
  tags?: string[];
  toolCount?: number;
}

interface McpCardProps {
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

function getTransportLabel(transport: string) {
  switch (transport) {
    case 'stdio':
      return 'Stdio';
    case 'sse':
      return 'SSE';
    case 'streamable-http':
      return 'HTTP';
    default:
      return transport;
  }
}

export function McpCard({ mcp, onToggle, onDelete, onClick }: McpCardProps) {
  const TransportIcon = getTransportIcon(mcp.transport);

  return (
    <div
      className="group relative flex h-full min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl bg-background p-5 shadow-[0px_0px_15px_rgba(0,0,0,0.09)] transition-all duration-200 hover:shadow-[0px_0px_20px_rgba(0,0,0,0.15)] hover:scale-[0.98] motion-reduce:transform-none dark:shadow-[0px_0px_15px_rgba(0,0,0,0.3)]"
      onClick={() => onClick?.(mcp)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onClick?.(mcp);
      }}
      role="button"
      tabIndex={0}
    >
      {/* Corner decoration */}
      <div
        className="absolute right-0 top-0 h-12 w-12 bg-emerald-500"
        style={{ clipPath: 'polygon(100% 0, 0 0, 100% 100%)' }}
      />
      <div className="absolute right-2 top-2 z-10">
        <TransportIcon className="h-4 w-4 text-white/90" />
      </div>

      {/* Header */}
      <div className="mb-3 pr-10">
        <h3 className="truncate text-sm font-semibold text-foreground">{mcp.name}</h3>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {mcp.enabled && (
            <Badge className="bg-green-100 text-green-700 hover:bg-green-100 px-1.5 py-0 text-[10px]">
              Active
            </Badge>
          )}
          <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
            {getTransportLabel(mcp.transport)}
          </Badge>
          <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
            {mcp.scope}
          </Badge>
        </div>
      </div>

      {/* Description */}
      <p className="mb-3 line-clamp-2 text-[13px] leading-relaxed text-foreground/60">
        {mcp.description || (mcp.transport === 'stdio' ? mcp.command : mcp.url) || 'No description'}
      </p>

      {/* Tags */}
      {mcp.tags && mcp.tags.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {mcp.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-xs font-medium"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="mt-auto flex items-center justify-between pt-2">
        <div className="flex items-center gap-3">
          {mcp.toolCount !== undefined && mcp.toolCount > 0 && (
            <span className="text-xs text-muted-foreground">{mcp.toolCount} tools</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onToggle && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggle(mcp);
              }}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              {mcp.enabled ? (
                <ToggleRightIcon className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <ToggleLeftIcon className="h-3.5 w-3.5" />
              )}
              {mcp.enabled ? 'Disable' : 'Enable'}
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(mcp);
              }}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-destructive hover:bg-destructive/10 transition-colors"
            >
              <TrashIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
