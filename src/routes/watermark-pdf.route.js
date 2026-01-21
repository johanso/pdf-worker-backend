const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const { cleanupFiles } = require('../utils/cleanup.utils');
const fileStore = require('../services/file-store.service');
const { addTextWatermark, addImageWatermark, POSITIONS } = require('../services/watermark.service');
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
 * /api/watermark-pdf/text:
 *   post:
 *     summary: Agrega marca de agua de texto a un PDF
 *     tags: [Marca de Agua]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *               - text
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Archivo PDF o comprimido (.gz)
 *               text:
 *                 type: string
 *                 description: Texto de la marca de agua
 *                 example: CONFIDENCIAL
 *               font:
 *                 type: string
 *                 enum: [Helvetica, Helvetica-Bold, Helvetica-Oblique, Helvetica-BoldOblique, Times-Roman, Times-Bold, Times-Italic, Times-BoldItalic, Courier, Courier-Bold, Courier-Oblique, Courier-BoldOblique]
 *                 description: Fuente del texto
 *                 default: Helvetica-Bold
 *                 example: Helvetica-Bold
 *               fontSize:
 *                 type: number
 *                 description: Tamaño de la fuente
 *                 default: 48
 *                 example: 48
 *               color:
 *                 type: string
 *                 description: Color en formato hexadecimal
 *                 default: "#FF0000"
 *                 example: "#FF0000"
 *               opacity:
 *                 type: number
 *                 description: Opacidad (0.0 a 1.0)
 *                 default: 0.5
 *                 minimum: 0
 *                 maximum: 1
 *                 example: 0.5
 *               rotation:
 *                 type: number
 *                 description: Rotación en grados (típicamente 45 para diagonal)
 *                 default: 45
 *                 example: 45
 *               position:
 *                 type: string
 *                 enum: [center, top-left, top-right, bottom-left, bottom-right, diagonal, custom]
 *                 description: Posición de la marca de agua
 *                 default: center
 *                 example: center
 *               customX:
 *                 type: number
 *                 description: Coordenada X personalizada (solo si position=custom)
 *                 example: 100
 *               customY:
 *                 type: number
 *                 description: Coordenada Y personalizada (solo si position=custom)
 *                 example: 100
 *               pattern:
 *                 type: string
 *                 enum: ['true', 'false']
 *                 description: Activar modo patrón repetido por toda la página
 *                 default: 'false'
 *               patternSpacing:
 *                 type: number
 *                 description: Espaciado entre repeticiones en modo patrón
 *                 default: 200
 *                 example: 200
 *               pages:
 *                 type: string
 *                 description: Páginas donde aplicar (ej "all" o "[1,2,3]")
 *                 default: all
 *                 example: all
 *               fileName:
 *                 type: string
 *                 description: Nombre personalizado para el PDF resultante
 *               compressed:
 *                 type: string
 *                 enum: ['true', 'false']
 *                 description: Indica si el archivo está comprimido con gzip
 *     responses:
 *       200:
 *         description: Marca de agua agregada exitosamente
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
 *                   example: abc123def456
 *                 fileName:
 *                   type: string
 *                   example: watermarked.pdf
 *                 size:
 *                   type: number
 *                 resultSize:
 *                   type: number
 *                 originalSize:
 *                   type: number
 *                 pagesProcessed:
 *                   type: number
 *                 pageNumbers:
 *                   type: array
 *                   items:
 *                     type: number
 *       400:
 *         description: Parámetros inválidos
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
router.post('/text', upload.single('file'), async (req, res) => {
  const tempFiles = req.file ? [req.file.path] : [];

  try {
    if (!req.file || !req.body.text) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'Faltan archivo o texto' });
    }

    const isCompressed = req.body.compressed === 'true';
    const outputFileName = req.body.fileName || req.file.originalname.replace('.pdf', '-watermarked.pdf');

    let fileBuffer = await fs.readFile(req.file.path);
    if (isCompressed || req.file.originalname.endsWith('.gz')) {
      fileBuffer = await decompressIfNeeded(fileBuffer, req.file.originalname);
    }

    // Parsear páginas
    let pages = 'all';
    if (req.body.pages && req.body.pages !== 'all') {
      try {
        pages = JSON.parse(req.body.pages);
      } catch (e) {
        await cleanupFiles(tempFiles);
        return res.status(400).json({ error: 'Formato de páginas inválido' });
      }
    }

    // Preparar opciones
    const options = {
      text: req.body.text,
      fontName: req.body.font || 'Helvetica-Bold',
      fontSize: parseFloat(req.body.fontSize) || 48,
      color: req.body.color || '#FF0000',
      opacity: parseFloat(req.body.opacity) || 0.5,
      rotation: parseFloat(req.body.rotation) || 45,
      position: req.body.position || 'center',
      customPosition: {
        x: parseFloat(req.body.customX) || 0,
        y: parseFloat(req.body.customY) || 0
      },
      pattern: req.body.pattern === 'true',
      patternSpacing: parseFloat(req.body.patternSpacing) || 200,
      pages: pages
    };

    // Validar opacidad
    if (options.opacity < 0 || options.opacity > 1) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'La opacidad debe estar entre 0 y 1' });
    }

    // Agregar marca de agua
    const result = await addTextWatermark(fileBuffer, options);
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
      originalSize: fileBuffer.length,
      pagesProcessed: result.pageNumbers.length,
      pageNumbers: result.pageNumbers,
      watermark: {
        type: 'text',
        text: options.text,
        font: options.fontName,
        position: options.position,
        pattern: options.pattern
      }
    });

  } catch (error) {
    console.error('Error adding text watermark:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ error: error.message || 'Error interno' });
  }
});

/**
 * @swagger
 * /api/watermark-pdf/image:
 *   post:
 *     summary: Agrega marca de agua de imagen (logo/sello) a un PDF
 *     tags: [Marca de Agua]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *               - watermarkImage
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Archivo PDF o comprimido (.gz)
 *               watermarkImage:
 *                 type: string
 *                 format: binary
 *                 description: Imagen PNG o JPG para la marca de agua
 *               width:
 *                 type: number
 *                 description: Ancho de la imagen
 *                 default: 200
 *                 example: 200
 *               height:
 *                 type: number
 *                 description: Alto de la imagen (opcional si maintainAspectRatio=true)
 *                 example: 150
 *               opacity:
 *                 type: number
 *                 description: Opacidad (0.0 a 1.0)
 *                 default: 0.5
 *                 minimum: 0
 *                 maximum: 1
 *                 example: 0.5
 *               position:
 *                 type: string
 *                 enum: [center, top-left, top-right, bottom-left, bottom-right, diagonal, custom]
 *                 description: Posición de la marca de agua
 *                 default: center
 *                 example: center
 *               customX:
 *                 type: number
 *                 description: Coordenada X personalizada (solo si position=custom)
 *                 example: 100
 *               customY:
 *                 type: number
 *                 description: Coordenada Y personalizada (solo si position=custom)
 *                 example: 100
 *               maintainAspectRatio:
 *                 type: string
 *                 enum: ['true', 'false']
 *                 description: Mantener la proporción de la imagen
 *                 default: 'true'
 *               pattern:
 *                 type: string
 *                 enum: ['true', 'false']
 *                 description: Activar modo patrón repetido por toda la página
 *                 default: 'false'
 *               patternSpacing:
 *                 type: number
 *                 description: Espaciado entre repeticiones en modo patrón
 *                 default: 250
 *                 example: 250
 *               pages:
 *                 type: string
 *                 description: Páginas donde aplicar (ej "all" o "[1,2,3]")
 *                 default: all
 *                 example: all
 *               fileName:
 *                 type: string
 *                 description: Nombre personalizado para el PDF resultante
 *               compressed:
 *                 type: string
 *                 enum: ['true', 'false']
 *                 description: Indica si el archivo está comprimido con gzip
 *     responses:
 *       200:
 *         description: Marca de agua agregada exitosamente
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
 *                   example: abc123def456
 *                 fileName:
 *                   type: string
 *                   example: watermarked.pdf
 *                 size:
 *                   type: number
 *                 resultSize:
 *                   type: number
 *                 originalSize:
 *                   type: number
 *                 pagesProcessed:
 *                   type: number
 *                 pageNumbers:
 *                   type: array
 *                   items:
 *                     type: number
 *       400:
 *         description: Parámetros inválidos
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
router.post('/image', upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'watermarkImage', maxCount: 1 }
]), async (req, res) => {
  const tempFiles = [];

  try {
    if (!req.files || !req.files.file || !req.files.watermarkImage) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'Faltan archivo PDF o imagen de marca de agua' });
    }

    const pdfFile = req.files.file[0];
    const imageFile = req.files.watermarkImage[0];
    tempFiles.push(pdfFile.path, imageFile.path);

    const isCompressed = req.body.compressed === 'true';
    const outputFileName = req.body.fileName || pdfFile.originalname.replace('.pdf', '-watermarked.pdf');

    let pdfBuffer = await fs.readFile(pdfFile.path);
    if (isCompressed || pdfFile.originalname.endsWith('.gz')) {
      pdfBuffer = await decompressIfNeeded(pdfBuffer, pdfFile.originalname);
    }

    const imageBuffer = await fs.readFile(imageFile.path);

    // Parsear páginas
    let pages = 'all';
    if (req.body.pages && req.body.pages !== 'all') {
      try {
        pages = JSON.parse(req.body.pages);
      } catch (e) {
        await cleanupFiles(tempFiles);
        return res.status(400).json({ error: 'Formato de páginas inválido' });
      }
    }

    // Preparar opciones
    const options = {
      width: parseFloat(req.body.width) || 200,
      height: req.body.height ? parseFloat(req.body.height) : null,
      opacity: parseFloat(req.body.opacity) || 0.5,
      position: req.body.position || 'center',
      customPosition: {
        x: parseFloat(req.body.customX) || 0,
        y: parseFloat(req.body.customY) || 0
      },
      maintainAspectRatio: req.body.maintainAspectRatio !== 'false',
      pattern: req.body.pattern === 'true',
      patternSpacing: parseFloat(req.body.patternSpacing) || 250,
      pages: pages
    };

    // Validar opacidad
    if (options.opacity < 0 || options.opacity > 1) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'La opacidad debe estar entre 0 y 1' });
    }

    // Agregar marca de agua
    const result = await addImageWatermark(pdfBuffer, imageBuffer, options);
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
      originalSize: pdfBuffer.length,
      pagesProcessed: result.pageNumbers.length,
      pageNumbers: result.pageNumbers,
      watermark: {
        type: 'image',
        position: options.position,
        pattern: options.pattern,
        dimensions: {
          width: options.width,
          height: options.height
        }
      }
    });

  } catch (error) {
    console.error('Error adding image watermark:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ error: error.message || 'Error interno' });
  }
});

module.exports = router;
