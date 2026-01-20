const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const { execAsync } = require('../utils/file.utils');
const { cleanupFiles } = require('../utils/cleanup.utils');
const fileStore = require('../services/file-store.service');
const path = require('path');
const fs = require('fs').promises;
const archiver = require('archiver');
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
 * /api/pdf-to-image:
 *   post:
 *     summary: Convierte páginas de PDF a imágenes (JPG, PNG, WebP, TIFF, BMP)
 *     tags: [Imágenes]
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
 *               format:
 *                 type: string
 *                 enum: [jpg, png, webp, tiff, bmp]
 *                 description: Formato de imagen deseado
 *                 default: jpg
 *               quality:
 *                 type: string
 *                 description: Calidad de la imagen de 1 a 100 (para JPG y WebP)
 *                 default: '90'
 *               dpi:
 *                 type: string
 *                 enum: ['72', '150', '300', '600']
 *                 description: Resolución de las imágenes en puntos por pulgada
 *                 default: '150'
 *               pages:
 *                 type: string
 *                 description: Páginas a convertir (all, 1-5, 1,3,5)
 *                 default: all
 *               fileName:
 *                 type: string
 *                 description: Nombre personalizado para las imágenes
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
 *                   description: ID para descargar desde /api/download/:fileId
 *                   example: abc123def456
 *                 fileName:
 *                   type: string
 *                   description: Una imagen si hay 1 página o archivo ZIP si hay múltiples
 *                 size:
 *                   type: number
 *                 imagesCount:
 *                   type: number
 *                   description: Cantidad de imágenes generadas
 *       400:
 *         description: Formato no soportado o configuración inválida
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
router.post('/', upload.single('file'), async (req, res) => {  const tempFiles = req.file ? [req.file.path] : [];
  const outputDir = path.join(__dirname, '../../outputs');
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Archivo PDF requerido' });
    }

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
    
    const format = req.body.format || 'jpg';
    const quality = Math.min(100, Math.max(1, parseInt(req.body.quality) || 90));
    const dpi = parseInt(req.body.dpi) || 150;
    const pagesParam = req.body.pages || 'all';
    
    const validFormats = ['jpg', 'jpeg', 'png', 'webp', 'tiff', 'bmp'];
    if (!validFormats.includes(format.toLowerCase())) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'Formato no soportado: ' + format });
    }

    const outputFileName = req.body.fileName || 'pdf-images';
    const validDpi = [72, 150, 300, 600];
    const finalDpi = validDpi.includes(dpi) ? dpi : 150;
    
    const pageCountResult = await execAsync('pdfinfo "' + inputPath + '" | grep "Pages:" | awk \'{print $2}\'');
    const totalPages = parseInt(pageCountResult.stdout.trim()) || 1;
    
    let pageNumbers = [];
    if (pagesParam === 'all') {
      pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);
    } else if (pagesParam.includes('-')) {
      const [start, end] = pagesParam.split('-').map(Number);
      for (let i = start; i <= Math.min(end, totalPages); i++) {
        if (i >= 1) pageNumbers.push(i);
      }
    } else if (pagesParam.includes(',')) {
      pageNumbers = pagesParam.split(',').map(Number).filter(n => n >= 1 && n <= totalPages);
    } else {
      const pageNum = parseInt(pagesParam);
      if (pageNum >= 1 && pageNum <= totalPages) {
        pageNumbers = [pageNum];
      }
    }
    
    if (pageNumbers.length === 0) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'No hay páginas válidas' });
    }
    
    if (pageNumbers.length > 100) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'Máximo 100 páginas' });
    }
    
    const timestamp = Date.now();
    const ext = format === 'jpeg' ? 'jpg' : format;
    
    let gsDevice;
    switch (format.toLowerCase()) {
      case 'jpg':
      case 'jpeg':
        gsDevice = 'jpeg';
        break;
      case 'png':
        gsDevice = 'png16m';
        break;
      case 'tiff':
        gsDevice = 'tiff24nc';
        break;
      case 'bmp':
        gsDevice = 'bmp16m';
        break;
      default:
        gsDevice = 'jpeg';
    }
    
    const outputFiles = [];
    const BATCH_SIZE = 5;
    
    for (let i = 0; i < pageNumbers.length; i += BATCH_SIZE) {
      const batch = pageNumbers.slice(i, i + BATCH_SIZE);
      
      const promises = batch.map(async (pageNum) => {
        const outputFilename = 'page-' + String(pageNum).padStart(3, '0') + '-' + timestamp + '.' + ext;
        const outputPath = path.join(outputDir, outputFilename);
        
        try {
          if (format === 'webp') {
            const tempPng = path.join(outputDir, 'temp-' + pageNum + '-' + timestamp + '.png');
            
            await execAsync(
              'gs -dNOPAUSE -dBATCH -dSAFER -sDEVICE=png16m ' +
              '-r' + finalDpi + ' -dFirstPage=' + pageNum + ' -dLastPage=' + pageNum + ' ' +
              '-sOutputFile="' + tempPng + '" "' + inputPath + '"'
            );
            
            await execAsync('convert "' + tempPng + '" -quality ' + quality + ' "' + outputPath + '"');
            await fs.unlink(tempPng).catch(() => {});
          } else {
            const qualityParam = ['jpg', 'jpeg'].includes(format.toLowerCase()) 
              ? '-dJPEGQ=' + quality : '';
            
            await execAsync(
              'gs -dNOPAUSE -dBATCH -dSAFER -sDEVICE=' + gsDevice + ' ' +
              '-r' + finalDpi + ' ' + qualityParam + ' ' +
              '-dFirstPage=' + pageNum + ' -dLastPage=' + pageNum + ' ' +
              '-sOutputFile="' + outputPath + '" "' + inputPath + '"'
            );
          }
          
          await fs.access(outputPath);
          return { pageNum, path: outputPath, filename: 'page-' + pageNum + '.' + ext };
        } catch (e) {
          console.error('Error página ' + pageNum + ':', e.message);
          return null;
        }
      });
      
      const results = await Promise.all(promises);
      outputFiles.push(...results.filter(Boolean));
    }
    
    if (outputFiles.length === 0) {
      await cleanupFiles(tempFiles);
      return res.status(500).json({ error: 'No se pudieron convertir las páginas' });
    }
    
    outputFiles.sort((a, b) => a.pageNum - b.pageNum);
    tempFiles.push(...outputFiles.map(f => f.path));
    
    // Una sola imagen
    if (outputFiles.length === 1) {
      const imageBuffer = await fs.readFile(outputFiles[0].path);
      const mimeTypes = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
        webp: 'image/webp', tiff: 'image/tiff', bmp: 'image/bmp'
      };

      const finalFileName = `${outputFileName}.${ext}`; 
      
      const fileId = await fileStore.storeFile(
        imageBuffer,
        finalFileName,
        mimeTypes[format] || 'application/octet-stream'
      );

      await cleanupFiles(tempFiles);

      return res.json({
        success: true,
        fileId,
        fileName: finalFileName,
        size: imageBuffer.length,
        resultSize: imageBuffer.length,
      });
    }
    
    // Múltiples imágenes - crear ZIP en memoria
    const zipPath = path.join(outputDir, 'pdf-images-' + timestamp + '.zip');
    
    await new Promise((resolve, reject) => {
      const output = require('fs').createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 5 } });
      
      output.on('close', resolve);
      archive.on('error', reject);
      
      archive.pipe(output);
      
      for (const file of outputFiles) {
        archive.file(file.path, { name: file.filename });
      }
      
      archive.finalize();
    });

    tempFiles.push(zipPath);
    
    const zipBuffer = await fs.readFile(zipPath);

    const finalZipName = `${outputFileName}.zip`;

    const fileId = await fileStore.storeFile(
      zipBuffer,
      finalZipName,
      'application/zip'
    );

    await cleanupFiles(tempFiles);

    res.json({
      success: true,
      fileId,
      fileName: finalZipName,
      size: zipBuffer.length,
      resultSize: zipBuffer.length,
      imagesCount: outputFiles.length
    });
    
  } catch (error) {
    console.error('Error PDF→Image:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ error: 'Error al convertir', details: error.message });
  }
});

/**
 * @swagger
 * /api/pdf-to-image/formats:
 *   get:
 *     summary: Obtiene formatos de imagen soportados y opciones disponibles
 *     tags: [Imágenes]
 *     responses:
 *       200:
 *         description: Lista de formatos y opciones
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 formats:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       label:
 *                         type: string
 *                       mimeType:
 *                         type: string
 *                       supportsQuality:
 *                         type: boolean
 *                 dpiOptions:
 *                   type: array
 *                   items:
 *                     type: number
 *                 limits:
 *                   type: object
 *                   properties:
 *                     maxPages:
 *                       type: number
 *                     maxFileSize:
 *                       type: string
 */
router.get('/formats', (req, res) => {
  res.json({
    formats: [
      { id: 'jpg', label: 'JPEG', mimeType: 'image/jpeg', supportsQuality: true },
      { id: 'png', label: 'PNG', mimeType: 'image/png', supportsQuality: false },
      { id: 'webp', label: 'WebP', mimeType: 'image/webp', supportsQuality: true },
      { id: 'tiff', label: 'TIFF', mimeType: 'image/tiff', supportsQuality: false },
      { id: 'bmp', label: 'BMP', mimeType: 'image/bmp', supportsQuality: false },
    ],
    dpiOptions: [72, 150, 300, 600],
    limits: { maxPages: 100, maxFileSize: '100MB' }
  });
});

module.exports = router;