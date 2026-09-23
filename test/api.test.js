const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arcilaza-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.CORREOS_DIR = path.join(tmp, 'correos');
process.env.SMTP_HOST = '';
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASSWORD = 'clave-de-prueba';

const app = require('../server');
let server, base, cookie = '';

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

async function pedir(url, init = {}) {
  const headers = { ...(init.headers || {}), cookie };
  let body = init.body;
  if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
  const resp = await fetch(base + url, { ...init, headers, body });
  const sc = resp.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return { status: resp.status, json: await resp.json().catch(() => null), resp };
}

function formularioProveedor() {
  const fd = new FormData();
  const datos = {
    categoria: 'proveedor', tipo_persona: 'Jurídica', tipo_documento: 'NIT', numero_documento: '900123456', dv: '7',
    nombre: 'Suministros Ñandú S.A.S.', direccion: 'Cra 1 # 2-3', pais: 'Colombia', departamento: 'Antioquia', ciudad: 'Medellín',
    celular: '3001234567', email: 'contacto@nandu.co', rep_nombre: 'Ana Pérez', rep_tipo_documento: 'Cédula de ciudadanía',
    rep_numero_documento: '1020304050', actividad_economica: 'Comercio', codigo_ciiu: '4659', regimen: 'Responsable de IVA',
    gran_contribuyente: 'No', autorretenedor: 'No', contacto_nombre: 'Luis', contacto_email: 'luis@nandu.co', contacto_telefono: '3000000000',
    bienes_servicios: 'Papelería', banco: 'Bancolombia', tipo_cuenta: 'Ahorros', numero_cuenta: '123', titular_cuenta: 'Suministros Ñandú',
    pep: 'No', origen_fondos: 'Actividad comercial', acepta_tratamiento: 'on', acepta_veracidad: 'on',
  };
  for (const [k, v] of Object.entries(datos)) fd.append(k, v);
  const pdf = new Blob(['%PDF-1.4 prueba'], { type: 'application/pdf' });
  for (const a of ['rut', 'camara_comercio', 'documento_identidad', 'certificacion_bancaria']) fd.append(a, pdf, `${a}.pdf`);
  return fd;
}

test('el formulario público rechaza registros incompletos', async () => {
  const fd = new FormData();
  fd.append('categoria', 'proveedor');
  const r = await pedir('/api/public/registro', { method: 'POST', body: fd });
  assert.equal(r.status, 400);
  assert.ok(r.json.errores.length > 5);
});

test('el formulario público no permite registrar empleados', async () => {
  const fd = new FormData();
  fd.append('categoria', 'empleado');
  const r = await pedir('/api/public/registro', { method: 'POST', body: fd });
  assert.equal(r.status, 400);
});

test('flujo completo: registro, consecutivo, carpeta, validación y envío', async () => {
  const r1 = await pedir('/api/public/registro', { method: 'POST', body: formularioProveedor() });
  assert.equal(r1.status, 200, JSON.stringify(r1.json));
  assert.equal(r1.json.consecutivo, 'PRO-00001');
  const r2 = await pedir('/api/public/registro', { method: 'POST', body: formularioProveedor() });
  assert.equal(r2.json.consecutivo, 'PRO-00002');

  const carpeta = path.join(process.env.UPLOADS_DIR, 'proveedores', 'PRO-00001');
  assert.equal(fs.readdirSync(carpeta).length, 4);

  assert.equal((await pedir('/api/terceros')).status, 401);
  const login = await pedir('/api/auth/login', { method: 'POST', body: { usuario: 'admin', password: 'clave-de-prueba' } });
  assert.equal(login.status, 200);

  const lista = await pedir('/api/terceros?categoria=proveedor');
  assert.equal(lista.json.terceros.length, 2);
  const id = lista.json.terceros.find((t) => t.consecutivo === 'PRO-00001').id;

  const sinValidar = await pedir(`/api/terceros/${id}/enviar`, { method: 'POST', body: { destinatarios: 'a@b.co' } });
  assert.equal(sinValidar.status, 400);

  const val = await pedir(`/api/terceros/${id}/estado`, { method: 'POST', body: { estado: 'validado', observaciones: 'OK' } });
  assert.equal(val.json.tercero.estado, 'validado');
  assert.equal(val.json.tercero.validado_por, 'Administrador');

  const env = await pedir(`/api/terceros/${id}/enviar`, { method: 'POST', body: { destinatarios: 'tesoreria@arcilaza.com' } });
  assert.equal(env.status, 200, JSON.stringify(env.json));
  assert.equal(env.json.estado, 'simulado');
  assert.equal(env.json.tercero.estado, 'enviado');
  const eml = fs.readdirSync(process.env.CORREOS_DIR);
  assert.equal(eml.length, 1);
  const contenido = fs.readFileSync(path.join(process.env.CORREOS_DIR, eml[0]), 'utf8');
  assert.match(contenido, /tesoreria@arcilaza\.com/);
  assert.match(contenido, /filename=.*rut_rut\.pdf/);
});

test('registro manual de empleado desde el aplicativo', async () => {
  const fd = new FormData();
  const datos = {
    categoria: 'empleado', tipo_persona: 'Natural', tipo_documento: 'Cédula de ciudadanía', numero_documento: '1010101010',
    nombre: 'María Gómez', direccion: 'Calle 10', pais: 'Colombia', departamento: 'Cundinamarca', ciudad: 'Bogotá',
    celular: '3100000000', email: 'maria@arcilaza.com', cargo: 'Auxiliar contable', area: 'Contabilidad',
    fecha_ingreso: '2026-09-01', tipo_contrato: 'Término indefinido', salario: '2500000', eps: 'Sura', afp: 'Porvenir',
    banco: 'Davivienda', tipo_cuenta: 'Ahorros', numero_cuenta: '999', titular_cuenta: 'María Gómez',
  };
  for (const [k, v] of Object.entries(datos)) fd.append(k, v);
  const r = await pedir('/api/terceros', { method: 'POST', body: fd });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.tercero.consecutivo, 'EMP-00001');
  assert.equal(r.json.tercero.origen, 'manual');

  const csv = await fetch(`${base}/api/terceros/exportar.csv?categoria=empleado`, { headers: { cookie } });
  const texto = await csv.text();
  assert.match(texto, /EMP-00001/);
  assert.match(texto, /María Gómez/);
});
