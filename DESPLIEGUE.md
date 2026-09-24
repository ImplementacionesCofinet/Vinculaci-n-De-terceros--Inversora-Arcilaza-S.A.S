# Publicar el aplicativo con Docker

Esta guía deja en línea el **portal para terceros** y el **aplicativo de Contabilidad** en un servidor con Docker. Sirve para un VPS (DigitalOcean, AWS, Azure, etc.) o para un servidor propio de la empresa.

## 1. Requisitos

- Un servidor Linux con **Docker** y **Docker Compose**. Instalación en Ubuntu: `curl -fsSL https://get.docker.com | sh`
- Para usar HTTPS (recomendado, porque los terceros envían documentos personales):
  - Un **dominio o subdominio**, por ejemplo `terceros.arcilaza.com`, con un registro DNS tipo **A** que apunte a la IP del servidor.
  - Los puertos **80 y 443** abiertos en el firewall.
- Una cuenta de correo para enviar notificaciones (SMTP). Con Office 365 sirve un buzón como `vinculacion@cofinet.com.au`.

## 2. Descargar el código y configurar

```bash
git clone https://github.com/ImplementacionesCofinet/Vinculaci-n-De-terceros--Inversora-Arcilaza-S.A.S.git vinculacion
cd vinculacion
cp .env.example .env
nano .env
```

Valores que **debe** completar en `.env`:

| Variable | Qué poner |
|---|---|
| `SESSION_SECRET` | Una cadena larga y aleatoria. Genérela con `openssl rand -hex 32`. Sin esto, el aplicativo no arranca. |
| `ADMIN_PASSWORD` | Contraseña inicial del usuario `admin`. Cámbiela después del primer ingreso. |
| `ADMIN_NOMBRE` | Nombre de quien administra (aparece en el historial). |
| `BASE_URL` | La dirección pública, por ejemplo `https://terceros.arcilaza.com`. Se usa en los enlaces que reciben los terceros por correo. |
| `DOMINIO` | Solo con HTTPS: el dominio sin `https://`, por ejemplo `terceros.arcilaza.com`. |
| `OFICIAL_CUMPLIMIENTO_EMAIL` | Correo del Oficial de Cumplimiento, que recibe los expedientes aprobados. |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Datos del correo saliente. Office 365: `smtp.office365.com`, puerto `587`, `SMTP_SECURE=false`. |

Coloque el formulario Word en `documentos/FOR-DCF-001.docx`. Es el archivo que descargan los terceros en el paso 1.

> **Office 365:** el buzón que envía los correos debe tener habilitado "SMTP autenticado". Se activa en el Centro de administración de Microsoft 365 → Usuarios → el buzón → Correo → Administrar aplicaciones de correo electrónico.

## 3. Arrancar

**Con HTTPS y dominio (recomendado):**

```bash
docker compose --profile https up -d --build
```

Caddy obtiene y renueva automáticamente el certificado de Let's Encrypt.

- Portal para terceros: `https://terceros.arcilaza.com/formulario/`
- Aplicativo de Contabilidad: `https://terceros.arcilaza.com/app/`

**Sin dominio (red interna o pruebas):**

```bash
docker compose up -d --build
```

Queda en `http://IP-DEL-SERVIDOR:3000`. Cambie el puerto con `PUERTO_LOCAL` en `.env`.

Para comprobar que funciona:

```bash
docker compose ps          # el servicio app debe decir "healthy"
docker compose logs -f app # mensajes del aplicativo
```

## 4. Primer ingreso

1. Entre a `/app/` con el usuario `admin` y la contraseña de `ADMIN_PASSWORD`.
2. Vaya a **Cuenta** y cambie la contraseña.
3. En **Usuarios**, cree una cuenta para cada persona de Contabilidad.
4. Comparta con los terceros el enlace del portal (`/formulario/`).

## 5. Dónde quedan los datos

Los datos se guardan en volúmenes de Docker, así que no se pierden al reiniciar ni al actualizar:

| Volumen | Contenido |
|---|---|
| `datos` | Base de datos (terceros, historial, usuarios, sesiones) y correos simulados |
| `expedientes` | `SOPORTES CREACION TERCEROS/PROVEEDORES/2026/PRO-2026-0042 …/` con todos los anexos |

### Copias de seguridad

```bash
# Copia (genera respaldo-AAAA-MM-DD.tar.gz en la carpeta actual)
docker compose exec app tar czf - -C /app data archivo > respaldo-$(date +%F).tar.gz

# Restaurar
docker compose exec -T app tar xzf - -C /app < respaldo-2026-09-24.tar.gz
docker compose restart app
```

Se recomienda programar la copia diaria con `crontab -e`:

```
0 2 * * * cd /ruta/vinculacion && docker compose exec -T app tar czf - -C /app data archivo > /respaldos/vinculacion-$(date +\%F).tar.gz
```

También puede activar la copia automática a **SharePoint** con las variables `SHAREPOINT_*` (ver `.env.example`).

## 6. Actualizar a una nueva versión

```bash
git pull
docker compose --profile https up -d --build   # o sin --profile https
```

Los datos y expedientes se conservan.

## 7. Problemas frecuentes

| Síntoma | Causa probable |
|---|---|
| El contenedor se reinicia y el log dice "Configure SESSION_SECRET" | Falta `SESSION_SECRET` en `.env`. |
| Los correos no salen; el historial dice "correo generado (simulado)" | `SMTP_HOST` está vacío. |
| "No se pudo enviar el correo al Oficial de Cumplimiento" | Falta `OFICIAL_CUMPLIMIENTO_EMAIL` o el SMTP rechazó el envío. El detalle aparece en el historial del expediente. |
| El certificado HTTPS no se genera | El DNS del dominio aún no apunta al servidor, o los puertos 80/443 están cerrados. Revise con `docker compose logs https`. |
| El enlace del correo de devolución apunta a `localhost` | `BASE_URL` no tiene la dirección pública. |
