// SMS provider seam. Any configured provider can send; when one fails the next is tried ("whichever is available").
// Real sends are OFF unless SMS_SEND_ENABLED=true. Without it, every message is recorded as "suppressed" and nothing leaves the system.
//
// IMPORTANT: the Arkesel and Moolre adapters below follow each provider's published HTTP API from memory and have NOT been
// exercised against a sandbox account. Verify endpoint, authentication header, sender ID rules and response shape with the
// provider's current documentation and a test number before enabling real sends.

export interface SmsResult { provider: string; providerMessageId: string | null }
export interface SmsProvider { readonly name: string; send(to: string, text: string, reference: string): Promise<SmsResult> }

const timeout = () => AbortSignal.timeout(15_000);

export class ArkeselProvider implements SmsProvider {
  readonly name = 'arkesel';
  constructor(private readonly apiKey: string, private readonly sender: string, private readonly baseUrl = 'https://sms.arkesel.com') {}
  async send(to: string, text: string, reference: string): Promise<SmsResult> {
    const response = await fetch(`${this.baseUrl}/api/v2/sms/send`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'api-key': this.apiKey },
      body: JSON.stringify({ sender: this.sender, message: text, recipients: [to.replace(/^\+/, '')], reference }), signal: timeout(),
    });
    const data = await response.json().catch(() => null) as { status?: string; data?: { id?: string }[] } | null;
    if (!response.ok || (data?.status && data.status !== 'success')) throw new Error(`arkesel rejected the message (${response.status})`);
    return { provider: this.name, providerMessageId: data?.data?.[0]?.id ?? null };
  }
}

export class MoolreProvider implements SmsProvider {
  readonly name = 'moolre';
  constructor(private readonly apiKey: string, private readonly sender: string, private readonly baseUrl = 'https://api.moolre.com') {}
  async send(to: string, text: string, reference: string): Promise<SmsResult> {
    const response = await fetch(`${this.baseUrl}/open/sms/send`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'X-API-VASKEY': this.apiKey },
      body: JSON.stringify({ type: 1, senderid: this.sender, messages: [{ recipient: to.replace(/^\+/, ''), message: text, ref: reference }] }), signal: timeout(),
    });
    const data = await response.json().catch(() => null) as { status?: number | string; data?: { id?: string } } | null;
    if (!response.ok || (data?.status !== undefined && String(data.status) !== '1')) throw new Error(`moolre rejected the message (${response.status})`);
    return { provider: this.name, providerMessageId: data?.data?.id ?? null };
  }
}

// Sends through the first provider that succeeds; throws only when every configured provider failed.
export class FallbackSms implements SmsProvider {
  readonly name = 'fallback';
  constructor(private readonly providers: SmsProvider[]) {}
  async send(to: string, text: string, reference: string): Promise<SmsResult> {
    const failures: string[] = [];
    for (const provider of this.providers) {
      try { return await provider.send(to, text, reference); }
      catch (error) { failures.push(`${provider.name}: ${(error as Error).message}`); }
    }
    throw new Error(failures.length ? failures.join('; ') : 'No SMS provider is configured');
  }
}

// SMS_PROVIDERS is an ordered list, e.g. "arkesel,moolre". Keys: ARKESEL_API_KEY, MOOLRE_API_KEY; sender: SMS_SENDER_ID.
export function configuredSms(env: NodeJS.ProcessEnv = process.env): SmsProvider | null {
  if (env.SMS_SEND_ENABLED !== 'true') return null;
  const sender = env.SMS_SENDER_ID ?? '';
  const providers: SmsProvider[] = [];
  for (const name of (env.SMS_PROVIDERS ?? '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean)) {
    if (name === 'arkesel' && env.ARKESEL_API_KEY && sender) providers.push(new ArkeselProvider(env.ARKESEL_API_KEY, sender));
    if (name === 'moolre' && env.MOOLRE_API_KEY && sender) providers.push(new MoolreProvider(env.MOOLRE_API_KEY, sender));
  }
  return providers.length ? new FallbackSms(providers) : null;
}

// Ghana mobile numbers only, stored as +233XXXXXXXXX. Accepts 0XXXXXXXXX and 233XXXXXXXXX forms.
export function normalizeGhanaPhone(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, '');
  const match = /^(?:\+?233|0)(\d{9})$/.exec(digits);
  return match ? `+233${match[1]}` : null;
}
