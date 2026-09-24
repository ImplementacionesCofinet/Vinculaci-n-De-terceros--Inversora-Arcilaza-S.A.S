# Vinculación de terceros – Inversora Arcilaza S.A.S.

**Registro de proveedores, contratistas y clientes** · Formulario FOR-DCF-001 · SAGRILAFT / SARLAFT / PTEE

| Parte | URL | Quién la usa |
|---|---|---|
| **Portal público** | `/formulario/` | Proveedores, contratistas, clientes y otras contrapartes. |
| **Aplicativo contable** | `/app/` | Contabilidad (con usuario y contraseña). |

## Flujo

1. **El tercero** entra al portal, descarga el Word **FOR-DCF-001**, lo diligencia y firma. Luego indica su tipo (proveedor, contratista, cliente u otro) y si es persona jurídica o natural, llena los datos básicos y adjunta los documentos: 10 para persona jurídica y 6 para natural.
   Cada archivo se revisa apenas se sube: los **vacíos, dañados o renombrados se rechazan** y el botón *Enviar registro* solo se habilita cuando todos los obligatorios están validados.
2. El sistema asigna el **consecutivo** (`PRO-2026-0042`, `CLI-2026-0043`, `EMP-2026-0049`…). Es un solo número por año para todos los tipos y nadie lo escribe a mano. Los archivos quedan en:
   ```
   SOPORTES CREACION TERCEROS/PROVEEDORES/2026/PRO-2026-0042 CAFÉ DE LA SIERRA S.A.S/PRO-2026-0042 - RUT.pdf
   SOPORTES CREACION TERCEROS/EMPLEADOS/EMP-2026-0049 ALEXANDER PEÑA GIRALDO/…   (empleados: sin año)
   ```
   El tercero recibe un correo con su radicado.
3. **Contabilidad** trabaja desde la **Bandeja de revisión**. Al abrir un expediente, este pasa a *En revisión*. Contabilidad transcribe del FOR-DCF-001 el representante legal, los datos bancarios y las declaraciones SAGRILAFT, y ve alertas por documento: faltantes, "solo se recibió una de las dos" o cámara de comercio con más de 30 días.
   - **Devolver al tercero**: envía las observaciones al correo del tercero junto con un enlace para reemplazar solo los documentos pedidos. Al corregir, el expediente vuelve a la bandeja.
   - **Aprobar y enviar a Cumplimiento**: envía automáticamente al Oficial de Cumplimiento un correo con los datos y todos los anexos adjuntos. El estado pasa a *En Cumplimiento*.
4. **Registro manual**: sirve para empleados o terceros que entregaron los documentos en físico. Tiene zona para arrastrar archivos, con la misma revisión del portal. Los empleados no llevan SAGRILAFT.
5. Otras secciones:
   - **Por actualizar**: terceros aprobados hace más de 12 meses.
   - **Reportes**: resumen por tipo y estado.
   - **Exportar base**: descarga en CSV para Excel.
   - **Usuarios**.

Estados: Pendiente de revisión · En revisión · Devuelto al tercero · Aprobado por Contabilidad · En Cumplimiento · Rechazado.

## Publicar con Docker

```bash
cp .env.example .env                              # complete SESSION_SECRET, BASE_URL, DOMINIO, SMTP, Oficial de Cumplimiento
docker compose --profile https up -d --build      # HTTPS automático en https://DOMINIO
```

La guía completa (requisitos, primer ingreso, copias de seguridad y actualización) está en **[DESPLIEGUE.md](DESPLIEGUE.md)**.

## Instalación sin Docker (desarrollo)

Requiere **Node.js 22.5 o superior** (usa el SQLite integrado de Node).

```bash
npm install
cp .env.example .env      # configure el Oficial de Cumplimiento, SMTP, etc.
npm start
```

- Coloque el Word del formulario en `documentos/FOR-DCF-001.docx`.
- Usuario inicial `admin` con la contraseña de `ADMIN_PASSWORD`. Cámbiela en *Cuenta* después del primer ingreso.
- Sin SMTP configurado, los correos se generan completos y se guardan como `.eml` en `data/correos/` (modo simulado).
- **SharePoint (opcional)**: con las variables `SHAREPOINT_*`, cada archivo también se copia a la biblioteca de SharePoint con la misma estructura de carpetas. El expediente muestra entonces *Abrir carpeta en SharePoint*.

```bash
npm test
```

## Estructura

```
server.js                   Rutas del portal, del aplicativo y de la API
src/terceros.js             Expedientes: consecutivo, carpetas, anexos, estados, consultas
src/mailer.js               Correos: radicado, devolución y envío a Cumplimiento
src/sharepoint.js           Copia opcional a SharePoint (Microsoft Graph)
src/db.js, src/config.js    Base de datos SQLite y configuración (.env)
public/shared/campos.js     Tipos, documentos por persona, estados y revisión de archivos (compartido)
public/formulario/          Portal público
public/app/                 Aplicativo de Contabilidad
```

La lista de documentos por tipo de persona, los datos básicos y las preguntas SAGRILAFT se editan en `public/shared/campos.js`.

## Producción

- Publique detrás de HTTPS (`BASE_URL=https://…`) y use un `SESSION_SECRET` largo y aleatorio.
- Haga copia de seguridad de `data/` (base de datos) y de la carpeta de expedientes (`ARCHIVO_DIR`), o active SharePoint.
