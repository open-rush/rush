'use client';

import { Loader2, PlusIcon, RefreshCwIcon, RssIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { McpCard, type McpItem } from '@/components/mcps/mcp-card';
import { McpListItem } from '@/components/mcps/mcp-list-item';
import { SearchInput } from '@/components/shared/search-input';
import { type ViewMode, ViewModeToggle } from '@/components/shared/view-mode-toggle';

export default function McpServersPage() {
  const [servers, setServers] = useState<McpItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [transportFilter, setTransportFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [projectId, setProjectId] = useState<string | null>(null);

  const loadProjectAndServers = useCallback(async () => {
    setLoading(true);
    try {
      const projRes = await fetch('/api/projects/default');
      const projJson = await projRes.json();
      const pid = projJson.data?.id;
      if (!pid) return;
      setProjectId(pid);

      const res = await fetch(`/api/projects/${pid}/mcp`);
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setServers(json.data);
      }
    } catch {
      // Silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjectAndServers();
  }, [loadProjectAndServers]);

  const handleDelete = useCallback(
    async (mcp: McpItem) => {
      if (!projectId) return;
      try {
        await fetch(`/api/projects/${projectId}/mcp`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serverId: mcp.id }),
        });
        setServers((prev) => prev.filter((s) => s.id !== mcp.id));
      } catch {
        // Silent
      }
    },
    [projectId],
  );

  const filtered = servers.filter((s) => {
    if (transportFilter !== 'all' && s.transport !== transportFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      (s.description?.toLowerCase().includes(q) ?? false) ||
      (s.command?.toLowerCase().includes(q) ?? false) ||
      (s.url?.toLowerCase().includes(q) ?? false)
    );
  });

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1400px] px-8 py-8">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">MCP Servers</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              浏览和管理 MCP 服务器，用于扩展 AI 能力
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadProjectAndServers()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
            >
              <RefreshCwIcon className="h-4 w-4" />
              Sync
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <PlusIcon className="h-4 w-4" />
              Register MCP
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <SearchInput placeholder="搜索 MCP Servers..." value={search} onChange={setSearch} />
          <select
            value={transportFilter}
            onChange={(e) => setTransportFilter(e.target.value)}
            className="h-9 rounded-lg border-0 bg-muted px-3 text-sm shadow-none hover:bg-muted/80 focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none transition-all"
          >
            <option value="all">All Transports</option>
            <option value="stdio">Stdio</option>
            <option value="sse">SSE</option>
            <option value="streamable-http">HTTP</option>
          </select>
          <div className="ml-auto">
            <ViewModeToggle viewMode={viewMode} onViewModeChange={setViewMode} />
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex h-[320px] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-[320px] flex-col items-center justify-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <RssIcon className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-medium">
              {search || transportFilter !== 'all'
                ? '没有找到匹配的 MCP Servers'
                : '还没有注册 MCP Servers'}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {search ? '尝试其他搜索词或筛选条件' : '点击 Register MCP 添加新的 MCP 服务器'}
            </p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((mcp) => (
              <McpCard key={mcp.id} mcp={mcp} onDelete={handleDelete} />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((mcp) => (
              <McpListItem key={mcp.id} mcp={mcp} onDelete={handleDelete} />
            ))}
          </div>
        )}

        {/* Footer stats */}
        {!loading && filtered.length > 0 && (
          <div className="mt-6 text-center text-xs text-muted-foreground">
            共 {filtered.length} 个 MCP Servers
            {(search || transportFilter !== 'all') &&
              filtered.length !== servers.length &&
              ` (筛选自 ${servers.length} 个)`}
          </div>
        )}
      </div>
    </div>
  );
}
