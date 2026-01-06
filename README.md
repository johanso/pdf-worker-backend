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
mipdf.cloud {
    reverse_proxy localhost:3001
}
```

```bash
systemctl restart caddy
```

## Variables de Entorno
No hay variables de entorno requeridas. El servidor usa puerto 3001 por defecto.

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

### v1.1.0 (Diciembre 2024)
- ✅ Soporte para compresión gzip en uploads
- ✅ Nuevo flujo con fileId (separación upload/descarga)
- ✅ FileStore con expiración automática
- ✅ Todas las rutas actualizadas al nuevo formato
- ✅ Límites aumentados a 100MB por archivo

### v1.0.0
- Release inicial con todas las herramientas PDF