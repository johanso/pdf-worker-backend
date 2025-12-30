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

## Arquitectura

### Flujo de Procesamiento
```
[Cliente] 
    │
    ├── Comprime archivos (gzip) en navegador
    │
    ▼
[Upload] → [Descomprime si .gz] → [Procesa] → [Guarda en FileStore] → [Retorna fileId]
    │
    ▼
[Cliente solicita GET /api/download/:fileId]
    │
    ▼
[Descarga nativa del navegador]
```

### Beneficios
- **Upload más rápido**: Archivos comprimidos ~30-50% más pequeños
- **Mejor UX**: Separación de fases (upload → proceso → descarga)
- **Percepción mejorada**: Usuario ve progreso real de cada fase

## Estructura del Proyecto
```
/root/pdf-worker/
├── server.js              # Entry point
├── package.json
├── src/
│   ├── routes/            # Endpoints API
│   │   ├── download.route.js      # Descarga por fileId
│   │   ├── merge-pdf.route.js     # Unir PDFs
│   │   ├── split-pdf.route.js     # Dividir PDF
│   │   ├── rotate-pdf.route.js    # Rotar páginas
│   │   ├── organize-pdf.route.js  # Organizar páginas
│   │   ├── compress-pdf.route.js  # Comprimir PDF
│   │   ├── delete-pages.route.js  # Eliminar páginas
│   │   ├── process-pages.route.js # Procesar páginas
│   │   ├── word-to-pdf.route.js   # Word → PDF
│   │   ├── excel-to-pdf.route.js  # Excel → PDF
│   │   ├── ppt-to-pdf.route.js    # PowerPoint → PDF
│   │   ├── pdf-to-word.route.js   # PDF → Word
│   │   ├── pdf-to-excel.route.js  # PDF → Excel
│   │   ├── pdf-to-ppt.route.js    # PDF → PowerPoint
│   │   ├── pdf-to-image.route.js  # PDF → Imágenes
│   │   ├── image-to-pdf.route.js  # Imágenes → PDF
│   │   ├── protect-pdf.route.js   # Proteger con contraseña
│   │   ├── unlock-pdf.route.js    # Desbloquear PDF
│   │   └── html-to-pdf.route.js   # HTML/URL → PDF
│   ├── services/          # Lógica de conversión
│   │   ├── file-store.service.js  # Almacén temporal de archivos
│   │   ├── libreoffice.service.js # Conversiones Office
│   │   ├── ghostscript.service.js # Compresión PDF
│   │   ├── playwright.service.js  # HTML a PDF
│   │   ├── pdf2docx.service.js    # PDF a Word (Python)
│   │   └── qpdf.service.js        # Encriptación/Desencriptación
│   ├── middleware/        # Multer, validación, errores
│   │   ├── upload.middleware.js
│   │   ├── pdf-validation.middleware.js
│   │   └── error.middleware.js
│   └── utils/             # Helpers
│       ├── cleanup.utils.js
│       └── file.utils.js
├── uploads/               # Temporal (auto-cleanup)
├── outputs/               # Temporal (auto-cleanup)
└── downloads/             # Archivos para descarga (expiran en 10 min)
```

## Endpoints Disponibles

### Sistema
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/api/download/:fileId` | Descargar archivo procesado |
| DELETE | `/api/download/:fileId` | Eliminar archivo manualmente |

### Manipulación PDF
| Método | Endpoint | Descripción | Multi-archivo |
|--------|----------|-------------|---------------|
| POST | `/api/merge-pdf` | Unir múltiples PDFs | ✅ |
| POST | `/api/split-pdf` | Dividir PDF | ❌ |
| POST | `/api/rotate-pdf` | Rotar páginas | ❌ |
| POST | `/api/organize-pdf` | Reordenar páginas | ✅ |
| POST | `/api/delete-pages` | Eliminar páginas | ❌ |
| POST | `/api/process-pages` | Procesar páginas | ❌ |
| POST | `/api/compress-pdf` | Comprimir PDF | ❌ |

### Conversiones Office
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/word-to-pdf` | Word → PDF |
| POST | `/api/pdf-to-word` | PDF → Word |
| POST | `/api/excel-to-pdf` | Excel → PDF |
| POST | `/api/pdf-to-excel` | PDF → Excel |
| POST | `/api/ppt-to-pdf` | PowerPoint → PDF |
| POST | `/api/pdf-to-ppt` | PDF → PowerPoint |

### Imágenes
| Método | Endpoint | Descripción | Multi-archivo |
|--------|----------|-------------|---------------|
| POST | `/api/pdf-to-image` | PDF → Imágenes (ZIP si múltiples) | ❌ |
| POST | `/api/image-to-pdf` | Imágenes → PDF | ✅ |

### Seguridad
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/protect-pdf` | Proteger con contraseña |
| POST | `/api/unlock-pdf` | Desbloquear PDF |

### HTML
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/html-to-pdf` | HTML/URL → PDF |
| POST | `/api/html-to-pdf/preview` | Generar preview PNG |
| GET | `/api/html-to-pdf/health` | Estado del browser |

## Formato de Respuesta

### Respuesta exitosa (todas las rutas)
```json
{
  "success": true,
  "fileId": "a1b2c3d4e5f6...",
  "fileName": "merged.pdf",
  "size": 1234567,
  "pages": 10
}
```

### Descarga de archivo
```
GET /api/download/:fileId
→ Archivo binario con headers Content-Disposition
```

## Compresión Gzip

Todas las rutas soportan archivos comprimidos con gzip:

### Request con compresión
```
POST /api/merge-pdf
Content-Type: multipart/form-data

files: archivo1.pdf.gz (comprimido)
files: archivo2.pdf.gz (comprimido)
compressed: "true"
```

### Detección automática
El servidor detecta archivos gzip por:
1. Flag `compressed: "true"` en el body
2. Extensión `.gz` en el nombre del archivo
3. Magic bytes `1f 8b` al inicio del archivo

## Límites

| Límite | Valor |
|--------|-------|
| Tamaño máximo por archivo | 100 MB |
| Archivos máximos por request | 50 |
| Tamaño total batch (frontend) | 500 MB |
| Tiempo expiración archivos | 10 minutos |
| Páginas máximas PDF→Image | 100 |

## Instalación

### Dependencias del sistema
```bash
apt-get update
apt-get install -y \
  libreoffice \
  ghostscript \
  imagemagick \
  qpdf \
  poppler-utils \
  python3-pip

# Para pdf2docx
pip3 install pdf2docx

# Playwright browsers
npx playwright install chromium
npx playwright install-deps
```

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