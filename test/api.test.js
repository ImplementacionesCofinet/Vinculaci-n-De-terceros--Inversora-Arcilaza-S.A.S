const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arcilaza-'));
Object.assign(process.env, {
  DB_PATH: path.join(tmp, 'test.db'),
  ARCHIVO_DIR: path.join(tmp, 'SOPORTES CREACION TERCEROS'),
  CORREOS_DIR: path.join(tmp, 'correos'),
  SMTP_HOST: '',
  ADMIN_USER: 'admin',
  ADMIN_NOMBRE: 'Marcia Morales',
  ADMIN_PASSWORD: 'clave-de-prueba',
  OFICIAL_CUMPLIMIENTO_EMAIL: 'oficial@arcilaza.com',
  SHAREPOINT_TENANT_ID: '',
});

const app = require('../server');
const CAMPOS = require('../public/shared/campos');
const ANIO = new Date().getFullYear();
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
  return { status: resp.status, json: await resp.json().catch(() => null) };
}

const pdf = (texto = 'prueba') => new Blob([`%PDF-1.4\n${texto}\n%%EOF\n`], { type: 'application/pdf' });

function registroJuridica(cambios = {}) {
  const fd = new FormData();
  const datos = {
    categoria: 'proveedor', persona: 'juridica', nombre: 'CAFÉ DE LA SIERRA S.A.S.', tipo_documento: 'NIT', numero_documento: '901.447.238-1',
    pais: 'Colombia', ciudad: 'Pitalito, Huila', contacto: 'Marcela Ortiz', telefono: '+57 310 442 8817', email: 'mortiz@cafesierra.co',
    acepta_tratamiento: 'on', ...cambios,
  };
  for (const [k, v] of Object.entries(datos)) fd.append(k, v);
  for (const a of CAMPOS.anexosPara('proveedor', 'juridica')) {
    if (!a.req) continue;
    fd.append(a.name, pdf(a.name), `${a.name}.pdf`);
  }
  return fd;
}

test('revisa archivos vacíos, dañados y renombrados', () => {
  const b = (s) => Buffer.from(s);
  assert.equal(CAMPOS.revisarArchivo('a.pdf', 20, b('%PDF-1.4'), b('xx %%EOF')), null);
  assert.match(CAMPOS.revisarArchivo('a.pdf', 0, b(''), b('')), /vacío/);
  assert.match(CAMPOS.revisarArchivo('a.pdf', 20, b('%PDF-1.4'), b('truncado')), /dañado/);
  assert.match(CAMPOS.revisarArchivo('a.pdf', 20, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), b('IEND')), /renombrado/);
  assert.match(CAMPOS.revisarArchivo('a.exe', 20, b('MZ'), b('')), /Solo se permiten archivos PDF/);
  assert.match(CAMPOS.revisarArchivo('foto.png', 20, Buffer.from([0x89, 0x50, 0x4e, 0x47]), b('IEND')), /Solo se permiten archivos PDF/);
});

test('el portal exige los documentos obligatorios y rechaza archivos dañados', async () => {
  const fd = registroJuridica();
  fd.delete('rut');
  fd.append('rut', new Blob(['%PDF-1.4 cortado'], { type: 'application/pdf' }), 'rut2026.pdf');
  fd.delete('camara');
  const r = await pedir('/api/public/registro', { method: 'POST', body: fd });
  assert.equal(r.status, 400);
  assert.match(r.json.archivos.rut, /rut2026\.pdf: El archivo está incompleto o dañado\. Vuelva a descargarlo de la DIAN\./);
  assert.ok(r.json.errores.some((e) => e.includes('Certificado de existencia')));
});

test('el portal no permite registrar empleados', async () => {
  const r = await pedir('/api/public/registro', { method: 'POST', body: registroJuridica({ categoria: 'empleado' }) });
  assert.equal(r.status, 400);
});

let idProveedor;

test('radica el expediente con consecutivo anual, carpeta y nombres estándar', async () => {
  const r = await pedir('/api/public/registro', { method: 'POST', body: registroJuridica() });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.consecutivo, `PRO-${ANIO}-0001`);

  const carpeta = path.join(process.env.ARCHIVO_DIR, 'PROVEEDORES', String(ANIO), `PRO-${ANIO}-0001 CAFÉ DE LA SIERRA S.A.S`);
  const archivos = fs.readdirSync(carpeta).sort();
  assert.ok(archivos.includes(`PRO-${ANIO}-0001 - RUT.pdf`), archivos.join(', '));
  assert.ok(archivos.includes(`PRO-${ANIO}-0001 - FORMULARIO DE VINCULACION TERCEROS.pdf`));
  assert.equal(archivos.length, 9);

  const correos = fs.readdirSync(process.env.CORREOS_DIR);
  assert.ok(correos.some((c) => c.includes('radicado')));

  // El consecutivo es compartido entre tipos: el siguiente cliente es 0002
  const r2 = await pedir('/api/public/registro', { method: 'POST', body: registroJuridica({ categoria: 'cliente', nombre: 'TRILLADORA DEL EJE LTDA.' }) });
  assert.equal(r2.json.consecutivo, `CLI-${ANIO}-0002`);
});

test('bandeja: requiere sesión, abre revisión, devuelve y el tercero corrige', async () => {
  assert.equal((await pedir('/api/terceros')).status, 401);
  assert.equal((await pedir('/api/auth/login', { method: 'POST', body: { usuario: 'admin', password: 'clave-de-prueba' } })).status, 200);

  const lista = await pedir('/api/terceros?estado=pendientes');
  assert.equal(lista.json.terceros.length, 2);
  const p = lista.json.terceros.find((t) => t.categoria === 'proveedor');
  assert.equal(p.anexos_tipos, 9);
  assert.equal(p.anexos_total, 10);
  idProveedor = p.id;

  const det = await pedir(`/api/terceros/${idProveedor}`);
  assert.equal(det.json.tercero.estado, 'en_revision');
  assert.match(det.json.tercero.historial.at(-1).texto, /Marcia Morales abrió la revisión/);

  const sinObs = await pedir(`/api/terceros/${idProveedor}/devolver`, { method: 'POST', body: {} });
  assert.equal(sinObs.status, 400);
  const dev = await pedir(`/api/terceros/${idProveedor}/devolver`, { method: 'POST', body: { observaciones: 'Falta la segunda referencia comercial.' } });
  assert.equal(dev.json.tercero.estado, 'devuelto');
  assert.ok(dev.json.correo.ok);

  // El token solo está en el correo de devolución
  const eml = fs.readdirSync(process.env.CORREOS_DIR).find((c) => c.includes('devolucion'));
  const contenido = fs.readFileSync(path.join(process.env.CORREOS_DIR, eml), 'utf8').replace(/=\r?\n/g, '').replace(/=3D/g, '=');
  const token = contenido.match(/expediente=([A-Za-z0-9_-]+)/)[1];

  const pub = await pedir(`/api/public/expediente/${token}`);
  assert.equal(pub.json.expediente.observaciones, 'Falta la segunda referencia comercial.');

  const fd = new FormData();
  fd.append('ref_comerciales', pdf('segunda'), 'referencia2.pdf');
  const cor = await pedir(`/api/public/expediente/${token}`, { method: 'POST', body: fd });
  assert.equal(cor.status, 200, JSON.stringify(cor.json));

  const t = (await pedir(`/api/terceros/${idProveedor}`)).json.tercero;
  const refs = t.anexos.filter((a) => a.tipo === 'ref_comerciales').map((a) => a.nombre_archivo).sort();
  assert.deepEqual(refs, [`PRO-${ANIO}-0001 - REFERENCIA COMERCIAL (1).pdf`, `PRO-${ANIO}-0001 - REFERENCIA COMERCIAL (2).pdf`]);
  assert.equal(t.estado, 'en_revision');
});

test('aprobar envía el expediente al Oficial de Cumplimiento con los anexos', async () => {
  const ed = await pedir(`/api/terceros/${idProveedor}`, { method: 'PUT', body: { representante_legal: 'Hernán Darío Ospina', pep: 'No', banco: 'Bancolombia' } });
  assert.equal(ed.json.tercero.datos.representante_legal, 'Hernán Darío Ospina');

  const r = await pedir(`/api/terceros/${idProveedor}/aprobar`, { method: 'POST', body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.tercero.estado, 'en_cumplimiento');
  assert.equal(r.json.tercero.revisado_por, 'Marcia Morales');

  const eml = fs.readdirSync(process.env.CORREOS_DIR).find((c) => c.includes('cumplimiento'));
  const contenido = fs.readFileSync(path.join(process.env.CORREOS_DIR, eml), 'utf8');
  assert.match(contenido, /oficial@arcilaza\.com/);
  assert.ok(contenido.includes(`=5BPRO-${ANIO}-0001=5D_Tercero_aprobado_por`));
  assert.match(contenido, /REFERENCIA COMERCIAL \(2\)\.pdf/);

  const resumen = await pedir('/api/resumen');
  assert.equal(resumen.json.en_cumplimiento, 1);
  assert.equal(resumen.json.aprobados_mes, 1);
});

test('registro manual de empleado: sin año ni SAGRILAFT', async () => {
  const sig = await pedir('/api/consecutivo?categoria=empleado');
  assert.equal(sig.json.consecutivo, `EMP-${ANIO}-0003`);
  const fd = new FormData();
  for (const [k, v] of Object.entries({ categoria: 'empleado', nombre: 'Alexander Peña Giraldo', numero_documento: '1.094.882.317', ciudad: 'Armenia, Quindío', email: 'alexander.pena@cofinet.com.au' })) fd.append(k, v);
  fd.append('identidad', pdf('cc'), 'cedula.pdf');
  fd.append('cert_bancaria', pdf('banco'), 'certificacion.pdf');
  const r = await pedir('/api/terceros', { method: 'POST', body: fd });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.tercero.consecutivo, `EMP-${ANIO}-0003`);
  const carpeta = path.join(process.env.ARCHIVO_DIR, 'EMPLEADOS', `EMP-${ANIO}-0003 ALEXANDER PEÑA GIRALDO`);
  assert.deepEqual(fs.readdirSync(carpeta).sort(), [`EMP-${ANIO}-0003 - CERTIFICACION BANCARIA.pdf`, `EMP-${ANIO}-0003 - DOCUMENTO DE IDENTIDAD.pdf`]);

  const ap = await pedir(`/api/terceros/${r.json.tercero.id}/aprobar`, { method: 'POST', body: {} });
  assert.equal(ap.json.tercero.estado, 'aprobado');
  assert.equal(ap.json.correo, null);

  const csv = await (await fetch(`${base}/api/terceros/exportar.csv`, { headers: { cookie } })).text();
  assert.match(csv, new RegExp(`EMP-${ANIO}-0003`));
  assert.match(csv, /Hernán Darío Ospina/);
});

test('persona natural: 5 documentos del formulario y límite de archivos por documento', async () => {
  const defs = CAMPOS.anexosPara('contratista', 'natural');
  assert.deepEqual(defs.map((d) => d.letra + d.name), ['Aidentidad', 'Bref_comerciales', 'Cref_bancaria', 'Dformulario', 'Erut']);
  assert.deepEqual(CAMPOS.anexosPara('proveedor', 'juridica').map((d) => d.max), [1, 2, 1, 1, 2, 3, 5, 1, 1, 1]);

  const fd = new FormData();
  const datos = { categoria: 'contratista', persona: 'natural', nombre: 'JOSÉ ISRAEL SEMANATE', tipo_documento: 'C.C.', numero_documento: '10.244.518',
    pais: 'Colombia', ciudad: 'Armenia', contacto: 'José', telefono: '3100000000', email: 'jose@correo.co', acepta_tratamiento: 'on' };
  for (const [k, v] of Object.entries(datos)) fd.append(k, v);
  for (const d of defs) fd.append(d.name, pdf(d.name), `${d.name}.pdf`);
  fd.append('ref_comerciales', pdf('otra'), 'otra.pdf'); // máximo 1
  const r = await pedir('/api/public/registro', { method: 'POST', body: fd });
  assert.equal(r.status, 400);
  assert.match(r.json.archivos.ref_comerciales, /máximo 1 archivo/);

  fd.delete('ref_comerciales');
  fd.append('ref_comerciales', pdf('ref'), 'ref.pdf');
  const ok = await pedir('/api/public/registro', { method: 'POST', body: fd });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
});

test('reversar un expediente enviado a Cumplimiento por error', async () => {
  const sinMotivo = await pedir(`/api/terceros/${idProveedor}/reversar`, { method: 'POST', body: {} });
  assert.equal(sinMotivo.status, 400);
  const r = await pedir(`/api/terceros/${idProveedor}/reversar`, { method: 'POST', body: { motivo: 'Se aprobó por error' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.tercero.estado, 'en_revision');
  assert.equal(r.json.tercero.fecha_aprobacion, null);
  assert.equal(r.json.tercero.revisado_por, null);
  assert.ok(r.json.correo.ok);
  assert.match(r.json.tercero.historial.map((h) => h.texto).join(' '), /reversó el expediente \(estaba "En Cumplimiento"\)/);
  assert.ok(fs.readdirSync(process.env.CORREOS_DIR).some((c) => c.includes('reverso')));

  const otra = await pedir(`/api/terceros/${idProveedor}/reversar`, { method: 'POST', body: { motivo: 'x' } });
  assert.equal(otra.status, 400); // ya está en revisión: nada que reversar
});
