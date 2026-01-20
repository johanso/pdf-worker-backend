# PDF Worker - Backend VPS

Servidor Node.js para procesamiento de documentos PDF con soporte para compresión gzip en uploads.

## Stack Tecnológico
- Node.js 20
- Express
- LibreOffice (Office ↔ PDF)
- Playwright (HTML → PDF)
- Ghostscript (Compresión PDF)
- ImageMagick (PDF ↔ Imágenes)
- QPDF (Protección/Desbloqueo)
- pdf-lib (Merge, Split, Rotate, Organize)
- pdftk 

### Dependencias Node
```bash
npm install
```

### Configurar ImageMagick (permitir PDF)
```bash
# Editar /etc/ImageMagick-6/policy.xml
# Cambiar:
#   <policy domain="coder" rights="none" pattern="PDF" />
# Por:
#   <policy domain="coder" rights="read|write" pattern="PDF" />
```

### Iniciar con PM2
```bash
npm install -g pm2
pm2 start server.js --name pdf-worker
pm2 save
pm2 startup
```

## Configuración SSL (Caddy)

```
# /etc/caddy/Caddyfile
tu-dominio.com {
    reverse_proxy localhost:3001
}
```

```bash
systemctl restart caddy
```

## Variables de Entorno

### Configuración Básica

El servidor puede funcionar sin archivo `.env`, pero se recomienda configurarlo para producción:

```bash
# Copiar el ejemplo
cp .env.example .env

# Editar con tus valores
nano .env
```

### Variables Disponibles

**Requeridas en Producción:**
- `ALLOWED_ORIGINS` - Dominios permitidos para CORS (separados por coma)
  - **CRÍTICO**: No configurar esto permite cualquier origen en desarrollo, pero rechaza en producción

**Opcionales:**
- `PORT` - Puerto del servidor (default: 3001)
- `NODE_ENV` - Entorno: `development` | `production` (default: production)

Ver `.env.example` para todas las variables disponibles.

## Seguridad

### CORS (Cross-Origin Resource Sharing)
El servidor implementa CORS restrictivo por defecto:
- **Producción**: Solo permite orígenes especificados en `ALLOWED_ORIGINS`
- **Desarrollo**: Permite localhost si no hay configuración
- **Credentials**: Habilitado para cookies/autenticación
- **Métodos permitidos**: GET, POST, PUT, DELETE, OPTIONS
- **Headers expuestos**: RateLimit-* para monitoreo de límites

```bash
# Configurar en .env
```

### Rate Limiting
El servidor implementa rate limiting para proteger contra abuso:
- **Health checks**: 60 req/min
- **Descargas**: 50 req/5min
- **Procesamiento**: 30 req/10min
- **OCR**: 10 req/30min (más restrictivo por ser muy costoso)
- **API general**: 100 req/15min

Ver detalles completos en `RATE_LIMITS.md`

### Protecciones Implementadas
- ✅ **CORS Restrictivo**: Whitelist de orígenes permitidos
- ✅ **Command Injection**: Todos los comandos externos usan `execFile` (argumentos separados)
- ✅ **Path Traversal**: Sanitización de nombres de archivo en uploads
- ✅ **File Type Validation**: Whitelist de extensiones permitidas
- ✅ **Rate Limiting**: Límites por IP para prevenir abuso
- ✅ **Timeout Protection**: Timeouts en comandos externos (2-10 min según operación)
- ✅ **Auto-cleanup**: Limpieza automática de archivos temporales
- ✅ **Auto-setup**: Creación automática de directorios necesarios al inicio

## Comandos Útiles

```bash
# Ver logs en tiempo real
pm2 logs pdf-worker

# Ver últimos 50 logs
pm2 logs pdf-worker --lines 50

# Reiniciar
pm2 restart pdf-worker

# Estado
pm2 status

# Monitoreo (CPU, memoria)
pm2 monit

# Ver archivos en descarga pendiente
ls -la /root/pdf-worker/downloads/

# Limpiar manualmente
rm -rf /root/pdf-worker/uploads/*
rm -rf /root/pdf-worker/outputs/*
rm -rf /root/pdf-worker/downloads/*
```

## Mantenimiento

### Auto-cleanup
- **uploads/outputs**: Archivos >1 hora se eliminan automáticamente
- **downloads**: Archivos expiran después de 10 minutos
- **FileStore**: Limpieza cada 2 minutos

### Logs
- Rotan automáticamente con PM2
- Ubicación: `~/.pm2/logs/`

## Troubleshooting

### Error "File too large"
- Verificar `upload.middleware.js` tiene límite de 100MB
- El cliente debe validar antes de subir

### Error "EPIPE"
- Normal si el cliente cancela la descarga
- No requiere acción

### LibreOffice cuelga
```bash
pkill -9 soffice
pm2 restart pdf-worker
```

### Playwright no funciona
```bash
npx playwright install chromium
npx playwright install-deps
pm2 restart pdf-worker
```

## API Client (Frontend)

El frontend usa el hook `usePdfProcessing` que:
1. Comprime archivos con fflate (gzip)
2. Sube con XHR mostrando progreso
3. Recibe `fileId` del servidor
4. Dispara descarga nativa del navegador

Ver documentación en el repositorio del frontend.

## Changelog

### v1.2.0 (Enero 2025) - Security Hardening
- 🔒 **Command Injection Protection**: Todos los comandos externos usan `execFile`
- 🔒 **Path Traversal Protection**: Sanitización robusta de nombres de archivo
- 🔒 **File Type Validation**: Whitelist estricta de extensiones permitidas
- 🔒 **Rate Limiting**: Límites configurables por tipo de endpoint
- 🔒 **CORS Restrictivo**: Whitelist de orígenes permitidos
- 🔒 **Timeout Protection**: Timeouts en todas las operaciones externas
- 🔧 **Auto-setup**: Creación automática de directorios al inicio
- 📝 Variables de entorno con `.env` support
- 📝 Documentación completa de seguridad (CORS.md, RATE_LIMITS.md, SECURITY_AUDIT_RESULTS.md)

### v1.1.0 (Diciembre 2024)
- ✅ Soporte para compresión gzip en uploads
- ✅ Nuevo flujo con fileId (separación upload/descarga)
- ✅ FileStore con expiración automática
- ✅ Todas las rutas actualizadas al nuevo formato
- ✅ Límites aumentados a 150MB por archivo

### v1.0.0
- Release inicial con todas las herramientas PDF