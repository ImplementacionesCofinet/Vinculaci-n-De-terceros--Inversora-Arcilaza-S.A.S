const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const raiz = path.join(__dirname, '..');
const env = process.env;
const port = Number(env.PORT) || 3000;

module.exports = {
  port,
  baseUrl: (env.BASE_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  sessionSecret: env.SESSION_SECRET || 'cambie-este-secreto',
  dbPath: path.resolve(raiz, env.DB_PATH || 'data/vinculacion.db'),
  // Raíz del archivo de expedientes. Dentro: PROVEEDORES/2026/PRO-2026-0042 NOMBRE/, EMPLEADOS/…
  archivoDir: path.resolve(raiz, env.ARCHIVO_DIR || 'archivo/SOPORTES CREACION TERCEROS'),
  correosDir: path.resolve(raiz, env.CORREOS_DIR || 'data/correos'),
  formularioWord: path.resolve(raiz, env.FORMULARIO_WORD || 'documentos/FOR-DCF-001.docx'),
  mesesActualizacion: Number(env.MESES_ACTUALIZACION) || 12,
  adminUser: (env.ADMIN_USER || 'admin').toLowerCase(),
  adminNombre: env.ADMIN_NOMBRE || 'Administrador',
  adminPassword: env.ADMIN_PASSWORD || 'Arcilaza2026*',
  empresa: {
    nombre: 'Inversora Arcilaza S.A.S.',
    direccion: env.EMPRESA_DIRECCION || 'Finca La Pradera, Vereda El Caimo, Armenia (Quindío)',
    correo: env.EMPRESA_CORREO || 'facturacionelectronica@cofinet.com.au',
  },
  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT) || 587,
    secure: env.SMTP_SECURE === 'true',
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || 'Vinculación de terceros <vinculacion@cofinet.com.au>',
  },
  oficial: {
    nombre: env.OFICIAL_CUMPLIMIENTO_NOMBRE || 'Oficial de Cumplimiento',
    email: env.OFICIAL_CUMPLIMIENTO_EMAIL || '',
    cc: env.OFICIAL_CUMPLIMIENTO_CC || '',
  },
  sharepoint: {
    tenantId: env.SHAREPOINT_TENANT_ID || '',
    clientId: env.SHAREPOINT_CLIENT_ID || '',
    clientSecret: env.SHAREPOINT_CLIENT_SECRET || '',
    driveId: env.SHAREPOINT_DRIVE_ID || '',
    carpetaRaiz: env.SHAREPOINT_CARPETA_RAIZ || 'SOPORTES CREACION TERCEROS',
  },
};
