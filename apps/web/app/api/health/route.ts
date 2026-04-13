function isTruthy(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}

function getProviderBackend(): string {
  if (isTruthy(process.env.CLAUDE_CODE_USE_BEDROCK)) return 'bedrock';
  if (process.env.ANTHROPIC_BASE_URL) return 'custom';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return 'unknown';
}

export async function GET() {
  return Response.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'rush-web',
    provider: getProviderBackend(),
  });
}
