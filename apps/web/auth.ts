import { getDbClient, users } from '@lux/db';
import { eq } from 'drizzle-orm';
import type { Session } from 'next-auth';
import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import { devUserEmail, devUserName, isDevAuthBypassEnabled } from '@/lib/auth-bypass';
import { DrizzleAdapter } from './lib/auth-adapter';

const db = getDbClient();

const {
  handlers,
  signIn,
  signOut,
  auth: nextAuth,
} = NextAuth({
  adapter: DrizzleAdapter(db),
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
    }),
  ],
  session: { strategy: 'database' },
  pages: {
    signIn: '/login',
  },
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
});

async function getOrCreateDevUser() {
  const [existingUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, devUserEmail))
    .limit(1);
  if (existingUser) return existingUser;

  const [createdUser] = await db
    .insert(users)
    .values({
      email: devUserEmail,
      name: devUserName,
    })
    .onConflictDoNothing({ target: users.email })
    .returning();

  if (createdUser) return createdUser;

  const [retriedUser] = await db.select().from(users).where(eq(users.email, devUserEmail)).limit(1);
  if (!retriedUser) {
    throw new Error('Failed to create local development user');
  }

  return retriedUser;
}

async function getDevSession(): Promise<Session> {
  const user = await getOrCreateDevUser();

  return {
    user: {
      id: user.id,
      name: user.name ?? devUserName,
      email: user.email,
      image: user.image,
    },
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

export async function auth() {
  const session = await nextAuth();
  if (session?.user) return session;

  if (isDevAuthBypassEnabled) {
    return getDevSession();
  }

  return session;
}

export { handlers, isDevAuthBypassEnabled, signIn, signOut };
