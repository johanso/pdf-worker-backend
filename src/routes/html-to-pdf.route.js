const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const playwrightService = require('../services/playwright.service');
const { cleanupFiles } = require('../utils/cleanup.utils');
const fileStore = require('../services/file-store.service');
const path = require('path');
const fs = require('fs').promises;

router.post('/', upload.single('file'), async (req, res) => {
  let inputPath;
  const outputDir = path.join(__dirname, '../../outputs');
  const tempFiles = [];
  
  try {
    const isUrl = req.body.isUrl === 'true';
    
    if (isUrl) {
      inputPath = req.body.url;
      if (!inputPath) {
        return res.status(400).json({ error: 'URL requerida' });
      }
      try {
        new URL(inputPath);
      } catch (e) {
        return res.status(400).json({ error: 'URL inválida' });
      }
    } else {
      if (!req.file) {
        return res.status(400).json({ error: 'Archivo HTML requerido' });
      }
      inputPath = req.file.path;
      tempFiles.push(inputPath);
    }
    
    let viewport = { width: 1440, height: 900 };
    if (req.body.viewport) {
      try {
        viewport = JSON.parse(req.body.viewport);
      } catch (e) {}
    }
    
    let margin = { top: 20, right: 20, bottom: 20, left: 20 };
    const marginData = req.body.margins || req.body.margin;
    if (marginData) {
      try {
        margin = JSON.parse(marginData);
      } catch (e) {}
    }
    
    const options = {
      isUrl,
      format: req.body.pageFormat || 'A4',
      landscape: req.body.landscape === 'true',
      viewport: viewport,
      margin: margin
    };
    
    const outputPath = await playwrightService.htmlToPdf(inputPath, outputDir, options);
    const pdfBuffer = await fs.readFile(outputPath);
    tempFiles.push(outputPath);
    await cleanupFiles(tempFiles);

    const fileName = isUrl ? 'webpage.pdf' : req.file.originalname.replace(/\.html?$/i, '.pdf');
    const fileId = await fileStore.storeFile(pdfBuffer, fileName, 'application/pdf');

    res.json({ success: true, fileId, fileName });
    
  } catch (error) {
    console.error('Error HTML→PDF:', error);
    await cleanupFiles(tempFiles);
    
    let errorMessage = 'Error al convertir';
    if (error.message.includes('net::ERR_NAME_NOT_RESOLVED')) {
      errorMessage = 'No se pudo acceder a la URL.';
    } else if (error.message.includes('Timeout')) {
      errorMessage = 'El sitio tardó demasiado en cargar.';
    }
    
    res.status(500).json({ error: errorMessage, details: error.message });
  }
});

router.post('/preview', upload.single('file'), async (req, res) => {
  let inputPath;
  const outputDir = path.join(__dirname, '../../outputs');
  const tempFiles = [];
  
  try {
    const isUrl = req.body.isUrl === 'true';
    
    if (isUrl) {
      inputPath = req.body.url;
      if (!inputPath) {
        return res.status(400).json({ error: 'URL requerida' });
      }
    } else {
      if (!req.file) {
        return res.status(400).json({ error: 'Archivo HTML requerido' });
      }
      inputPath = req.file.path;
      tempFiles.push(inputPath);
    }
    
    let viewport = { width: 1440, height: 900 };
    if (req.body.viewport) {
      try {
        viewport = JSON.parse(req.body.viewport);
      } catch (e) {}
    }
    
    const options = {
      isUrl,
      viewport: viewport,
      fullPage: req.body.fullPage === 'true'
    };
    
    const outputPath = await playwrightService.generatePreview(inputPath, outputDir, options);
    tempFiles.push(outputPath);
    
    res.sendFile(outputPath, async (err) => {
      await cleanupFiles(tempFiles);
    });
    
  } catch (error) {
    console.error('Error generando preview:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ error: 'Error al generar preview', details: error.message });
  }
});

router.get('/health', async (req, res) => {
  try {
    const browser = await playwrightService.getBrowser();
    res.json({
      status: browser.isConnected() ? 'ok' : 'error',
      engine: 'playwright',
      browser: 'chromium',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ status: 'error', error: error.message });
  }
});

module.exports = router;