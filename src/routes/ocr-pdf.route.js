const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const ocrService = require('../services/ocr.service');
const { cleanupFiles } = require('../utils/cleanup.utils');
const fileStore = require('../services/file-store.service');
const path = require('path');
const fs = require('fs').promises;
const zlib = require('zlib');
const { promisify } = require('util');

const gunzip = promisify(zlib.gunzip);

// Helper para obtener el archivo de cualquier campo
function getUploadedFile(req) {
  // Si usamos upload.any(), los archivos están en req.files (array)
  if (req.files && Array.isArray(req.files)) {
    return req.files.find(f => f.fieldname === 'file' || f.fieldname === 'files');
  }
  // Si usamos upload.single(), el archivo está en req.file
  if (req.file) {
    return req.file;
  }
  return null;
}

async function decompressIfNeeded(buffer, fileName) {
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
    console.log(`[Decompress] Decompressing gzip: ${fileName}`);
    return await gunzip(buffer);
  }
  return buffer;
}

/**
 * POST /api/ocr-pdf
 * Aplica OCR a un PDF escaneado
 */
router.post('/', upload.any(), async (req, res) => {
  const file = getUploadedFile(req);
  
  if (!file) {
    return res.status(400).json({ 
      error: 'Archivo PDF requerido',
      debug: { receivedFields: req.files?.map(f => f.fieldname) || [] }
    });
  }

  const tempFiles = [file.path];
  const outputDir = path.join(__dirname, '../../outputs');
  
  try {
    const originalName = file.originalname.replace(/\.gz$/, '');
    if (!originalName.match(/\.pdf$/i)) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'Solo archivos PDF' });
    }

    // Descomprimir si es necesario
    let inputPath = file.path;
    const buffer = await fs.readFile(file.path);
    const decompressed = await decompressIfNeeded(buffer, file.originalname);
    
    if (decompressed !== buffer) {
      inputPath = file.path + '.pdf';
      await fs.writeFile(inputPath, decompressed);
      tempFiles.push(inputPath);
    }

    // Parsear idiomas
    let languages = ['spa', 'eng'];
    if (req.body.languages) {
      if (typeof req.body.languages === 'string') {
        try {
          languages = JSON.parse(req.body.languages);
        } catch (e) {
          languages = req.body.languages.split(',').map(l => l.trim()).filter(Boolean);
        }
      } else if (Array.isArray(req.body.languages)) {
        languages = req.body.languages;
      }
    }

    const dpi = Math.min(600, Math.max(150, parseInt(req.body.dpi) || 300));
    const optimize = req.body.optimize !== 'false';

    console.log(`[OCR Route] Processing: ${originalName}`);
    console.log(`[OCR Route] Languages: ${languages.join('+')}, DPI: ${dpi}, Optimize: ${optimize}`);

    // Realizar OCR
    const outputPath = await ocrService.ocrPdf(inputPath, outputDir, {
      languages,
      dpi,
      optimize
    });
    tempFiles.push(outputPath);

    // Leer resultado y almacenar
    const pdfBuffer = await fs.readFile(outputPath);
    const outputFileName = originalName.replace(/\.pdf$/i, '-ocr.pdf');
    
    const fileId = await fileStore.storeFile(
      pdfBuffer,
      outputFileName,
      'application/pdf'
    );

    await cleanupFiles(tempFiles);

    console.log(`[OCR Route] Success: ${outputFileName} (${pdfBuffer.length} bytes)`);

    res.json({
      success: true,
      fileId,
      fileName: outputFileName,
      size: pdfBuffer.length,
      languages,
      dpi
    });

  } catch (error) {
    console.error('[OCR Route] Error:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ error: 'Error al procesar OCR', details: error.message });
  }
});

/**
 * POST /api/ocr-pdf/detect
 * Detecta si un PDF necesita OCR
 */
router.post('/detect', upload.any(), async (req, res) => {
  const file = getUploadedFile(req);
  
  if (!file) {
    return res.status(400).json({ 
      error: 'Archivo PDF requerido',
      debug: { receivedFields: req.files?.map(f => f.fieldname) || [] }
    });
  }

  const tempFiles = [file.path];
  
  try {
    let inputPath = file.path;
    
    // Descomprimir si es necesario
    const buffer = await fs.readFile(file.path);
    const decompressed = await decompressIfNeeded(buffer, file.originalname);
    
    if (decompressed !== buffer) {
      inputPath = file.path + '.pdf';
      await fs.writeFile(inputPath, decompressed);
      tempFiles.push(inputPath);
    }

    const detection = await ocrService.detectPdfType(inputPath);
    
    await cleanupFiles(tempFiles);

    res.json({
      success: true,
      ...detection,
      recommendation: detection.needsOcr 
        ? 'Este PDF parece ser escaneado. Se recomienda aplicar OCR.'
        : 'Este PDF ya contiene texto seleccionable.'
    });

  } catch (error) {
    console.error('[OCR Detect] Error:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ error: 'Error al analizar PDF', details: error.message });
  }
});

/**
 * GET /api/ocr-pdf/languages
 */
router.get('/languages', async (req, res) => {
  try {
    const installed = await ocrService.getInstalledLanguages();
    
    const languageMap = {
      'spa': 'Español', 'eng': 'English', 'fra': 'Français',
      'deu': 'Deutsch', 'ita': 'Italiano', 'por': 'Português',
      'cat': 'Català', 'nld': 'Nederlands', 'pol': 'Polski',
      'rus': 'Русский', 'chi_sim': '简体中文', 'chi_tra': '繁體中文',
      'jpn': '日本語', 'kor': '한국어', 'ara': 'العربية'
    };

    const languages = installed
      .filter(code => code !== 'osd')
      .map(code => ({
        code,
        name: languageMap[code] || code,
        installed: true
      }));

    res.json({ success: true, languages, installed });

  } catch (error) {
    res.status(500).json({ error: 'Error al obtener idiomas', details: error.message });
  }
});

/**
 * GET /api/ocr-pdf/health
 */
router.get('/health', async (req, res) => {
  try {
    const deps = await ocrService.checkDependencies();
    res.json({
      status: Object.values(deps).every(v => v) ? 'ok' : 'degraded',
      dependencies: deps
    });
  } catch (error) {
    res.status(500).json({ status: 'error', error: error.message });
  }
});

module.exports = router;
