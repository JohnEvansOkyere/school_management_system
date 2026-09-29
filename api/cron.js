// Vercel Cron entry: serverless has no always-on worker, so this drains the durable job queue and queued notice SMS.
// Vercel sends `Authorization: Bearer $CRON_SECRET`; anything else is refused.
const { timingSafeEqual } = require('node:crypto');
const authorised = header => {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16 || !header) return false;
  const a = Buffer.from(header), b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
};
module.exports = async (req, res) => {
  res.setHeader('content-type', 'application/json');
  if (!authorised(req.headers.authorization)) { res.statusCode = 401; return res.end(JSON.stringify({ message: 'Unauthorised' })); }
  const { JobWorker } = require('../backend/dist/jobs/worker');
  const { NoticeSender } = require('../backend/dist/jobs/notice-sender');
  const worker = new JobWorker(), notices = new NoticeSender();
  const deadline = Date.now() + 40_000;
  let cycles = 0;
  try {
    while (Date.now() < deadline && cycles < 30) { await worker.runOnce(); await notices.runOnce(); cycles++; }
    res.statusCode = 200; res.end(JSON.stringify({ status: 'ok', cycles }));
  } catch { console.error('Cron cycle failed'); res.statusCode = 500; res.end(JSON.stringify({ status: 'failed' })); }
  finally { await Promise.allSettled([worker.close(), notices.close()]); }
};
