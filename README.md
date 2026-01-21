# PDF Worker - Backend API

Backend Node.js para procesamiento de documentos PDF con múltiples herramientas.

## Stack Tecnológico

### Dependencias Node.js
- Express
- Multer (file uploads)
- pdf-lib (manipulación PDF)
- cors

### Herramientas Externas
- LibreOffice (conversión Office ↔ PDF)
- Ghostscript (compresión y optimización)
- ImageMagick (conversión PDF ↔ imágenes)
- QPDF (protección y reparación)
- Tesseract OCR (reconocimiento de texto)
- Playwright (HTML → PDF)

## Instalación

### 1. Instalar Dependencias Node

```bash
npm install
```

### 2. Instalar Herramientas del Sistema

**Ubuntu/Debian:**
```bash
# LibreOffice
sudo apt-get install libreoffice

# Ghostscript
sudo apt-get install ghostscript

# ImageMagick
sudo apt-get install imagemagick

# QPDF
sudo apt-get install qpdf

# Tesseract OCR
sudo apt-get install tesseract-ocr tesseract-ocr-spa tesseract-ocr-eng

# Playwright
npx playwright install chromium
npx playwright install-deps
```

### 3. Configurar ImageMagick

Editar `/etc/ImageMagick-6/policy.xml` y cambiar:

```xml
<!-- De esto: -->
<policy domain="coder" rights="none" pattern="PDF" />

<!-- A esto: -->
<policy domain="coder" rights="read|write" pattern="PDF" />
```

### 4. Variables de Entorno

Crear archivo `.env` (opcional):

```bash
cp .env.example .env
```

Editar `.env` con tu configuración:

```bash
PORT=3001
NODE_ENV=production
ALLOWED_ORIGINS=https://tu-dominio.com
```

## Uso

### Modo Desarrollo

```bash
npm run dev
```

### Modo Producción

```bash
npm start
```

### Con PM2

```bash
npm install -g pm2
pm2 start server.js --name pdf-worker
pm2 save
pm2 startup
```

## Endpoints Principales

El servidor expone múltiples endpoints REST para procesamiento de PDFs:

- **Conversión Office → PDF**: `/api/word-to-pdf`, `/api/excel-to-pdf`, `/api/ppt-to-pdf`
- **Conversión PDF → Office**: `/api/pdf-to-word`, `/api/pdf-to-excel`, `/api/pdf-to-ppt`
- **Manipulación**: `/api/merge-pdf`, `/api/split-pdf`, `/api/rotate-pdf`, `/api/compress-pdf`
- **Imágenes**: `/api/pdf-to-image`, `/api/image-to-pdf`
- **Seguridad**: `/api/protect-pdf`, `/api/unlock-pdf`
- **OCR**: `/api/ocr-pdf`
- **Otros**: `/api/html-to-pdf`, `/api/repair-pdf`, `/api/sign-pdf`

Ver documentación completa de API en `/api-docs` (Swagger UI).

## Desarrollo

### Guías de Desarrollo

Para mantener consistencia en el código y seguir los patrones establecidos:

- **[DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md)** - Guía completa con templates, patrones y mejores prácticas
- **[.claude/conventions.md](./.claude/conventions.md)** - Referencia rápida de convenciones

Estas guías documentan:
- Estructura de archivos y naming conventions
- Templates para servicios y rutas
- Documentación Swagger estándar
- Formato de respuestas y manejo de errores
- Validación de parámetros y limpieza de archivos

### Agregar un Nuevo Endpoint

1. Crear servicio en `src/services/nombre.service.js`
2. Crear ruta en `src/routes/nombre.route.js`
3. Agregar documentación Swagger
4. Registrar en `server.js`
5. Seguir checklist en DEVELOPMENT_GUIDE.md

## Comandos Útiles

```bash
# Ver logs PM2
pm2 logs pdf-worker

# Reiniciar servidor
pm2 restart pdf-worker

# Estado
pm2 status

# Limpiar archivos temporales
rm -rf uploads/* outputs/* downloads/*
```

## Límites

- Tamaño máximo de archivo: 150MB
- Máximo de archivos por request: 50
- Los archivos temporales se eliminan automáticamente después de 1 hora

## Licencia

Privado
