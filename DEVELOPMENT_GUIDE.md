# Guía de Desarrollo - PDF Worker API

Esta guía documenta los estándares, patrones y convenciones utilizadas en el proyecto PDF Worker API para mantener consistencia en el código.

## Tabla de Contenidos

1. [Estructura de Archivos](#estructura-de-archivos)
2. [Creación de Servicios](#creación-de-servicios)
3. [Creación de Rutas](#creación-de-rutas)
4. [Documentación Swagger](#documentación-swagger)
5. [Respuestas Estándar](#respuestas-estándar)
6. [Manejo de Errores](#manejo-de-errores)
7. [Validación de Parámetros](#validación-de-parámetros)
8. [Limpieza de Archivos](#limpieza-de-archivos)
9. [Convenciones de Nomenclatura](#convenciones-de-nomenclatura)

---

## Estructura de Archivos

### Directorio del Proyecto

```
pdf-worker-backend/
├── src/
│   ├── middleware/          # Middleware (upload, validation, error handling)
│   ├── routes/             # Endpoints de la API
│   ├── services/           # Lógica de negocio
│   └── utils/              # Utilidades compartidas
├── uploads/                # Archivos temporales subidos
├── outputs/                # Archivos procesados temporales
├── downloads/              # Archivos listos para descarga (FileStore)
├── server.js               # Archivo principal del servidor
└── swagger.config.js       # Configuración de Swagger
```

### Naming Conventions

- **Rutas**: `nombre-feature.route.js` (kebab-case)
- **Servicios**: `nombre-tool.service.js` (kebab-case)
- **Middlewares**: `nombre.middleware.js`
- **Utils**: `nombre.utils.js`

**Ejemplos:**
- `watermark-pdf.route.js`
- `ghostscript.service.js`
- `upload.middleware.js`
- `cleanup.utils.js`

---

## Creación de Servicios

Los servicios contienen la lógica de negocio y procesamientos. Siguen estos patrones:

### Template de Servicio

```javascript
const { execFileWithTimeout } = require('../utils/file.utils');
const path = require('path');
const fs = require('fs').promises;

class NombreService {

  /**
   * Descripción clara del método
   *
   * @param {string} inputPath - Ruta del archivo de entrada
   * @param {string} outputDir - Directorio de salida
   * @param {object} options - Opciones del proceso
   * @param {string} options.parametro - Descripción del parámetro
   * @returns {Promise<string>} - Ruta del archivo de salida
   */
  async procesarArchivo(inputPath, outputDir, options = {}) {
    const {
      parametro = 'valor_default'
    } = options;

    const filename = path.basename(inputPath, '.pdf');
    const timestamp = Date.now();
    const outputPath = path.join(outputDir, `${filename}-procesado-${timestamp}.pdf`);

    console.log(`[NombreService] Procesando con parámetro: ${parametro}`);
    const startTime = Date.now();

    // Lógica del procesamiento aquí

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[NombreService] Completado en ${elapsed}s`);

    // Verificar que el archivo existe
    await fs.access(outputPath);
    return outputPath;
  }

  /**
   * Obtiene configuraciones predefinidas
   * @returns {object} - Objeto con presets disponibles
   */
  getPresets() {
    return {
      preset1: {
        name: 'Nombre del Preset',
        description: 'Descripción clara',
        parametro1: 'valor1'
      }
    };
  }
}

module.exports = new NombreService();
```

### Reglas para Servicios

1. **Usar clases singleton**: `module.exports = new NombreService()`
2. **Logging consistente**: `console.log('[ServiceName] Mensaje')`
3. **Timestamps en archivos**: `${filename}-accion-${Date.now()}.pdf`
4. **Medir tiempos de ejecución**: Para operaciones largas
5. **Verificar salida**: Siempre usar `fs.access()` antes de retornar
6. **JSDoc completo**: Documentar todos los parámetros y retornos

---

## Creación de Rutas

Las rutas manejan requests HTTP y coordinan servicios. Siguen este patrón:

### Template de Ruta

```javascript
const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const { cleanupFiles } = require('../utils/cleanup.utils');
const fileStore = require('../services/file-store.service');
const nombreService = require('../services/nombre.service');
const fs = require('fs').promises;
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const gunzip = promisify(zlib.gunzip);

/**
 * Función helper para descompresión (si es necesario)
 */
async function decompressIfNeeded(buffer, fileName) {
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
    console.log(`[Decompress] Decompressing: ${fileName}`);
    return await gunzip(buffer);
  }
  return buffer;
}

/**
 * @swagger
 * /api/nombre-endpoint:
 *   post:
 *     summary: Descripción corta de lo que hace
 *     tags: [Categoría]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Archivo PDF o comprimido (.gz)
 *               parametro:
 *                 type: string
 *                 description: Descripción del parámetro
 *                 example: valor_ejemplo
 *               fileName:
 *                 type: string
 *                 description: Nombre personalizado para el PDF resultante
 *               compressed:
 *                 type: string
 *                 enum: ['true', 'false']
 *                 description: Indica si el archivo está comprimido con gzip
 *     responses:
 *       200:
 *         description: Operación exitosa
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 fileId:
 *                   type: string
 *                 fileName:
 *                   type: string
 *                 size:
 *                   type: number
 *       400:
 *         description: Parámetros inválidos
 *       500:
 *         description: Error en el servidor
 */
router.post('/', upload.single('file'), async (req, res) => {
  const tempFiles = req.file ? [req.file.path] : [];

  try {
    // 1. VALIDACIÓN INICIAL
    if (!req.file) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'Archivo requerido' });
    }

    // 2. PREPARAR NOMBRE DE SALIDA
    const isCompressed = req.body.compressed === 'true';
    const outputFileName = req.body.fileName ||
      req.file.originalname.replace('.pdf', '-procesado.pdf');

    // 3. DESCOMPRIMIR SI ES NECESARIO
    let fileBuffer = await fs.readFile(req.file.path);
    if (isCompressed || req.file.originalname.endsWith('.gz')) {
      fileBuffer = await decompressIfNeeded(fileBuffer, req.file.originalname);
    }

    // 4. PARSEAR PARÁMETROS
    const options = {
      parametro: req.body.parametro || 'default',
      otroParametro: parseFloat(req.body.otroParametro) || 100
    };

    // 5. VALIDAR PARÁMETROS
    if (options.otroParametro < 0 || options.otroParametro > 100) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({
        error: 'El parámetro debe estar entre 0 y 100'
      });
    }

    // 6. PROCESAR
    const result = await nombreService.procesarArchivo(fileBuffer, options);

    // 7. LIMPIAR ARCHIVOS TEMPORALES
    await cleanupFiles(tempFiles);

    // 8. GUARDAR EN FILE STORE
    const fileId = await fileStore.storeFile(
      Buffer.from(result.pdfBytes),
      outputFileName,
      'application/pdf'
    );

    // 9. RESPONDER
    res.json({
      success: true,
      fileId,
      fileName: outputFileName,
      size: result.pdfBytes.byteLength,
      resultSize: result.pdfBytes.byteLength,
      originalSize: fileBuffer.length,
      // Información adicional específica del endpoint
    });

  } catch (error) {
    console.error('[NombreEndpoint] Error:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({
      error: error.message || 'Error interno'
    });
  }
});

module.exports = router;
```

### Reglas para Rutas

1. **Siempre limpiar archivos**: Llamar `cleanupFiles()` en try/catch
2. **Validar temprano**: Validar parámetros antes de procesar
3. **Usar FileStore**: Para almacenar archivos de descarga
4. **Manejo de compresión**: Soportar archivos .gz
5. **Respuestas consistentes**: Seguir formato estándar (ver sección siguiente)
6. **Logging de errores**: `console.error('[EndpointName] Error:', error)`

---

## Documentación Swagger

### Tags Estándar

Usar estas categorías para agrupar endpoints:

- `[Conversión Office]` - Word, Excel, PowerPoint ↔ PDF
- `[Manipulación PDF]` - Merge, Split, Rotate, Organize
- `[Compresión y Optimización]` - Compress, Grayscale
- `[Seguridad]` - Protect, Unlock, Sign
- `[Procesamiento de Páginas]` - Delete, Process, Extract
- `[OCR]` - Reconocimiento de texto
- `[Marca de Agua]` - Watermarks
- `[Health]` - Estado del servidor

### Template de Documentación Swagger

```javascript
/**
 * @swagger
 * /api/nombre-endpoint:
 *   post:
 *     summary: Descripción corta (50 caracteres max)
 *     description: Descripción detallada del endpoint (opcional)
 *     tags: [Categoría]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Descripción del archivo
 *               parametro:
 *                 type: string|number|boolean
 *                 description: Descripción clara
 *                 default: valor_default
 *                 example: valor_ejemplo
 *                 enum: [opcion1, opcion2]  # Si aplica
 *                 minimum: 0                 # Para números
 *                 maximum: 100               # Para números
 *     responses:
 *       200:
 *         description: Descripción del éxito
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 fileId:
 *                   type: string
 *                   description: ID para descargar desde /api/download/:fileId
 *       400:
 *         description: Error de validación
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Error del servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
```

---

## Respuestas Estándar

### Respuesta Exitosa (200)

**Mínimo requerido:**
```json
{
  "success": true,
  "fileId": "abc123",
  "fileName": "documento.pdf",
  "size": 524288
}
```

**Recomendado incluir:**
```json
{
  "success": true,
  "fileId": "abc123",
  "fileName": "documento.pdf",
  "size": 524288,
  "resultSize": 524288,
  "originalSize": 1048576,
  "pagesProcessed": 10,
  "pageNumbers": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  // Información específica del endpoint
}
```

### Respuesta de Error (400, 500)

```json
{
  "error": "Mensaje de error descriptivo"
}
```

**Con detalles (opcional):**
```json
{
  "error": "Mensaje principal",
  "details": "Información técnica adicional"
}
```

### Reglas para Respuestas

1. **Siempre incluir `success: true`** en respuestas exitosas
2. **Siempre incluir `fileId`** para endpoints que generan archivos
3. **Usar nombres descriptivos**: `originalSize` vs `compressedSize`
4. **Incluir `pageNumbers`** cuando se procesen páginas específicas
5. **Información adicional**: Agregar metadata relevante del proceso

---

## Manejo de Errores

### Patrón Try-Catch

```javascript
router.post('/', upload.single('file'), async (req, res) => {
  const tempFiles = req.file ? [req.file.path] : [];

  try {
    // Código del endpoint

  } catch (error) {
    console.error('[EndpointName] Error:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({
      error: error.message || 'Error interno'
    });
  }
});
```

### Tipos de Errores

**400 - Bad Request** (errores del cliente):
```javascript
if (!validacion) {
  await cleanupFiles(tempFiles);
  return res.status(400).json({ error: 'Mensaje descriptivo' });
}
```

**500 - Internal Server Error** (errores del servidor):
```javascript
catch (error) {
  console.error('[Service] Error:', error);
  await cleanupFiles(tempFiles);
  res.status(500).json({ error: error.message || 'Error interno' });
}
```

### Reglas de Manejo de Errores

1. **Siempre limpiar tempFiles** antes de retornar error
2. **Log descriptivo**: Incluir nombre del servicio/endpoint
3. **No exponer detalles sensibles**: Sanitizar mensajes de error
4. **Return temprano**: Usar `return` después de `res.status(400)`

---

## Validación de Parámetros

### Validación de Archivo

```javascript
// Verificar que existe
if (!req.file) {
  await cleanupFiles(tempFiles);
  return res.status(400).json({ error: 'Archivo requerido' });
}

// Verificar extensión
const originalName = req.file.originalname.replace(/\.gz$/, '');
if (!originalName.match(/\.pdf$/i)) {
  await cleanupFiles(tempFiles);
  return res.status(400).json({ error: 'Solo archivos .pdf' });
}
```

### Validación de Parámetros Numéricos

```javascript
const opacity = parseFloat(req.body.opacity) || 0.5;

if (opacity < 0 || opacity > 1) {
  await cleanupFiles(tempFiles);
  return res.status(400).json({
    error: 'La opacidad debe estar entre 0 y 1'
  });
}
```

### Validación de Arrays/JSON

```javascript
let pages = 'all';
if (req.body.pages && req.body.pages !== 'all') {
  try {
    pages = JSON.parse(req.body.pages);
  } catch (e) {
    await cleanupFiles(tempFiles);
    return res.status(400).json({
      error: 'Formato de páginas inválido'
    });
  }
}
```

### Validación de Enums

```javascript
const validPositions = ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'diagonal', 'custom'];
const position = req.body.position || 'center';

if (!validPositions.includes(position)) {
  await cleanupFiles(tempFiles);
  return res.status(400).json({
    error: `Posición inválida. Opciones: ${validPositions.join(', ')}`
  });
}
```

---

## Limpieza de Archivos

### Patrón Estándar

```javascript
const tempFiles = req.file ? [req.file.path] : [];

try {
  // ... procesamiento ...

  // Agregar archivos temporales adicionales
  tempFiles.push(outputPath);

  // Limpiar ANTES de guardar en FileStore
  await cleanupFiles(tempFiles);

  // Guardar resultado
  const fileId = await fileStore.storeFile(...);

  res.json({ ... });

} catch (error) {
  // Limpiar en caso de error
  await cleanupFiles(tempFiles);
  res.status(500).json({ error: error.message });
}
```

### Para Múltiples Archivos

```javascript
const tempFiles = [];

if (req.files && req.files.file) {
  tempFiles.push(req.files.file[0].path);
}
if (req.files && req.files.watermarkImage) {
  tempFiles.push(req.files.watermarkImage[0].path);
}
```

### Reglas de Limpieza

1. **Crear array tempFiles** al inicio del endpoint
2. **Agregar paths** a medida que se crean archivos temporales
3. **Limpiar en catch**: SIEMPRE limpiar antes de retornar error
4. **Limpiar antes de FileStore**: No incluir el archivo final en tempFiles

---

## Convenciones de Nomenclatura

### Variables y Funciones

```javascript
// camelCase para variables y funciones
const originalSize = 1024;
const outputFileName = 'documento.pdf';

async function procesarArchivo() { }
async function convertToGrayscale() { }
```

### Constantes y Configuración

```javascript
// UPPER_CASE para constantes
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const DEFAULT_TIMEOUT = 120000;

// Objetos de configuración en camelCase
const POSITIONS = {
  center: 'center',
  topLeft: 'top-left'
};
```

### Nombres de Archivos

```javascript
// Usar timestamps para unicidad
const timestamp = Date.now();
const outputPath = `${filename}-procesado-${timestamp}.pdf`;
```

### Logging

```javascript
// Formato: [ServiceName/EndpointName] Mensaje
console.log('[Watermark] Processing with pattern mode');
console.error('[Compress] Error:', error);
console.log(`[Grayscale] Completed in ${elapsed}s`);
```

---

## Registro de Rutas en server.js

### Ubicación por Categoría

Las rutas se agrupan en `server.js` según la herramienta/librería utilizada:

```javascript
// ===== RUTAS LIBREOFFICE =====
app.use('/api/word-to-pdf', uploadLimiter, require('./src/routes/word-to-pdf.route'));

// ===== RUTAS PDF-LIB =====
app.use('/api/merge-pdf', uploadLimiter, require('./src/routes/merge-pdf.route'));
app.use('/api/watermark-pdf', uploadLimiter, require('./src/routes/watermark-pdf.route'));

// ===== RUTAS GHOSTSCRIPT =====
app.use('/api/compress-pdf', uploadLimiter, require('./src/routes/compress-pdf.route'));
```

### Rate Limiters Disponibles

- `apiLimiter` - General (100 req/15min)
- `uploadLimiter` - Para uploads (20 req/15min)
- `ocrLimiter` - Para OCR (5 req/15min)
- `downloadLimiter` - Para descargas (100 req/15min)
- `healthCheckLimiter` - Para health check (200 req/15min)

---

## Checklist para Nuevos Endpoints

- [ ] Crear servicio en `src/services/` siguiendo template
- [ ] Crear ruta en `src/routes/` siguiendo template
- [ ] Agregar documentación Swagger completa
- [ ] Implementar validación de parámetros
- [ ] Agregar manejo de errores con cleanup
- [ ] Soportar archivos comprimidos (.gz)
- [ ] Usar FileStore para guardar resultado
- [ ] Incluir logging descriptivo
- [ ] Retornar respuesta estándar
- [ ] Registrar ruta en `server.js`
- [ ] Agregar tag apropiado en Swagger
- [ ] Usar rate limiter apropiado

---

## Ejemplos Completos

Ver estos archivos como referencia:
- `src/routes/watermark-pdf.route.js` - Endpoint complejo con múltiples opciones
- `src/routes/compress-pdf.route.js` - Endpoint con presets
- `src/services/watermark.service.js` - Servicio con múltiples funciones
- `src/services/ghostscript.service.js` - Servicio tipo clase

---

## Notas Adicionales

### Performance
- Usar `timeout` apropiados en `execFileWithTimeout`
- Medir tiempos de ejecución para operaciones largas
- Limpiar archivos temporales inmediatamente después de usarlos

### Seguridad
- Validar extensiones de archivo
- Limitar tamaños de archivo (configurado en upload middleware)
- No exponer rutas absolutas del servidor en errores
- Sanitizar nombres de archivo

### Mantenibilidad
- Comentarios JSDoc en todos los métodos públicos
- Nombres descriptivos de variables
- Separar lógica de negocio (services) de HTTP (routes)
- Reutilizar funciones comunes (utils)
