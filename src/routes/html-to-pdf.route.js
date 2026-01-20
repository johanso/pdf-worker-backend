const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const playwrightService = require('../services/playwright.service');
const { cleanupFiles } = require('../utils/cleanup.utils');
const fileStore = require('../services/file-store.service');
const path = require('path');
const fs = require('fs').promises;

/**
 * @swagger
 * /api/html-to-pdf:
 *   post:
 *     summary: Convierte HTML o URL a PDF
 *     tags: [HTML → PDF]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Archivo HTML (requerido si no se proporciona URL)
 *               url:
 *                 type: string
 *                 description: URL a convertir (requerido si no se proporciona archivo)
 *                 example: https://ejemplo.com
 *               isUrl:
 *                 type: string
 *                 enum: ['true', 'false']
 *                 description: Indica si se proporciona URL en lugar de archivo
 *               pageFormat:
 *                 type: string
 *                 enum: [A4, Letter, Legal]
 *                 description: Formato de página
 *                 default: A4
 *               landscape:
 *                 type: string
 *                 enum: ['true', 'false']
 *                 description: Orientación horizontal
 *                 default: 'false'
 *               viewport:
 *                 type: string
 *                 description: Dimensiones de ventana en formato JSON
 *                 example: '{"width":1440,"height":900}'
 *               margins:
 *                 type: string
 *                 description: Márgenes en formato JSON
 *                 example: '{"top":20,"right":20,"bottom":20,"left":20}'
 *               fileName:
 *                 type: string
 *                 description: Nombre personalizado para el PDF
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
 *                 size:
 *                   type: number
 *                 sourceType:
 *                   type: string
 *                   enum: [file, url]
 *                 viewport:
 *                   type: object
 *       400:
 *         description: URL inválida o archivo no proporcionado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Error al acceder a URL o convertir
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/', upload.single('file'), async (req, res) => {
  let inputPath;
  const outputDir = path.join(__dirname, '../../outputs');
  const outputFileName = req.body.fileName || 'webpage.pdf';
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
    
    // Parsear viewport
    let viewport = { width: 1440, height: 900 };
    if (req.body.viewport) {
      try {
        viewport = JSON.parse(req.body.viewport);
        console.log('[Route] Viewport recibido:', viewport);
      } catch (e) {
        console.log('[Route] Error parseando viewport, usando default');
      }
    }
    
    // Parsear márgenes (acepta "margins" o "margin")
    let margin = { top: 20, right: 20, bottom: 20, left: 20 };
    const marginData = req.body.margins || req.body.margin;
    if (marginData) {
      try {
        margin = JSON.parse(marginData);
        console.log('[Route] Márgenes recibidos:', margin);
      } catch (e) {
        console.log('[Route] Error parseando márgenes, usando default');
      }
    }
    
    const options = {
      isUrl,
      format: req.body.pageFormat || 'A4',
      landscape: req.body.landscape === 'true',
      viewport: viewport,
      margin: margin
    };
        
    const outputPath = await playwrightService.htmlToPdf(inputPath, outputDir, options);
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
      sourceType: isUrl ? 'url' : 'file',
      viewport: viewport
    });
    
  } catch (error) {
    console.error('Error HTML→PDF:', error);
    await cleanupFiles(tempFiles);
    
    let errorMessage = 'Error al convertir';
    if (error.message.includes('net::ERR_NAME_NOT_RESOLVED')) {
      errorMessage = 'No se pudo acceder a la URL.';
    } else if (error.message.includes('Timeout')) {
      errorMessage = 'El sitio tardó demasiado en cargar.';
    } else if (error.message.includes('net::ERR_CONNECTION_REFUSED')) {
      errorMessage = 'Conexión rechazada por el servidor.';
    }
    
    res.status(500).json({ error: errorMessage, details: error.message });
  }
});

/**
 * @swagger
 * /api/html-to-pdf/preview:
 *   post:
 *     summary: Genera una vista previa (captura de pantalla) de HTML o URL
 *     tags: [HTML → PDF]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Archivo HTML (requerido si no se proporciona URL)
 *               url:
 *                 type: string
 *                 description: URL a previsualizar
 *               isUrl:
 *                 type: string
 *                 enum: ['true', 'false']
 *                 description: Indica si se proporciona URL
 *               viewport:
 *                 type: string
 *                 description: Dimensiones en formato JSON
 *                 example: '{"width":1440,"height":900}'
 *               fullPage:
 *                 type: string
 *                 enum: ['true', 'false']
 *                 description: Capturar página completa
 *     responses:
 *       200:
 *         description: Imagen de vista previa
 *         content:
 *           image/png:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: URL inválida o archivo no proporcionado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Error al acceder a URL
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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
    
    // Parsear viewport
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
      if (err) console.error('Error enviando preview:', err);
      await cleanupFiles(tempFiles);
    });
    
  } catch (error) {
    console.error('Error generando preview:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ error: 'Error al generar preview', details: error.message });
  }
});

/**
 * @swagger
 * /api/html-to-pdf/health:
 *   get:
 *     summary: Verifica el estado del motor de conversión HTML a PDF
 *     tags: [HTML → PDF]
 *     responses:
 *       200:
 *         description: Estado del servicio
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [ok, error]
 *                 engine:
 *                   type: string
 *                   example: playwright
 *                 browser:
 *                   type: string
 *                   example: chromium
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       500:
 *         description: Error en el motor
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: error
 *                 error:
 *                   type: string
 *                 timestamp:
 *                   type: string
 */
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
    res.status(500).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;