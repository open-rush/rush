'use client';

import { Loader2, PlusIcon, PuzzleIcon, RefreshCwIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { SearchInput } from '@/components/shared/search-input';
import { type ViewMode, ViewModeToggle } from '@/components/shared/view-mode-toggle';
import { SkillCard, type SkillItem } from '@/components/skills/skill-card';
import { SkillListItem } from '@/components/skills/skill-list-item';

export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [projectId, setProjectId] = useState<string | null>(null);

  const loadProjectAndSkills = useCallback(async () => {
    setLoading(true);
    try {
      const projRes = await fetch('/api/projects/default');
      const projJson = await projRes.json();
      const pid = projJson.data?.id;
      if (!pid) return;
      setProjectId(pid);

      const res = await fetch(`/api/projects/${pid}/skills`);
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setSkills(json.data);
      }
    } catch {
      // Silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjectAndSkills();
  }, [loadProjectAndSkills]);

  const handleToggle = useCallback(
    async (skill: SkillItem) => {
      if (!projectId) return;
      try {
        await fetch(`/api/projects/${projectId}/skills`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            skillRef: skill.source,
            options: { enabled: !skill.enabled },
          }),
        });
        setSkills((prev) =>
          prev.map((s) => (s.name === skill.name ? { ...s, enabled: !s.enabled } : s)),
        );
      } catch {
        // Silent
      }
    },
    [projectId],
  );

  const filtered = skills.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.source.toLowerCase().includes(q) ||
      (s.description?.toLowerCase().includes(q) ?? false)
    );
  });

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1400px] px-8 py-8">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Skills</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              浏览和管理 Skills，用于增强 Agent 能力
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadProjectAndSkills()}
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
              Add Skill
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <SearchInput placeholder="搜索 Skills..." value={search} onChange={setSearch} />
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
              <PuzzleIcon className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-medium">
              {search ? '没有找到匹配的 Skills' : '还没有安装 Skills'}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {search ? '尝试其他搜索词' : '使用 reskill install 或点击 Add Skill 安装'}
            </p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((skill) => (
              <SkillCard key={skill.name} skill={skill} onToggle={handleToggle} />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((skill) => (
              <SkillListItem key={skill.name} skill={skill} onToggle={handleToggle} />
            ))}
          </div>
        )}

        {/* Footer stats */}
        {!loading && filtered.length > 0 && (
          <div className="mt-6 text-center text-xs text-muted-foreground">
            共 {filtered.length} 个 Skills
            {search && filtered.length !== skills.length && ` (筛选自 ${skills.length} 个)`}
          </div>
        )}
      </div>
    </div>
  );
}
