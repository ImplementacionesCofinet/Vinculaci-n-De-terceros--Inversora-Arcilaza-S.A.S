/*
 * Copia opcional de los expedientes a una biblioteca de SharePoint (Microsoft Graph,
 * credenciales de aplicación). Si no está configurado, el archivo local es el único.
 */
const fs = require('node:fs');
const config = require('./config');

const sp = config.sharepoint;
const configurado = Boolean(sp.tenantId && sp.clientId && sp.clientSecret && sp.driveId);
let token = null;

async function obtenerToken() {
  if (token && token.expira > Date.now() + 60_000) return token.valor;
  const resp = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(sp.tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: sp.clientId,
      client_secret: sp.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  const j = await resp.json();
  if (!resp.ok) throw new Error('SharePoint: no se pudo autenticar (' + (j.error_description || resp.status) + ')');
  token = { valor: j.access_token, expira: Date.now() + j.expires_in * 1000 };
  return token.valor;
}

// "PROVEEDORES/2026/PRO-2026-0042 X" → ruta codificada dentro de la carpeta raíz
const ruta = (...partes) => [sp.carpetaRaiz, ...partes].join('/').split('/').filter(Boolean).map(encodeURIComponent).join('/');

async function graph(metodo, url, cuerpo, tipo) {
  const resp = await fetch('https://graph.microsoft.com/v1.0' + url, {
    method: metodo,
    headers: { Authorization: 'Bearer ' + (await obtenerToken()), ...(tipo ? { 'Content-Type': tipo } : {}) },
    body: cuerpo,
  });
  if (!resp.ok && resp.status !== 404) {
    const j = await resp.json().catch(() => ({}));
    throw new Error(`SharePoint ${metodo}: ${j.error?.message || resp.status}`);
  }
  return resp.status === 204 || resp.status === 404 ? null : resp.json();
}

/** Sube un archivo y devuelve el enlace web de la carpeta del expediente. */
async function subir(carpeta, nombreArchivo, rutaLocal, mime) {
  const item = await graph('PUT', `/drives/${sp.driveId}/root:/${ruta(carpeta, nombreArchivo)}:/content`, fs.readFileSync(rutaLocal), mime || 'application/octet-stream');
  const padre = await graph('GET', `/drives/${sp.driveId}/items/${item.parentReference.id}`);
  return padre?.webUrl || null;
}

async function eliminar(carpeta, nombreArchivo) {
  await graph('DELETE', `/drives/${sp.driveId}/root:/${ruta(carpeta, nombreArchivo)}`);
}

module.exports = { configurado, subir, eliminar };
