# PDF Worker API - Convenciones Rápidas

Este archivo es una referencia rápida de las convenciones del proyecto para agentes de IA y desarrolladores.

## Estructura Básica

### Nuevo Endpoint (Route)
```javascript
const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const { cleanupFiles } = require('../utils/cleanup.utils');
const fileStore = require('../services/file-store.service');
const fs = require('fs').promises;

router.post('/', upload.single('file'), async (req, res) => {
  const tempFiles = req.file ? [req.file.path] : [];
  try {
    if (!req.file) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'Archivo requerido' });
    }

    const outputFileName = req.body.fileName ||
      req.file.originalname.replace('.pdf', '-procesado.pdf');

    // Procesar archivo...
    const result = await service.process(fileBuffer, options);
    await cleanupFiles(tempFiles);

    const fileId = await fileStore.storeFile(
      Buffer.from(result.pdfBytes),
      outputFileName,
      'application/pdf'
    );

    res.json({
      success: true,
      fileId,
      fileName: outputFileName,
      size: result.pdfBytes.byteLength,
      resultSize: result.pdfBytes.byteLength,
      originalSize: fileBuffer.length
    });
  } catch (error) {
    console.error('[EndpointName] Error:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ error: error.message || 'Error interno' });
  }
});

module.exports = router;
```

### Nuevo Servicio
```javascript
const path = require('path');
const fs = require('fs').promises;

class NombreService {
  async procesarArchivo(inputBuffer, options = {}) {
    const { parametro = 'default' } = options;

    console.log(`[NombreService] Procesando...`);
    const startTime = Date.now();

    // Lógica aquí

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[NombreService] Completado en ${elapsed}s`);

    return {
      pdfBytes: resultBuffer,
      pageNumbers: [1, 2, 3],
      totalPages: 3
    };
  }
}

module.exports = new NombreService();
```

## Respuesta Estándar

```json
{
  "success": true,
  "fileId": "abc123",
  "fileName": "documento.pdf",
  "size": 524288,
  "resultSize": 524288,
  "originalSize": 1048576,
  "pagesProcessed": 10,
  "pageNumbers": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
}
```

## Swagger Tags

- `[Conversión Office]`
- `[Manipulación PDF]`
- `[Compresión y Optimización]`
- `[Seguridad]`
- `[Procesamiento de Páginas]`
- `[OCR]`
- `[Marca de Agua]`
- `[Health]`

## Patrones Comunes

### Validación de Opacidad
```javascript
const opacity = parseFloat(req.body.opacity) || 0.5;
if (opacity < 0 || opacity > 1) {
  await cleanupFiles(tempFiles);
  return res.status(400).json({ error: 'La opacidad debe estar entre 0 y 1' });
}
```

### Parsear Páginas
```javascript
let pages = 'all';
if (req.body.pages && req.body.pages !== 'all') {
  try {
    pages = JSON.parse(req.body.pages);
  } catch (e) {
    await cleanupFiles(tempFiles);
    return res.status(400).json({ error: 'Formato de páginas inválido' });
  }
}
```

### Descomprimir .gz
```javascript
const { promisify } = require('util');
const zlib = require('zlib');
const gunzip = promisify(zlib.gunzip);

async function decompressIfNeeded(buffer, fileName) {
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
    console.log(`[Decompress] Decompressing: ${fileName}`);
    return await gunzip(buffer);
  }
  return buffer;
}

let fileBuffer = await fs.readFile(req.file.path);
if (req.body.compressed === 'true' || req.file.originalname.endsWith('.gz')) {
  fileBuffer = await decompressIfNeeded(fileBuffer, req.file.originalname);
}
```

### Múltiples Archivos (upload.fields)
```javascript
router.post('/image', upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'watermarkImage', maxCount: 1 }
]), async (req, res) => {
  const tempFiles = [];

  if (!req.files || !req.files.file || !req.files.watermarkImage) {
    await cleanupFiles(tempFiles);
    return res.status(400).json({ error: 'Faltan archivos' });
  }

  const pdfFile = req.files.file[0];
  const imageFile = req.files.watermarkImage[0];
  tempFiles.push(pdfFile.path, imageFile.path);

  // Procesar...
});
```

## Registro en server.js

```javascript
// En la sección apropiada según la herramienta
app.use('/api/nombre-endpoint', uploadLimiter, require('./src/routes/nombre-endpoint.route'));
```

## Nombres de Archivos

- Routes: `nombre-feature.route.js`
- Services: `nombre-tool.service.js`
- Output: `${filename}-accion-${Date.now()}.pdf`

## Logging

```javascript
console.log('[ServiceName] Mensaje informativo');
console.error('[EndpointName] Error:', error);
console.log(`[Service] Completado en ${elapsed}s`);
```

## Documentación Completa

Ver `DEVELOPMENT_GUIDE.md` para documentación detallada con todos los patrones, ejemplos y mejores prácticas.
