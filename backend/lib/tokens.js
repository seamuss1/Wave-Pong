const crypto = require('crypto');

function base64urlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64urlDecode(value) {
  const normalized = String(value || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, 'base64').toString('utf8');
}

function signPayload(payload, secret) {
  const body = base64urlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `${body}.${signature}`;
}

function verifySignedPayload(token, secret) {
  const [body, signature] = String(token || '').split('.');
  if (!body || !signature) {
    throw new Error('Malformed signed token.');
  }
  const expected = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  if (expected !== signature) {
    throw new Error('Signed token verification failed.');
  }
  const payload = JSON.parse(base64urlDecode(body));
  if (payload.exp && Date.now() >= payload.exp) {
    throw new Error('Signed token expired.');
  }
  return payload;
}

function issueScopedToken(secret, payload, ttlSeconds) {
  const now = Date.now();
  return signPayload(
    {
      ...payload,
      iat: now,
      exp: now + Math.max(1, ttlSeconds) * 1000
    },
    secret
  );
}

module.exports = {
  issueScopedToken,
  verifySignedPayload
};
