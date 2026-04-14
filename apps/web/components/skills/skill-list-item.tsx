'use client';

import { ChevronRightIcon, LockIcon, PuzzleIcon, ToggleLeftIcon, ToggleRightIcon } from 'lucide-react';
import type { SkillItem } from './skill-card';

interface SkillListItemProps {
  skill: SkillItem;
  onToggle?: (skill: SkillItem) => void;
  onClick?: (skill: SkillItem) => void;
}

export function SkillListItem({ skill, onToggle, onClick }: SkillListItemProps) {
  const isPrivate = skill.visibility === 'private';

  return (
    <div
      className="flex items-center gap-4 rounded-lg border border-border bg-background px-4 py-3 transition-colors hover:bg-accent/30 cursor-pointer"
      onClick={() => onClick?.(skill)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onClick?.(skill);
      }}
      role="button"
      tabIndex={0}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 dark:bg-violet-950">
        {isPrivate ? (
          <LockIcon className="h-4 w-4 text-amber-500" />
        ) : (
          <PuzzleIcon className="h-4 w-4 text-violet-500" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{skill.name}</span>
          <span className="inline-flex items-center rounded-md bg-secondary px-1.5 py-0 text-[10px]">
            {skill.visibility}
          </span>
          {skill.version && (
            <span className="text-[10px] text-muted-foreground">{skill.version}</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {skill.description || skill.source}
        </p>
      </div>

      {skill.tags && skill.tags.length > 0 && (
        <div className="hidden md:flex items-center gap-1.5 shrink-0">
          {skill.tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-[10px]"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {onToggle && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(skill);
          }}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          {skill.enabled ? (
            <ToggleRightIcon className="h-4 w-4 text-green-500" />
          ) : (
            <ToggleLeftIcon className="h-4 w-4" />
          )}
        </button>
      )}

      <ChevronRightIcon className="h-4 w-4 text-muted-foreground shrink-0" />
    </div>
  );
}
