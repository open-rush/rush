'use client';

import { Layers, LogOut, MessageSquare, Plus, Rss, Settings, Wrench } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface SidebarUser {
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

interface ConversationItem {
  id: string;
  title: string | null;
  projectId: string;
  updatedAt: string;
}

interface SidebarProps {
  user: SidebarUser;
  projects?: Array<{ id: string; name: string }>;
}

const navBuild = [
  { href: '/studio', icon: Layers, label: 'Agent Studio' },
  { href: '/skills', icon: Wrench, label: 'Skills' },
  { href: '/mcps', icon: Rss, label: 'MCP Servers' },
];

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const initials = (user.name ?? user.email ?? '?').slice(0, 2).toUpperCase();

  // ---------------------------------------------------------------------------
  // Load conversations (flat task list)
  // ---------------------------------------------------------------------------
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally re-fetch on route change
  useEffect(() => {
    fetch('/api/projects/default')
      .then((r) => r.json())
      .then((res) => {
        if (res.success && res.data?.id) {
          return fetch(`/api/conversations?projectId=${res.data.id}`);
        }
        return null;
      })
      .then((r) => r?.json())
      .then((res) => {
        if (res?.success) {
          setConversations(
            (res.data ?? []).map((c: Record<string, unknown>) => ({
              id: c.id as string,
              title: c.title as string | null,
              projectId: c.projectId as string,
              updatedAt: c.updatedAt as string,
            }))
          );
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [pathname]); // Re-fetch when route changes (e.g. new chat created)

  const activeConvId = pathname.startsWith('/chat/') ? pathname.split('/')[2] : undefined;

  const handleNewChat = useCallback(async () => {
    router.push('/');
  }, [router]);

  const handleConvClick = useCallback(
    (conv: ConversationItem) => {
      router.push(`/chat/${conv.id}?projectId=${conv.projectId}`);
    },
    [router]
  );

  return (
    <aside className="sidebar-wrap w-[256px] shrink-0 bg-card rounded-xl shadow-[0_0_0_1px_rgba(0,0,0,0.06)] flex flex-col p-3 gap-0.5 overflow-hidden max-md:hidden">
      {/* Brand — click to go home */}
      <Link
        href="/"
        className="flex items-center gap-2.5 px-2 py-2 mb-2 rounded-lg hover:bg-accent/50 transition-all"
      >
        <div className="size-7 bg-primary rounded-lg flex items-center justify-center text-primary-foreground text-xs font-bold">
          R
        </div>
        <span className="text-[15px] font-semibold tracking-tight">Lux</span>
        <span className="ml-auto text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
          v0.3
        </span>
      </Link>

      {/* New Chat */}
      <button
        type="button"
        onClick={handleNewChat}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border text-muted-foreground text-[13px] font-medium hover:border-foreground/20 hover:text-foreground hover:bg-accent/30 transition-all w-full mb-1 cursor-pointer"
      >
        <Plus className="size-4" />
        New Chat
      </button>

      {/* Conversation list (flat) */}
      <div className="flex-1 overflow-y-auto custom-scrollbar mt-1">
        {isLoading ? (
          <div className="px-3 py-4 text-[12px] text-muted-foreground text-center">Loading...</div>
        ) : conversations.length === 0 ? (
          <div className="px-3 py-4 text-[12px] text-muted-foreground text-center">
            No conversations yet
          </div>
        ) : (
          <div className="space-y-0.5">
            {conversations.map((conv) => (
              <button
                key={conv.id}
                type="button"
                onClick={() => handleConvClick(conv)}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-[7px] rounded-lg text-[13px] transition-all w-full text-left cursor-pointer',
                  activeConvId === conv.id
                    ? 'bg-accent font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                )}
              >
                <MessageSquare className="size-4 shrink-0" />
                <span className="truncate">{conv.title || 'New Chat'}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Build nav — bottom */}
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-3 pt-3 pb-1">
        Build
      </div>
      {navBuild.map((item) => {
        const isActive = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-2.5 px-3 py-[7px] rounded-lg text-[13px] transition-all',
              isActive
                ? 'bg-accent font-medium text-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
            )}
          >
            <item.icon className="size-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}

      {/* Separator + User */}
      <div className="h-px bg-border mx-1 my-1" />
      <div className="flex items-center gap-2.5 px-2 py-1.5">
        <div className="size-7 rounded-full bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center text-[11px] font-semibold text-white shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium truncate">{user.name ?? 'User'}</div>
          <div className="text-[11px] text-muted-foreground">Admin</div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="size-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent/50 transition cursor-pointer"
          >
            <Settings className="size-4" />
          </button>
          <form action="/api/auth/signout" method="POST">
            <button
              type="submit"
              className="size-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent/50 transition cursor-pointer"
              aria-label="Sign out"
            >
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
