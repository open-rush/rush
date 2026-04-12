import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AppShell } from '@/components/layout/app-shell';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const user = {
    name: session.user.name,
    email: session.user.email,
    image: session.user.image,
  };

  return <AppShell user={user}>{children}</AppShell>;
}
