const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const raiz = path.join(__dirname, '..');
const env = process.env;

module.exports = {
  port: Number(env.PORT) || 3000,
  baseUrl: env.BASE_URL || `http://localhost:${Number(env.PORT) || 3000}`,
  sessionSecret: env.SESSION_SECRET || 'cambie-este-secreto',
  dbPath: path.resolve(raiz, env.DB_PATH || 'data/terceros.db'),
  uploadsDir: path.resolve(raiz, env.UPLOADS_DIR || 'uploads'),
  correosDir: path.resolve(raiz, env.CORREOS_DIR || 'data/correos'),
  maxFileMb: Number(env.MAX_FILE_MB) || 10,
  adminUser: (env.ADMIN_USER || 'admin').toLowerCase(),
  adminPassword: env.ADMIN_PASSWORD || 'Arcilaza2026*',
  empresa: env.EMPRESA_NOMBRE || 'INVERSORA ARCILAZA S.A.S.',
  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT) || 587,
    secure: env.SMTP_SECURE === 'true',
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || 'Vinculación de terceros <no-reply@arcilaza.com>',
    defaultTo: env.MAIL_DEFAULT_TO || '',
  },
};
