'use client';

import { Activity, Layers, LogOut, MessageSquare, Rss, Wrench } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Sidebar } from './sidebar';

interface AppShellUser {
  id?: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

interface ProjectItem {
  id: string;
  name: string;
}

interface AppShellProps {
  user: AppShellUser;
  projects?: ProjectItem[];
  children: React.ReactNode;
}

const mobileNavItems = [
  { href: '/', label: 'Chat', icon: MessageSquare },
  { href: '/studio', label: 'Studio', icon: Layers },
  { href: '/skills', label: 'Skills', icon: Wrench },
  { href: '/mcps', label: 'MCPs', icon: Rss },
  { href: '/runs', label: 'Runs', icon: Activity },
];

export function AppShell({ user, projects = [], children }: AppShellProps) {
  const pathname = usePathname();
  const initials = (user.name ?? user.email ?? '?').slice(0, 2).toUpperCase();

  return (
    <div className="flex h-screen p-2 gap-2 bg-muted max-md:flex-col max-md:p-0">
      <div className="hidden max-md:flex items-center justify-between px-4 py-3 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="size-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
            R
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">Lux</div>
            <div className="text-[11px] text-muted-foreground truncate">{user.name ?? 'User'}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="size-8 rounded-full bg-gradient-to-br from-blue-500 to-violet-500 text-white flex items-center justify-center text-[11px] font-semibold">
            {initials}
          </div>
          <form action="/api/auth/signout" method="POST">
            <button
              type="submit"
              className="size-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-accent/50 transition cursor-pointer"
              aria-label="Sign out"
            >
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
      </div>
      <Sidebar user={user} projects={projects} />
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-card rounded-xl shadow-[0_0_0_1px_rgba(0,0,0,0.06)] max-md:rounded-none max-md:shadow-none">
        {children}
      </main>
      <nav className="hidden max-md:grid grid-cols-5 gap-1 border-t border-border bg-card px-2 py-2 shrink-0">
        {mobileNavItems.map((item) => {
          const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[11px] transition',
                isActive
                  ? 'bg-accent text-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              )}
            >
              <item.icon className="size-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
