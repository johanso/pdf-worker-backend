const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
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
 * /api/censure-pdf/search:
 *   post:
 *     summary: Busca texto o patrones sensibles en un PDF
 *     tags: [Seguridad]
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
 *               searchType:
 *                 type: string
 *                 enum: [text, creditCard, phone, email, dni, all]
 *                 description: Tipo de búsqueda
 *                 default: text
 *               searchText:
 *                 type: string
 *                 description: Texto a buscar (requerido si searchType es 'text')
 *               caseSensitive:
 *                 type: string
 *                 enum: ['true', 'false']
 *                 description: Búsqueda sensible a mayúsculas
 *                 default: 'false'
 *               compressed:
 *                 type: string
 *                 enum: ['true', 'false']
 *                 description: Indica si el archivo está comprimido con gzip
 *     responses:
 *       200:
 *         description: Búsqueda completada
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 matches:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       pageNumber:
 *                         type: number
 *                       x:
 *                         type: number
 *                       y:
 *                         type: number
 *                       width:
 *                         type: number
 *                       height:
 *                         type: number
 *                       text:
 *                         type: string
 *                       type:
 *                         type: string
 *                 totalMatches:
 *                   type: number
 *                 pagesSummary:
 *                   type: object
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
router.post('/search', upload.single('file'), async (req, res) => {
  const tempFiles = req.file ? [req.file.path] : [];
  
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

    const searchType = req.body.searchType || 'text';
    const searchText = req.body.searchText || '';
    const caseSensitive = req.body.caseSensitive === 'true';

    console.log(`[Redact Search] Type: ${searchType}, Text: "${searchText}", Case: ${caseSensitive}`);

    // Buscar matches usando pdf.js
    const matches = await findTextMatches(inputPath, searchType, searchText, caseSensitive);

    // Agrupar por página
    const pagesSummary = {};
    matches.forEach(m => {
      pagesSummary[m.pageNumber] = (pagesSummary[m.pageNumber] || 0) + 1;
    });

    await cleanupFiles(tempFiles);

    console.log(`[Redact Search] Found ${matches.length} matches across ${Object.keys(pagesSummary).length} pages`);

    res.json({
      success: true,
      matches,
      totalMatches: matches.length,
      pagesSummary
    });

  } catch (error) {
    console.error('[Redact Search] Error:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ 
      error: 'Error al buscar en el PDF', 
      details: error.message 
    });
  }
});

/**
 * POST /api/worker/censure-pdf
 * Aplica censuras (rectángulos negros) sobre áreas específicas o páginas completas
 * 
 * Body params:
 * - file: archivo PDF
 * - redactions: JSON string con array de rectángulos a censurar
 * - fullPages: JSON string con array de números de página a censurar completamente (opcional)
 * - fileName: nombre del archivo de salida (opcional)
 * - compressed: 'true' si el archivo viene comprimido con gzip
 * 
 * Formato de redactions:
 * [
 *   {
 *     pageNumber: 1,
 *     x: 100,
 *     y: 500,
 *     width: 200,
 *     height: 20,
 *     color: "#000000"  // Opcional, default: negro
 *   }
 * ]
 * 
 * Response:
 * {
 *   success: true,
 *   fileId: "abc123",
 *   fileName: "documento-censurado.pdf",
 *   originalSize: 1234567,
 *   resultSize: 1345678,
 *   redactionsApplied: 15,
 *   fullPagesCensored: [2, 5],
 *   pages: [1, 2, 3, 5]
 * }
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

    // Parsear redactions
    let redactions = [];
    if (req.body.redactions) {
      try {
        redactions = typeof req.body.redactions === 'string' 
          ? JSON.parse(req.body.redactions)
          : req.body.redactions;
      } catch (e) {
        await cleanupFiles(tempFiles);
        return res.status(400).json({ 
          error: 'Formato de redactions inválido', 
          details: e.message 
        });
      }
    }

    // Parsear páginas completas a censurar
    let fullPages = [];
    if (req.body.fullPages) {
      try {
        fullPages = typeof req.body.fullPages === 'string'
          ? JSON.parse(req.body.fullPages)
          : req.body.fullPages;
      } catch (e) {
        console.warn('[Redact] Error parsing fullPages:', e.message);
      }
    }

    // Validar que haya al menos algo que censurar
    if (redactions.length === 0 && fullPages.length === 0) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ 
        error: 'Se requiere al menos una censura o página completa' 
      });
    }

    // Nombre de salida
    const outputFileName = req.body.fileName || originalName.replace(/\.pdf$/i, '-censurado.pdf');

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

    console.log(`[Redact] Processing: ${originalName}`);
    console.log(`[Redact] Redactions: ${redactions.length}, Full pages: ${fullPages.length}`);

    const startTime = Date.now();

    // Cargar PDF con pdf-lib
    const { PDFDocument, rgb } = require('pdf-lib');
    const pdfBytes = await fs.readFile(inputPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    
    const totalPages = pdfDoc.getPageCount();
    console.log(`[Redact] Total pages: ${totalPages}`);

    // Validar páginas
    for (const red of redactions) {
      if (red.pageNumber < 1 || red.pageNumber > totalPages) {
        await cleanupFiles(tempFiles);
        return res.status(400).json({ 
          error: `Página ${red.pageNumber} no existe`,
          details: `El PDF tiene ${totalPages} páginas`
        });
      }
    }

    for (const pageNum of fullPages) {
      if (pageNum < 1 || pageNum > totalPages) {
        await cleanupFiles(tempFiles);
        return res.status(400).json({ 
          error: `Página ${pageNum} no existe`,
          details: `El PDF tiene ${totalPages} páginas`
        });
      }
    }

    const pagesWithRedactions = new Set();

    // Aplicar censuras de rectángulos
    for (const red of redactions) {
      console.log(`[Redact] Applying redaction to page ${red.pageNumber} at (${red.x}, ${red.y})`);
      
      const page = pdfDoc.getPage(red.pageNumber - 1);
      
      // Convertir color hex a RGB
      let color = { r: 0, g: 0, b: 0 }; // Negro por defecto
      if (red.color && red.color.startsWith('#')) {
        const hex = red.color.replace('#', '');
        color.r = parseInt(hex.substring(0, 2), 16) / 255;
        color.g = parseInt(hex.substring(2, 4), 16) / 255;
        color.b = parseInt(hex.substring(4, 6), 16) / 255;
      }

      // Dibujar rectángulo opaco
      page.drawRectangle({
        x: red.x,
        y: red.y,
        width: red.width,
        height: red.height,
        color: rgb(color.r, color.g, color.b),
        opacity: 1.0,
        borderWidth: 0
      });

      pagesWithRedactions.add(red.pageNumber);
    }

    // Aplicar censuras de páginas completas
    for (const pageNum of fullPages) {
      console.log(`[Redact] Censoring full page ${pageNum}`);
      
      const page = pdfDoc.getPage(pageNum - 1);
      const { width, height } = page.getSize();
      
      // Dibujar rectángulo negro sobre toda la página
      page.drawRectangle({
        x: 0,
        y: 0,
        width: width,
        height: height,
        color: rgb(0, 0, 0),
        opacity: 1.0,
        borderWidth: 0
      });

      pagesWithRedactions.add(pageNum);
    }

    // Guardar PDF censurado
    const redactedPdfBytes = await pdfDoc.save();
    const timestamp = Date.now();
    const outputPath = path.join(outputDir, `redacted-${timestamp}.pdf`);
    await fs.writeFile(outputPath, redactedPdfBytes);
    tempFiles.push(outputPath);

    const resultSize = redactedPdfBytes.length;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Redact] Completed in ${elapsed}s`);

    // Guardar en file store
    const fileId = await fileStore.storeFile(
      Buffer.from(redactedPdfBytes),
      outputFileName,
      'application/pdf'
    );

    await cleanupFiles(tempFiles);

    console.log(`[Redact] Success: ${outputFileName} (${(resultSize/1024/1024).toFixed(2)}MB)`);

    res.json({
      success: true,
      fileId,
      fileName: outputFileName,
      originalSize,
      resultSize,
      redactionsApplied: redactions.length,
      fullPagesCensored: fullPages,
      pages: Array.from(pagesWithRedactions).sort((a, b) => a - b)
    });
    
  } catch (error) {
    console.error('[Redact] Error:', error);
    await cleanupFiles(tempFiles);
    
    let errorMessage = 'Error al censurar PDF';
    if (error.message.includes('encrypted')) {
      errorMessage = 'El PDF está protegido. Desbloquéalo primero.';
    } else if (error.message.includes('Invalid PDF')) {
      errorMessage = 'El archivo PDF está corrupto o no es válido';
    }
    
    res.status(500).json({ 
      error: errorMessage, 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * Función auxiliar: Buscar matches de texto en el PDF
 * Usa pdf.js para extraer texto con coordenadas
 */
async function findTextMatches(pdfPath, searchType, searchText, caseSensitive) {
  const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
  
  const loadingTask = pdfjsLib.getDocument(pdfPath);
  const pdf = await loadingTask.promise;
  const matches = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1.0 });
    
    // Procesar cada item de texto
    for (const item of textContent.items) {
      if (!item.str || item.str.trim() === '') continue;

      const text = caseSensitive ? item.str : item.str.toLowerCase();
      const search = caseSensitive ? searchText : searchText.toLowerCase();
      
      let shouldRedact = false;
      let matchType = searchType;

      switch (searchType) {
        case 'text':
          shouldRedact = text.includes(search);
          break;

        case 'creditCard':
          // Visa, Mastercard, Amex, Discover, etc.
          shouldRedact = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/.test(item.str);
          break;

        case 'phone':
          // Formatos internacionales y locales
          shouldRedact = /(\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/.test(item.str);
          break;

        case 'email':
          shouldRedact = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(item.str);
          break;

        case 'dni':
        case 'id':
          // DNI/NIE español, SSN americano, etc.
          shouldRedact = /\b\d{8}[-]?[A-Z]\b/.test(item.str) || // DNI español
                        /\b[XYZ]\d{7}[-]?[A-Z]\b/.test(item.str) || // NIE español
                        /\b\d{3}-\d{2}-\d{4}\b/.test(item.str); // SSN americano
          break;

        case 'all':
          // Buscar todo tipo de datos sensibles
          shouldRedact = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/.test(item.str) || // Tarjeta
                        /(\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/.test(item.str) || // Teléfono
                        /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(item.str) || // Email
                        /\b\d{8}[-]?[A-Z]\b/.test(item.str); // DNI
          
          // Determinar tipo específico para la respuesta
          if (/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/.test(item.str)) {
            matchType = 'creditCard';
          } else if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(item.str)) {
            matchType = 'email';
          } else if (/(\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/.test(item.str)) {
            matchType = 'phone';
          } else if (/\b\d{8}[-]?[A-Z]\b/.test(item.str)) {
            matchType = 'dni';
          }
          break;
      }

      if (shouldRedact) {
        // Extraer coordenadas del item
        const tx = item.transform[4];
        const ty = item.transform[5];
        
        // Calcular dimensiones aproximadas
        const width = item.width || (item.str.length * 6); // Aproximado
        const height = item.height || 12; // Aproximado
        
        // Convertir coordenadas: pdf.js usa arriba-izquierda, PDF usa abajo-izquierda
        const pdfY = viewport.height - ty - height;

        matches.push({
          pageNumber: pageNum,
          x: tx,
          y: pdfY,
          width: width,
          height: height,
          text: item.str,
          type: matchType
        });
      }
    }
  }

  return matches;
}

/**
 * GET /api/worker/censure-pdf/info
 * Información sobre la funcionalidad de censura
 */
router.get('/info', (req, res) => {
  res.json({
    description: 'Censura información sensible en documentos PDF',
    useCases: [
      'Ocultar números de tarjetas de crédito',
      'Censurar información personal (DNI, teléfonos, emails)',
      'Redactar documentos antes de compartir',
      'Preparar documentos para publicación'
    ],
    searchTypes: [
      { 
        value: 'text', 
        label: 'Texto específico', 
        description: 'Busca y censura un texto exacto',
        requiresInput: true
      },
      { 
        value: 'creditCard', 
        label: 'Tarjeta de crédito', 
        description: 'Detecta números de tarjeta (16 dígitos)',
        pattern: '#### #### #### ####'
      },
      { 
        value: 'phone', 
        label: 'Número de teléfono', 
        description: 'Detecta teléfonos en varios formatos',
        pattern: '+XX XXX XXX XXXX'
      },
      { 
        value: 'email', 
        label: 'Email', 
        description: 'Detecta direcciones de correo electrónico',
        pattern: 'user@example.com'
      },
      { 
        value: 'dni', 
        label: 'DNI/ID', 
        description: 'Detecta documentos de identidad (DNI, NIE, SSN)',
        pattern: '12345678-A'
      },
      { 
        value: 'all', 
        label: 'Todos los patrones', 
        description: 'Busca todos los tipos de datos sensibles'
      }
    ],
    redactionColors: [
      { name: 'Negro', value: '#000000', default: true },
      { name: 'Blanco', value: '#FFFFFF' },
      { name: 'Rojo', value: '#DC2626' },
      { name: 'Amarillo', value: '#FDE047' }
    ],
    features: [
      'Búsqueda automática por patrones',
      'Censura manual con rectángulos',
      'Censura de páginas completas',
      'Preview antes de aplicar',
      'Colores personalizables'
    ],
    limits: {
      maxFileSize: '150MB',
      maxRedactions: 1000
    },
    engines: ['pdf-lib', 'pdfjs-dist']
  });
});

module.exports = router;