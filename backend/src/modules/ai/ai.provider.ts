export interface AiPrompt { system: string; user: string; maxTokens: number }
export interface AiCompletion { text: string; inputTokens: number | null; outputTokens: number | null }
export interface AiProvider { readonly name: string; readonly model: string | null; complete(prompt: AiPrompt): Promise<AiCompletion> }

// Anthropic Messages API. Only used when AI_ENABLED=true, the school has switched AI on, and ANTHROPIC_API_KEY is set.
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  readonly model: string;
  constructor(private readonly apiKey: string, model = 'claude-haiku-4-5-20251001', private readonly timeoutMs = 20_000) { this.model = model; }
  async complete(prompt: AiPrompt): Promise<AiCompletion> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: this.model, max_tokens: prompt.maxTokens, system: prompt.system, messages: [{ role: 'user', content: prompt.user }] }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Provider returned ${response.status}`);
    const data = await response.json() as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
    const text = (data.content ?? []).filter(part => part.type === 'text').map(part => part.text ?? '').join('');
    return { text, inputTokens: data.usage?.input_tokens ?? null, outputTokens: data.usage?.output_tokens ?? null };
  }
}

export function configuredProvider(env: NodeJS.ProcessEnv = process.env): AiProvider | null {
  return env.ANTHROPIC_API_KEY ? new AnthropicProvider(env.ANTHROPIC_API_KEY, env.AI_MODEL || undefined) : null;
}
