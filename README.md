# Vinculación de terceros – Inversora Arcilaza S.A.S.

**Registro de proveedores, contratistas y clientes**

El sistema tiene dos partes:

| Parte | URL | Quién la usa |
|---|---|---|
| **Formulario web** | `/formulario/` | Clientes, proveedores y contratistas externos. Diligencian su información y adjuntan anexos. |
| **Aplicativo contable** | `/app/` | Área contable (con usuario y contraseña). Consulta la base de datos, valida, registra manualmente y envía por correo. |

## Funcionalidades

- **Formulario público** con secciones que cambian según el tipo (cliente / proveedor / contratista) y el tipo de persona (natural / jurídica): información general, ubicación, representante legal, tributaria, contacto, comercial, bancaria, SARLAFT, anexos y autorizaciones (Ley 1581 de 2012).
- **Consecutivo por categoría**: `CLI-00001`, `PRO-00001`, `CON-00001`, `EMP-00001`. Al terminar, el tercero ve su número de radicado.
- **Anexos guardados por carpeta**: `uploads/clientes/CLI-00001/`, `uploads/proveedores/PRO-00001/`, `uploads/contratistas/…`, `uploads/empleados/…`.
- **Base de datos** (SQLite, `data/terceros.db`) con una sección por categoría, búsqueda, filtro por estado y exportación a Excel (CSV).
- **Registro manual** desde el aplicativo (por ejemplo, empleados, que no aparecen en el formulario público).
- **Validación**: estados *Pendiente → En revisión → Validado / Rechazado → Enviado por correo*, con observaciones, usuario y fecha.
- **Envío de correo** (solo después de validar) con la información del tercero y los anexos seleccionados adjuntos. Queda registro de cada envío.
- **Historial** de cada tercero (creación, ediciones, cambios de estado, anexos, correos).
- **Usuarios** del área contable (roles *Administrador* y *Contabilidad*).

## Instalación

Requiere **Node.js 22.5 o superior** (usa el módulo SQLite integrado de Node).

```bash
npm install
cp .env.example .env     # y edite los valores
npm start
```

- Formulario: http://localhost:3000/formulario/
- Aplicativo: http://localhost:3000/app/ — usuario inicial `admin` / contraseña de `ADMIN_PASSWORD` (por defecto `Arcilaza2026*`). **Cámbiela en "Mi cuenta" después de ingresar.**

### Correo (SMTP)

Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` y `MAIL_FROM` en `.env`. Para Office 365: `smtp.office365.com`, puerto `587`, `SMTP_SECURE=false`.
Si `SMTP_HOST` está vacío, el aplicativo funciona en **modo simulado**: el correo se genera completo (con adjuntos) y se guarda como `.eml` en `data/correos/`.

### Pruebas

```bash
npm test
```

## Estructura

```
server.js                  Servidor Express y API
src/config.js              Configuración (.env)
src/db.js                  Base de datos, tablas y consecutivos
src/terceros.js            Registro, anexos, estados, consultas
src/mailer.js              Envío de correos con anexos
public/shared/campos.js    Definición de campos, secciones y anexos (compartida)
public/shared/render.js    Construcción de formularios a partir de campos.js
public/formulario/         Formulario web para terceros
public/app/                Aplicativo del área contable
test/                      Pruebas automáticas
```

Para agregar, quitar o cambiar campos o anexos, edite **`public/shared/campos.js`**: el formulario, el aplicativo, la validación, el correo y la exportación se actualizan automáticamente.

## Producción

- Use `SESSION_SECRET` largo y aleatorio y publique detrás de HTTPS (`BASE_URL=https://…`).
- Haga copia de seguridad periódica de las carpetas `data/` y `uploads/`.
