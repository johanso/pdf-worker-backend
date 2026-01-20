const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const ghostscriptService = require('../services/ghostscript.service');
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
 * /api/grayscale-pdf:
 *   post:
 *     summary: Convierte un PDF a escala de grises con control de contraste
 *     tags: [Compresión y Optimización]
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
 *               contrast:
 *                 type: string
 *                 enum: [light, normal, high, extreme]
 *                 description: Nivel de contraste de la conversión
 *                 default: normal
 *               fileName:
 *                 type: string
 *                 description: Nombre personalizado para el PDF resultante
 *               compressed:
 *                 type: string
 *                 enum: ['true', 'false']
 *                 description: Indica si el archivo está comprimido con gzip
 *     responses:
 *       200:
 *         description: Conversión exitosa
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
 *                 savings:
 *                   type: number
 *                   description: Bytes ahorrados
 *                 contrast:
 *                   type: string
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

    // Obtener nivel de contraste
    const contrast = req.body.contrast || 'normal';
    const validContrasts = ['light', 'normal', 'high', 'extreme'];
    const finalContrast = validContrasts.includes(contrast) ? contrast : 'normal';

    // Convertir a escala de grises con contraste
    const outputPath = await ghostscriptService.convertToGrayscale(inputPath, outputDir, {
      contrast: finalContrast
    });
    tempFiles.push(outputPath);
    
    // Obtener tamaño resultante
    const resultStats = await fs.stat(outputPath);
    const resultSize = resultStats.size;

    // Guardar en file store
    const pdfBuffer = await fs.readFile(outputPath);
    const outputFileName = req.body.fileName || originalName.replace(/\.pdf$/i, '-grayscale.pdf');
    
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
      savings: originalSize > resultSize ? originalSize - resultSize : 0,
      contrast: finalContrast
    });
    
  } catch (error) {
    console.error('[Grayscale] Error:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ error: 'Error al convertir a escala de grises', details: error.message });
  }
});

/**
 * @swagger
 * /api/grayscale-pdf/info:
 *   get:
 *     summary: Obtiene información sobre opciones de conversión a escala de grises
 *     tags: [Compresión y Optimización]
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
 *                 benefits:
 *                   type: array
 *                   items:
 *                     type: string
 *                 contrastOptions:
 *                   type: array
 *                   items:
 *                     type: object
 *                 limits:
 *                   type: object
 */
router.get('/info', (req, res) => {
  res.json({
    description: 'Convierte PDFs a escala de grises con control de contraste',
    benefits: [
      'Ahorra tinta al imprimir',
      'Reduce tamaño del archivo en algunos casos',
      'Ideal para documentos de texto'
    ],
    contrastOptions: [
      { value: 'light', label: 'Claro', description: 'Tonos más suaves, ideal para fondos oscuros' },
      { value: 'normal', label: 'Normal', description: 'Conversión estándar a escala de grises', default: true },
      { value: 'high', label: 'Alto contraste', description: 'Textos más definidos y negros intensos' },
      { value: 'extreme', label: 'Máximo contraste', description: 'Casi blanco y negro puro, ideal para escaneos' }
    ],
    limits: {
      maxFileSize: '150MB'
    }
  });
});

module.exports = router;