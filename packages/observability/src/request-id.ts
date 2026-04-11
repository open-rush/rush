import { randomBytes } from 'node:crypto';

export const REQUEST_ID_HEADER = 'x-request-id';

const REQUEST_ID_MAX_LENGTH = 128;
const REQUEST_ID_PATTERN = /^[\w.:-]+$/;

export function generateRequestId(): string {
  const ts = Date.now();
  const rand = randomBytes(6).toString('hex');
  return `req-${ts}-${rand}`;
}

export function validateRequestId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > REQUEST_ID_MAX_LENGTH) return null;
  if (!REQUEST_ID_PATTERN.test(value)) return null;
  return value;
}

export function extractOrGenerateRequestId(headerValue: string | null | undefined): string {
  return validateRequestId(headerValue) ?? generateRequestId();
}
