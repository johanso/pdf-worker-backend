const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const { execAsync } = require('../utils/file.utils');
const { cleanupFiles } = require('../utils/cleanup.utils');
const fileStore = require('../services/file-store.service');
const path = require('path');
const fs = require('fs').promises;
const zlib = require('zlib');
const { promisify } = require('util');

const gunzip = promisify(zlib.gunzip);

async function decompressIfNeeded(buffer, fileName) {
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
    console.log(`[Decompress] Decompressing: ${fileName}`);
    return await gunzip(buffer);
  }
  return buffer;
}

/**
 * @swagger
 * /api/flatten-pdf:
 *   post:
 *     summary: Aplana un PDF convirtiendo elementos interactivos en contenido estático
 *     tags: [Manipulación PDF]
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
 *               mode:
 *                 type: string
 *                 enum: [all, forms, annotations]
 *                 description: Qué elementos aplanar
 *                 default: all
 *               compress:
 *                 type: string
 *                 enum: ['true', 'false']
 *                 description: Comprimir el resultado después de aplanar
 *                 default: 'true'
 *               fileName:
 *                 type: string
 *                 description: Nombre personalizado para el PDF resultante
 *               compressed:
 *                 type: string
 *                 enum: ['true', 'false']
 *                 description: Indica si el archivo está comprimido con gzip
 *     responses:
 *       200:
 *         description: Aplanamiento exitoso
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
 *                 originalSize:
 *                   type: number
 *                 resultSize:
 *                   type: number
 *                 reduction:
 *                   type: number
 *                 mode:
 *                   type: string
 *                 compressed:
 *                   type: boolean
 *       400:
 *         description: Archivo inválido
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Error en el servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/', upload.single('file'), async (req, res) => {
  const tempFiles = req.file ? [req.file.path] : [];
  const outputDir = path.join(__dirname, '../../outputs');
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Archivo PDF requerido' });
    }

    const originalName = req.file.originalname.replace(/\.gz$/, '');
    if (!originalName.match(/\.pdf$/i)) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'Solo archivos .pdf' });
    }

    // Descomprimir si es necesario
    const isCompressed = req.body.compressed === 'true';
    let inputPath = req.file.path;

    if (isCompressed || req.file.originalname.endsWith('.gz')) {
      const buffer = await fs.readFile(req.file.path);
      const decompressed = await decompressIfNeeded(buffer, req.file.originalname);
      if (decompressed !== buffer) {
        inputPath = req.file.path + '.pdf';
        await fs.writeFile(inputPath, decompressed);
        tempFiles.push(inputPath);
      }
    }
    
    // Obtener tamaño original
    const originalStats = await fs.stat(inputPath);
    const originalSize = originalStats.size;

    // Opciones
    const mode = req.body.mode || 'all';
    const shouldCompress = req.body.compress !== 'false';
    
    const validModes = ['all', 'forms', 'annotations'];
    const finalMode = validModes.includes(mode) ? mode : 'all';

    const startTime = Date.now();

    const timestamp = Date.now();
    const outputPath = path.join(outputDir, `${path.basename(inputPath, '.pdf')}-flattened-${timestamp}.pdf`);

    // pdftk es más confiable para flatten
    // El comando flatten aplana formularios Y anotaciones
    if (finalMode === 'all' || finalMode === 'forms') {
      // pdftk flatten: aplana todo (formularios + anotaciones)
      const cmd = `pdftk "${inputPath}" output "${outputPath}" flatten`;
      await execAsync(cmd);
    } else if (finalMode === 'annotations') {
      // Para solo anotaciones, usamos Ghostscript (pdftk no tiene esta opción granular)
      const cmd = `gs -sDEVICE=pdfwrite \
        -dCompatibilityLevel=1.4 \
        -dNOPAUSE -dQUIET -dBATCH \
        -dFlattenForms=false \
        -dFlattenAnnots=true \
        -dPreserveAnnots=false \
        -sOutputFile="${outputPath}" \
        "${inputPath}"`;
      await execAsync(cmd);
    }

    tempFiles.push(outputPath);

    // Comprimir si se solicitó
    let finalPath = outputPath;
    if (shouldCompress) {
      const compressedPath = path.join(outputDir, `${path.basename(inputPath, '.pdf')}-flattened-compressed-${timestamp}.pdf`);
      const compressCmd = `gs -sDEVICE=pdfwrite \
        -dCompatibilityLevel=1.4 \
        -dPDFSETTINGS=/printer \
        -dNOPAUSE -dQUIET -dBATCH \
        -sOutputFile="${compressedPath}" \
        "${outputPath}"`;
      
      try {
        await execAsync(compressCmd);
        tempFiles.push(compressedPath);
        
        // Solo usar comprimido si es más pequeño
        const compressedStats = await fs.stat(compressedPath);
        const flattenedStats = await fs.stat(outputPath);
        
        if (compressedStats.size < flattenedStats.size) {
          finalPath = compressedPath;
        }
      } catch (e) {
        console.log('[Flatten] Compression skipped:', e.message);
      }
    }
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Flatten] Completed in ${elapsed}s`);

    // Obtener tamaño resultante
    const resultStats = await fs.stat(finalPath);
    const resultSize = resultStats.size;

    // Guardar en file store
    const pdfBuffer = await fs.readFile(finalPath);
    const outputFileName = req.body.fileName || originalName.replace(/\.pdf$/i, '-flattened.pdf');
    
    const fileId = await fileStore.storeFile(
      pdfBuffer,
      outputFileName,
      'application/pdf'
    );

    await cleanupFiles(tempFiles);

    res.json({
      success: true,
      fileId,
      fileName: outputFileName,
      originalSize,
      resultSize,
      reduction: originalSize > resultSize ? originalSize - resultSize : 0,
      mode: finalMode,
      compressed: shouldCompress
    });
    
  } catch (error) {
    console.error('[Flatten] Error:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ error: 'Error al aplanar PDF', details: error.message });
  }
});

/**
 * @swagger
 * /api/flatten-pdf/info:
 *   get:
 *     summary: Obtiene información sobre opciones de aplanamiento
 *     tags: [Manipulación PDF]
 *     responses:
 *       200:
 *         description: Información de configuración
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 description:
 *                   type: string
 *                 useCases:
 *                   type: array
 *                   items:
 *                     type: string
 *                 modeOptions:
 *                   type: array
 *                   items:
 *                     type: object
 *                 compressOption:
 *                   type: object
 *                 limits:
 *                   type: object
 *                 engine:
 *                   type: string
 */
router.get('/info', (req, res) => {
  res.json({
    description: 'Aplana PDFs convirtiendo elementos interactivos en contenido estático',
    useCases: [
      'Enviar formularios llenados sin que puedan modificarlos',
      'Eliminar comentarios y anotaciones visualmente',
      'Preparar documentos para impresión',
      'Reducir problemas de compatibilidad entre lectores'
    ],
    modeOptions: [
      { 
        value: 'all', 
        label: 'Aplanar todo', 
        description: 'Formularios, anotaciones, comentarios y capas',
        default: true 
      },
      { 
        value: 'forms', 
        label: 'Solo formularios', 
        description: 'Convierte campos editables en texto fijo' 
      },
      { 
        value: 'annotations', 
        label: 'Solo anotaciones', 
        description: 'Aplana comentarios, notas adhesivas y marcas' 
      }
    ],
    compressOption: {
      description: 'Optimiza el tamaño del archivo después de aplanar',
      default: true
    },
    limits: {
      maxFileSize: '150MB'
    },
    engine: 'pdftk + ghostscript'
  });
});

module.exports = router;