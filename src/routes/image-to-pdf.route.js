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

const PAGE_SIZES = {
  a4: { width: 595, height: 842 },
  letter: { width: 612, height: 792 },
  legal: { width: 612, height: 1008 },
};

const MARGINS = {
  none: 0,
  small: 20,
  normal: 40,
};

async function decompressFileIfNeeded(filePath, originalName, isCompressed) {
  if (!isCompressed && !originalName.endsWith('.gz')) {
    return filePath;
  }

  const buffer = await fs.readFile(filePath);
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
    console.log(`[Decompress] Decompressing: ${originalName}`);
    const decompressed = await gunzip(buffer);
    const newPath = filePath.replace(/\.gz$/, '');
    await fs.writeFile(newPath, decompressed);
    return newPath;
  }
  return filePath;
}

/**
 * @swagger
 * /api/image-to-pdf:
 *   post:
 *     summary: Convierte imágenes a un documento PDF
 *     tags: [Imágenes]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - images
 *             properties:
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: Múltiples imágenes (máximo 200)
 *               pageSize:
 *                 type: string
 *                 enum: [a4, letter, legal, fit]
 *                 description: Tamaño de página para el PDF
 *                 default: a4
 *               orientation:
 *                 type: string
 *                 enum: [auto, portrait, landscape]
 *                 description: Orientación de las páginas
 *                 default: auto
 *               margin:
 *                 type: string
 *                 enum: [none, small, normal]
 *                 description: Márgenes del documento
 *                 default: small
 *               quality:
 *                 type: string
 *                 enum: [original, compressed]
 *                 description: Calidad de las imágenes
 *                 default: original
 *               rotations:
 *                 type: string
 *                 description: Rotaciones en grados separadas por comas (0,90,180,270)
 *               fileName:
 *                 type: string
 *                 description: Nombre personalizado para el PDF
 *               compressed:
 *                 type: string
 *                 enum: ['true', 'false']
 *                 description: Indica si las imágenes están comprimidas con gzip
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
 *                   description: ID para descargar desde /api/download/:fileId
 *                   example: abc123def456
 *                 fileName:
 *                   type: string
 *                   example: images-to-pdf.pdf
 *                 size:
 *                   type: number
 *                 totalImages:
 *                   type: number
 *       400:
 *         description: Sin imágenes o configuración inválida
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
router.post('/', upload.array('images', 200), async (req, res) => {
  const tempFiles = [];
  const outputDir = path.join(__dirname, '../../outputs');
  
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Se requieren imágenes' });
    }

    const isCompressed = req.body.compressed === 'true';
    const files = req.files;
    tempFiles.push(...files.map(f => f.path));

    const pageSize = req.body.pageSize || 'a4';
    const orientation = req.body.orientation || 'auto';
    const margin = req.body.margin || 'small';
    const quality = req.body.quality || 'original';
    
    let rotations = [];
    if (req.body.rotations) {
      if (Array.isArray(req.body.rotations)) {
        rotations = req.body.rotations.map(r => parseInt(r) || 0);
      } else {
        rotations = req.body.rotations.split(',').map(r => parseInt(r) || 0);
      }
    }

    const outputFileName = req.body.fileName || 'images-to-pdf.pdf';
    const marginPx = MARGINS[margin] || MARGINS.small;
    const timestamp = Date.now();
    const outputPath = path.join(outputDir, 'images-' + timestamp + '.pdf');

    const processedImages = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const rotation = rotations[i] || 0;
      
      // Descomprimir si es necesario
      let imagePath = await decompressFileIfNeeded(file.path, file.originalname, isCompressed);
      if (imagePath !== file.path) {
        tempFiles.push(imagePath);
      }

      if (rotation !== 0) {
        const ext = file.originalname.replace(/\.gz$/, '').split('.').pop().toLowerCase();
        const rotatedPath = imagePath + '-rotated.' + ext;
        await execAsync('convert "' + imagePath + '" -rotate ' + rotation + ' "' + rotatedPath + '"');
        tempFiles.push(rotatedPath);
        imagePath = rotatedPath;
      }

      if (quality === 'compressed') {
        const compressedPath = imagePath + '-compressed.jpg';
        await execAsync('convert "' + imagePath + '" -quality 80 "' + compressedPath + '"');
        tempFiles.push(compressedPath);
        imagePath = compressedPath;
      }

      processedImages.push(imagePath);
    }

    if (pageSize === 'fit') {
      const marginArg = marginPx > 0 ? '-border ' + marginPx + ' -bordercolor white' : '';
      const imagesList = processedImages.map(function(p) { return '"' + p + '"'; }).join(' ');
      await execAsync('convert ' + imagesList + ' ' + marginArg + ' -quality 95 "' + outputPath + '"');
    } else {
      const size = PAGE_SIZES[pageSize] || PAGE_SIZES.a4;
      const pdfPages = [];
      
      for (let i = 0; i < processedImages.length; i++) {
        const imgPath = processedImages[i];
        const pagePath = path.join(outputDir, 'page-' + timestamp + '-' + i + '.pdf');
        tempFiles.push(pagePath);

        const identifyResult = await execAsync('identify -format "%w %h" "' + imgPath + '"');
        const dims = identifyResult.stdout.trim().split(' ');
        const imgWidth = parseInt(dims[0]);
        const imgHeight = parseInt(dims[1]);

        let pageWidth = size.width;
        let pageHeight = size.height;

        if (orientation === 'landscape') {
          const temp = pageWidth;
          pageWidth = pageHeight;
          pageHeight = temp;
        } else if (orientation === 'auto') {
          const imgRatio = imgWidth / imgHeight;
          const portraitRatio = size.width / size.height;
          
          if (imgRatio > 1 && portraitRatio < 1) {
            const temp = pageWidth;
            pageWidth = pageHeight;
            pageHeight = temp;
          }
        }

        const availableWidth = pageWidth - marginPx * 2;
        const availableHeight = pageHeight - marginPx * 2;

        const convertCmd = 'convert "' + imgPath + '" ' +
          '-resize ' + availableWidth + 'x' + availableHeight + ' ' +
          '-gravity center ' +
          '-background white ' +
          '-extent ' + pageWidth + 'x' + pageHeight + ' ' +
          '-units PixelsPerInch ' +
          '-density 72 ' +
          '"' + pagePath + '"';
        
        await execAsync(convertCmd);
        pdfPages.push(pagePath);
      }

      if (pdfPages.length === 1) {
        await fs.copyFile(pdfPages[0], outputPath);
      } else {
        try {
          const pagesList = pdfPages.map(function(p) { return '"' + p + '"'; }).join(' ');
          await execAsync('pdfunite ' + pagesList + ' "' + outputPath + '"');
        } catch (e) {
          const pagesList = pdfPages.map(function(p) { return '"' + p + '"'; }).join(' ');
          await execAsync('convert ' + pagesList + ' "' + outputPath + '"');
        }
      }
    }

    await fs.access(outputPath);
    tempFiles.push(outputPath);

    const pdfBuffer = await fs.readFile(outputPath);
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
      size: pdfBuffer.length,
      resultSize: pdfBuffer.length,
      totalImages: files.length
    });

  } catch (error) {
    console.error('Error Image to PDF:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ 
      error: 'Error al crear PDF', 
      details: error.message 
    });
  }
});

/**
 * @swagger
 * /api/image-to-pdf/info:
 *   get:
 *     summary: Obtiene información sobre formatos y opciones soportados
 *     tags: [Imágenes]
 *     responses:
 *       200:
 *         description: Información de configuración disponible
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 supportedFormats:
 *                   type: array
 *                   items:
 *                     type: string
 *                 pageSizes:
 *                   type: array
 *                   items:
 *                     type: string
 *                 orientations:
 *                   type: array
 *                   items:
 *                     type: string
 *                 margins:
 *                   type: array
 *                   items:
 *                     type: string
 *                 qualities:
 *                   type: array
 *                   items:
 *                     type: string
 *                 limits:
 *                   type: object
 *                   properties:
 *                     maxImages:
 *                       type: number
 *                     maxFileSize:
 *                       type: string
 */
router.get('/info', function(req, res) {
  res.json({
    supportedFormats: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff'],
    pageSizes: ['a4', 'letter', 'legal', 'fit'],
    orientations: ['auto', 'portrait', 'landscape'],
    margins: ['none', 'small', 'normal'],
    qualities: ['original', 'compressed'],
    limits: {
      maxImages: 200,
      maxFileSize: '100MB per image',
    }
  });
});

module.exports = router;