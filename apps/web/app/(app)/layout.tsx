import { DrizzleProjectDb, ProjectService } from '@lux/control-plane';
import { getDbClient } from '@lux/db';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AppShell } from '@/components/layout/app-shell';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const user = {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    image: session.user.image,
  };

  const db = getDbClient();
  const projectService = new ProjectService(new DrizzleProjectDb(db));
  const projects = session.user.id ? await projectService.listByUser(session.user.id) : [];

  return (
    <AppShell user={user} projects={projects.map((p) => ({ id: p.id, name: p.name }))}>
      {children}
    </AppShell>
  );
}
