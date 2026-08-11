var LOCAL_AUTH_PASSWORD = 'admin';
var LOCAL_JWT_SECRET = 'local-development-jwt-secret-not-for-production';

function isBlank(value) {
  return typeof value != 'string' || value.trim() == '';
}

function isPlaceholder(value, placeholders) {
  return placeholders.indexOf(String(value || '').trim().toLowerCase()) >= 0;
}

function loadAuthConfig(env) {
  env = env || {};

  if (env.SBI_LOCAL_ONLY === 'true') {
    return {
      localOnly: true,
      host: '127.0.0.1',
      password: isBlank(env.SBI_AUTH_PASSWORD) ? LOCAL_AUTH_PASSWORD : env.SBI_AUTH_PASSWORD,
      jwtSecret: isBlank(env.SBI_JWT_SECRET) ? LOCAL_JWT_SECRET : env.SBI_JWT_SECRET
    };
  }

  if (isBlank(env.SBI_AUTH_PASSWORD)) {
    throw new Error('Authentication configuration error: SBI_AUTH_PASSWORD is required.');
  }

  if (env.SBI_AUTH_PASSWORD.length < 12 || isPlaceholder(env.SBI_AUTH_PASSWORD, [
    'admin',
    'password',
    'change-this-password'
  ])) {
    throw new Error('Authentication configuration error: SBI_AUTH_PASSWORD is insecure; use at least 12 non-placeholder characters.');
  }

  if (isBlank(env.SBI_JWT_SECRET)) {
    throw new Error('Authentication configuration error: SBI_JWT_SECRET is required.');
  }

  if (env.SBI_JWT_SECRET.length < 32 || isPlaceholder(env.SBI_JWT_SECRET, [
    'secret',
    'change-this-long-random-secret'
  ])) {
    throw new Error('Authentication configuration error: SBI_JWT_SECRET is insecure; use at least 32 non-placeholder characters.');
  }

  if (env.SBI_JWT_SECRET === env.SBI_AUTH_PASSWORD) {
    throw new Error('Authentication configuration error: SBI_JWT_SECRET must differ from SBI_AUTH_PASSWORD.');
  }

  return {
    localOnly: false,
    host: env.HOST || '0.0.0.0',
    password: env.SBI_AUTH_PASSWORD,
    jwtSecret: env.SBI_JWT_SECRET
  };
}

module.exports = {
  loadAuthConfig: loadAuthConfig
};
