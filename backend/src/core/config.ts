type Env = Record<string, string | undefined>;

const localHost = /^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/;

function list(value: string | undefined) {
  return (value ?? '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
}

function stripPort(host: string) {
  return host.replace(/:\d+$/, '');
}

export function serverConfig(env: Env = process.env) {
  const port = env.PORT === undefined || env.PORT === '' ? 3018 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be a whole number between 0 and 65535');
  const proxies = env.TRUST_PROXY === undefined || env.TRUST_PROXY === '' ? 0 : Number(env.TRUST_PROXY);
  if (!Number.isInteger(proxies) || proxies < 0 || proxies > 10) throw new Error('TRUST_PROXY must be the number of trusted proxy hops (0 to 10)');
  const hosts = list(env.ALLOWED_HOSTS).map(stripPort);
  const origins = list(env.ALLOWED_ORIGINS).map(origin => origin.replace(/\/$/, ''));
  // On Vercel the deployment's own host names are trusted automatically (scope production secrets to the Production environment).
  if (env.VERCEL) for (const own of list([env.VERCEL_PROJECT_PRODUCTION_URL, env.VERCEL_URL, env.VERCEL_BRANCH_URL].filter(Boolean).join(','))) { hosts.push(stripPort(own)); origins.push(`https://${own}`); }
  for (const origin of origins) if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(origin)) throw new Error('ALLOWED_ORIGINS entries must be https origins such as https://app.example.com');
  return {
    port,
    host: env.HOST || '127.0.0.1',
    trustProxy: proxies,
    hostAllowed: (header: string | undefined) => localHost.test(header ?? '') || hosts.includes(stripPort((header ?? '').toLowerCase())),
    originAllowed: (origin: string, header: string | undefined) => origins.includes(origin.toLowerCase()) || (localHost.test(header ?? '') && origin === `http://${header}`),
  };
}
