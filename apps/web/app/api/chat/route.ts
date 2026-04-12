import { streamText } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';

export async function POST(req: Request) {
  const { messages } = await req.json();

  const modelId = process.env.ANTHROPIC_MODEL || 'sonnet';

  const result = streamText({
    model: claudeCode(modelId, {
      permissionMode: 'bypassPermissions',
      maxTurns: 10,
    }),
    messages,
  });

  return result.toTextStreamResponse();
}
