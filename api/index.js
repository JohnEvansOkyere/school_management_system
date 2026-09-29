// Vercel Function entry: wraps the same Nest application the container image runs. The app is built once per instance and reused.
let ready;
function app() {
  ready ??= (async () => {
    const { createApp } = require('../backend/dist/main');
    const nest = await createApp();
    await nest.init();
    return nest.getHttpAdapter().getInstance();
  })().catch(error => { ready = undefined; throw error; });
  return ready;
}
module.exports = async (req, res) => {
  try { return (await app())(req, res); }
  catch (error) {
    console.error(error instanceof Error ? error.message : 'Startup failed');
    res.statusCode = 503; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ message: 'The service is starting or misconfigured. Try again shortly.' }));
  }
};
