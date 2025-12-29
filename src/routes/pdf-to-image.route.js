const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const { validatePdf } = require('../middleware/pdf-validation.middleware');
const { execAsync } = require('../utils/file.utils');
const { cleanupFiles } = require('../utils/cleanup.utils');
const path = require('path');
const fs = require('fs').promises;
const archiver = require('archiver');

router.post('/', upload.single('file'), validatePdf, async (req, res) => {
  const inputPath = req.file?.path;
  const outputDir = path.join(__dirname, '../../outputs');
  const tempFiles = inputPath ? [inputPath] : [];
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Archivo PDF requerido' });
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
    
    if (outputFiles.length === 1) {
      const mimeTypes = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
        webp: 'image/webp', tiff: 'image/tiff', bmp: 'image/bmp'
      };
      
      res.setHeader('Content-Type', mimeTypes[format] || 'application/octet-stream');
      return res.sendFile(outputFiles[0].path, async () => {
        await cleanupFiles(tempFiles);
      });
    }
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="pdf-images.zip"');
    
    const archive = archiver('zip', { zlib: { level: 5 } });
    
    archive.on('error', async (err) => {
      console.error('Error ZIP:', err);
      await cleanupFiles(tempFiles);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error creando ZIP' });
      }
    });
    
    archive.on('end', async () => {
      await cleanupFiles(tempFiles);
    });
    
    archive.pipe(res);
    
    for (const file of outputFiles) {
      archive.file(file.path, { name: file.filename });
    }
    
    await archive.finalize();
    
  } catch (error) {
    console.error('Error PDF→Image:', error);
    await cleanupFiles(tempFiles);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error al convertir', details: error.message });
    }
  }
});

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
