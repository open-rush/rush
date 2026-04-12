'use client';

import { LogOut, Monitor, Moon, Plus, Sun } from 'lucide-react';
import { useTheme } from '@/components/theme-provider';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

interface SidebarUser {
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

interface SidebarProps {
  user: SidebarUser;
}

export function Sidebar({ user }: SidebarProps) {
  const { theme, setTheme } = useTheme();

  const cycleTheme = () => {
    const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
    setTheme(next);
  };

  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;

  return (
    <aside className="flex flex-col h-full w-[240px] bg-secondary rounded-xl p-3 gap-2">
      {/* Brand */}
      <div className="flex items-center gap-2 px-2 py-1">
        <span className="text-lg font-semibold tracking-tight">Rush</span>
      </div>

      {/* New Chat */}
      <Button variant="outline" className="w-full justify-start gap-2" size="sm">
        <Plus className="h-4 w-4" />
        New Chat
      </Button>

      <Separator />

      {/* Conversations placeholder */}
      <div className="flex-1 overflow-auto custom-scrollbar px-2">
        <p className="text-xs text-muted-foreground mt-2">No conversations yet.</p>
      </div>

      <Separator />

      {/* Bottom: user + theme + sign out */}
      <div className="flex items-center gap-2 px-1 py-1">
        <Avatar className="h-7 w-7" size="sm">
          {user.image && <AvatarImage src={user.image} />}
          <AvatarFallback>{(user.name ?? user.email ?? '?').slice(0, 2)}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{user.name ?? 'User'}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={cycleTheme}
          aria-label={`Switch theme (current: ${theme})`}
          className="h-7 w-7"
        >
          <ThemeIcon className="h-4 w-4" />
        </Button>
        <form action="/api/auth/signout" method="POST">
          <Button
            variant="ghost"
            size="icon"
            type="submit"
            aria-label="Sign out"
            className="h-7 w-7"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </aside>
  );
}
