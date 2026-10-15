// Production receives traffic through cloudflared on loopback. Trust only
// explicitly configured proxy addresses, never every incoming connection.
export function configureTrustedProxy(app, env = process.env) {
  const value = (env.TRUST_PROXY || 'loopback').trim();
  app.set('trust proxy', value === 'false' ? false : value);
}
