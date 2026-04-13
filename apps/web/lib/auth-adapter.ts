/**
 * Custom NextAuth adapter for the existing Drizzle schema.
 *
 * The built-in @auth/drizzle-adapter expects column names like `emailVerified`
 * and `expires`, but our schema uses `emailVerifiedAt` and `expiresAt`.
 * This adapter bridges the gap without touching the DB schema.
 */

import type { DbClient } from '@lux/db';
import { accounts, sessions, users, verificationTokens } from '@lux/db';
import { and, eq } from 'drizzle-orm';
import type { Adapter, AdapterSession, AdapterUser } from 'next-auth/adapters';

export function DrizzleAdapter(db: DbClient): Adapter {
  return {
    async createUser(data) {
      const [row] = await db
        .insert(users)
        .values({
          name: data.name ?? null,
          email: data.email,
          emailVerifiedAt: data.emailVerified ?? null,
          image: data.image ?? null,
        })
        .returning();
      return toAdapterUser(row);
    },

    async getUser(id) {
      const row = await db.query.users.findFirst({
        where: eq(users.id, id),
      });
      return row ? toAdapterUser(row) : null;
    },

    async getUserByEmail(email) {
      const row = await db.query.users.findFirst({
        where: eq(users.email, email),
      });
      return row ? toAdapterUser(row) : null;
    },

    async getUserByAccount({ provider, providerAccountId }) {
      const result = await db.query.accounts.findFirst({
        where: and(
          eq(accounts.provider, provider),
          eq(accounts.providerAccountId, providerAccountId)
        ),
      });
      if (!result) return null;

      const user = await db.query.users.findFirst({
        where: eq(users.id, result.userId),
      });
      return user ? toAdapterUser(user) : null;
    },

    async updateUser(data) {
      const [row] = await db
        .update(users)
        .set({
          name: data.name ?? undefined,
          email: data.email ?? undefined,
          emailVerifiedAt: data.emailVerified ?? undefined,
          image: data.image ?? undefined,
          updatedAt: new Date(),
        })
        .where(eq(users.id, data.id))
        .returning();
      return toAdapterUser(row);
    },

    async deleteUser(userId) {
      await db.delete(users).where(eq(users.id, userId));
    },

    async linkAccount(data) {
      await db.insert(accounts).values({
        userId: data.userId,
        type: data.type,
        provider: data.provider,
        providerAccountId: data.providerAccountId,
        refreshToken: (data.refresh_token as string) ?? null,
        accessToken: (data.access_token as string) ?? null,
        expiresAt: (data.expires_at as number) ?? null,
        tokenType: (data.token_type as string) ?? null,
        scope: (data.scope as string) ?? null,
        idToken: (data.id_token as string) ?? null,
        sessionState: (data.session_state as string) ?? null,
      });
    },

    async unlinkAccount({ provider, providerAccountId }) {
      await db
        .delete(accounts)
        .where(
          and(eq(accounts.provider, provider), eq(accounts.providerAccountId, providerAccountId))
        );
    },

    async createSession(data) {
      const [row] = await db
        .insert(sessions)
        .values({
          sessionToken: data.sessionToken,
          userId: data.userId,
          expiresAt: data.expires,
        })
        .returning();
      return toAdapterSession(row);
    },

    async getSessionAndUser(sessionToken) {
      const session = await db.query.sessions.findFirst({
        where: eq(sessions.sessionToken, sessionToken),
      });
      if (!session) return null;

      const user = await db.query.users.findFirst({
        where: eq(users.id, session.userId),
      });
      if (!user) return null;

      return {
        session: toAdapterSession(session),
        user: toAdapterUser(user),
      };
    },

    async updateSession(data) {
      const [row] = await db
        .update(sessions)
        .set({
          ...(data.expires ? { expiresAt: data.expires } : {}),
          ...(data.userId ? { userId: data.userId } : {}),
        })
        .where(eq(sessions.sessionToken, data.sessionToken))
        .returning();
      return row ? toAdapterSession(row) : null;
    },

    async deleteSession(sessionToken) {
      await db.delete(sessions).where(eq(sessions.sessionToken, sessionToken));
    },

    async createVerificationToken(data) {
      const [row] = await db
        .insert(verificationTokens)
        .values({
          identifier: data.identifier,
          token: data.token,
          expiresAt: data.expires,
        })
        .returning();
      return {
        identifier: row.identifier,
        token: row.token,
        expires: row.expiresAt,
      };
    },

    async useVerificationToken({ identifier, token }) {
      const row = await db.query.verificationTokens.findFirst({
        where: and(
          eq(verificationTokens.identifier, identifier),
          eq(verificationTokens.token, token)
        ),
      });
      if (!row) return null;

      await db
        .delete(verificationTokens)
        .where(
          and(eq(verificationTokens.identifier, identifier), eq(verificationTokens.token, token))
        );

      return {
        identifier: row.identifier,
        token: row.token,
        expires: row.expiresAt,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Row -> AdapterUser / AdapterSession mappers
// ---------------------------------------------------------------------------

type UserRow = typeof users.$inferSelect;
type SessionRow = typeof sessions.$inferSelect;

function toAdapterUser(row: UserRow): AdapterUser {
  return {
    id: row.id,
    name: row.name ?? null,
    email: row.email ?? '',
    emailVerified: row.emailVerifiedAt ?? null,
    image: row.image ?? null,
  };
}

function toAdapterSession(row: SessionRow): AdapterSession {
  return {
    sessionToken: row.sessionToken,
    userId: row.userId,
    expires: row.expiresAt,
  };
}
