const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const libreOfficeService = require('../services/libreoffice.service');
const { execAsync } = require('../utils/file.utils');
const { cleanupFiles } = require('../utils/cleanup.utils');
const path = require('path');
const fs = require('fs').promises;
const zlib = require('zlib');
const { promisify } = require('util');

const gunzip = promisify(zlib.gunzip);

async function decompressIfNeeded(buffer, fileName) {
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
    console.log(`[Preview] Decompressing: ${fileName}`);
    return await gunzip(buffer);
  }
  return buffer;
}

/**
 * Genera un preview (imagen PNG) de la primera página de un archivo Office
 * POST /api/preview/office
 * Body: file (multipart/form-data)
 * Returns: PNG image
 */
router.post('/', upload.single('file'), async (req, res) => {
  const tempFiles = req.file ? [req.file.path] : [];
  const outputDir = path.join(__dirname, '../../outputs');
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Archivo requerido' });
    }

    const originalName = req.file.originalname.replace(/\.gz$/, '');
    const ext = originalName.toLowerCase().split('.').pop();
    
    // Validar que sea un archivo Office
    const validExtensions = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
    if (!validExtensions.includes(ext)) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'Solo archivos de Office (.doc, .docx, .xls, .xlsx, .ppt, .pptx)' });
    }

    const isCompressed = req.body.compressed === 'true';
    let inputPath = req.file.path;

    // Descomprimir si es necesario
    if (isCompressed || req.file.originalname.endsWith('.gz')) {
      const buffer = await fs.readFile(req.file.path);
      const decompressed = await decompressIfNeeded(buffer, req.file.originalname);
      if (decompressed !== buffer) {
        inputPath = req.file.path + '.' + ext;
        await fs.writeFile(inputPath, decompressed);
        tempFiles.push(inputPath);
      }
    }

    // Paso 1: Convertir a PDF usando LibreOffice
    console.log('[Preview] Converting to PDF:', originalName);
    const pdfPath = await libreOfficeService.wordToPdf(inputPath, outputDir);
    tempFiles.push(pdfPath);

    // Paso 2: Extraer primera página como imagen PNG de alta calidad
    const timestamp = Date.now();
    const previewPath = path.join(outputDir, `preview-${timestamp}.png`);
    
    console.log('[Preview] Generating PNG from first page');
    
    // Usar Ghostscript para convertir primera página a PNG de alta calidad
    // 150 DPI es suficiente para preview
    await execAsync(
      `gs -dNOPAUSE -dBATCH -dSAFER -sDEVICE=png16m ` +
      `-r150 -dFirstPage=1 -dLastPage=1 ` +
      `-sOutputFile="${previewPath}" "${pdfPath}"`
    );

    tempFiles.push(previewPath);

    // Verificar que se creó la imagen
    await fs.access(previewPath);
    
    const imageBuffer = await fs.readFile(previewPath);
    
    // Limpiar archivos temporales
    await cleanupFiles(tempFiles);

    // Devolver imagen PNG
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600'); // Cachear 1 hora
    res.send(imageBuffer);

    console.log('[Preview] Success:', originalName, '→', imageBuffer.length, 'bytes');
    
  } catch (error) {
    console.error('[Preview] Error:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ 
      error: 'Error al generar preview', 
      details: error.message 
    });
  }
});

module.exports = router;