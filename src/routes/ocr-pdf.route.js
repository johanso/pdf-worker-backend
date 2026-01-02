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

async function decompressIfNeeded(buffer, fileName) {
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
    console.log(`[Decompress] Decompressing: ${fileName}`);
    return await gunzip(buffer);
  }
  return buffer;
}

/**
 * POST /api/ocr-pdf
 * Aplica OCR a un PDF escaneado para hacerlo searchable
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
      return res.status(400).json({ error: 'Solo archivos PDF' });
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

    // Parsear opciones
    let languages = ['spa', 'eng']; // Default: español + inglés
    if (req.body.languages) {
      try {
        languages = JSON.parse(req.body.languages);
        if (!Array.isArray(languages) || languages.length === 0) {
          languages = ['spa', 'eng'];
        }
      } catch (e) {
        // Si viene como string separado por comas
        languages = req.body.languages.split(',').map(l => l.trim());
      }
    }

    const dpi = Math.min(600, Math.max(150, parseInt(req.body.dpi) || 300));
    const optimize = req.body.optimize !== 'false';

    console.log(`[OCR Route] Processing with languages: ${languages.join('+')}, DPI: ${dpi}`);

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

    // Limpiar archivos temporales
    await cleanupFiles(tempFiles);

    res.json({
      success: true,
      fileId,
      fileName: outputFileName,
      size: pdfBuffer.length,
      languages: languages,
      dpi: dpi
    });

  } catch (error) {
    console.error('[OCR Route] Error:', error);
    await cleanupFiles(tempFiles);
    
    let errorMessage = 'Error al procesar OCR';
    if (error.message.includes('tesseract')) {
      errorMessage = 'Error en el reconocimiento de texto';
    } else if (error.message.includes('pdftoppm')) {
      errorMessage = 'Error al procesar las páginas del PDF';
    } else if (error.message.includes('memory')) {
      errorMessage = 'El archivo es demasiado grande para procesar';
    }
    
    res.status(500).json({ 
      error: errorMessage, 
      details: error.message 
    });
  }
});

/**
 * POST /api/ocr-pdf/detect
 * Detecta si un PDF necesita OCR
 */
router.post('/detect', upload.single('file'), async (req, res) => {
  const tempFiles = req.file ? [req.file.path] : [];
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Archivo PDF requerido' });
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

    const detection = await ocrService.detectPdfType(inputPath);
    
    await cleanupFiles(tempFiles);

    res.json({
      success: true,
      ...detection,
      recommendation: detection.needsOcr 
        ? 'Este PDF parece ser escaneado. Se recomienda aplicar OCR.'
        : 'Este PDF ya contiene texto seleccionable. OCR es opcional.'
    });

  } catch (error) {
    console.error('[OCR Detect] Error:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ error: 'Error al analizar PDF', details: error.message });
  }
});

/**
 * POST /api/ocr-pdf/extract-text
 * Extrae solo el texto del PDF (sin generar nuevo PDF)
 */
router.post('/extract-text', upload.single('file'), async (req, res) => {
  const tempFiles = req.file ? [req.file.path] : [];
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Archivo PDF requerido' });
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

    let languages = ['spa', 'eng'];
    if (req.body.languages) {
      try {
        languages = JSON.parse(req.body.languages);
      } catch (e) {
        languages = req.body.languages.split(',').map(l => l.trim());
      }
    }

    const result = await ocrService.extractText(inputPath, path.join(__dirname, '../../outputs'), { languages });
    
    await cleanupFiles(tempFiles);

    // Opcionalmente guardar como archivo .txt
    if (req.body.saveAsFile === 'true') {
      const originalName = req.file.originalname.replace(/\.gz$/, '').replace(/\.pdf$/i, '');
      const txtFileName = `${originalName}-text.txt`;
      
      const fileId = await fileStore.storeFile(
        Buffer.from(result.text, 'utf-8'),
        txtFileName,
        'text/plain'
      );

      return res.json({
        success: true,
        fileId,
        fileName: txtFileName,
        ...result
      });
    }

    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    console.error('[OCR Extract] Error:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ error: 'Error al extraer texto', details: error.message });
  }
});

/**
 * GET /api/ocr-pdf/languages
 * Lista los idiomas disponibles para OCR
 */
router.get('/languages', async (req, res) => {
  try {
    const installed = await ocrService.getInstalledLanguages();
    
    const languages = {
      'spa': { code: 'spa', name: 'Español', installed: installed.includes('spa') },
      'eng': { code: 'eng', name: 'English', installed: installed.includes('eng') },
      'fra': { code: 'fra', name: 'Français', installed: installed.includes('fra') },
      'deu': { code: 'deu', name: 'Deutsch', installed: installed.includes('deu') },
      'ita': { code: 'ita', name: 'Italiano', installed: installed.includes('ita') },
      'por': { code: 'por', name: 'Português', installed: installed.includes('por') },
      'cat': { code: 'cat', name: 'Català', installed: installed.includes('cat') },
      'nld': { code: 'nld', name: 'Nederlands', installed: installed.includes('nld') },
      'pol': { code: 'pol', name: 'Polski', installed: installed.includes('pol') },
      'rus': { code: 'rus', name: 'Русский', installed: installed.includes('rus') },
      'chi_sim': { code: 'chi_sim', name: '简体中文', installed: installed.includes('chi_sim') },
      'chi_tra': { code: 'chi_tra', name: '繁體中文', installed: installed.includes('chi_tra') },
      'jpn': { code: 'jpn', name: '日本語', installed: installed.includes('jpn') },
      'kor': { code: 'kor', name: '한국어', installed: installed.includes('kor') },
      'ara': { code: 'ara', name: 'العربية', installed: installed.includes('ara') }
    };

    res.json({
      success: true,
      languages: Object.values(languages),
      installed: installed
    });

  } catch (error) {
    res.status(500).json({ error: 'Error al obtener idiomas', details: error.message });
  }
});

/**
 * GET /api/ocr-pdf/health
 * Verifica que las dependencias estén instaladas
 */
router.get('/health', async (req, res) => {
  try {
    const deps = await ocrService.checkDependencies();
    const allOk = Object.values(deps).every(v => v);

    res.json({
      status: allOk ? 'ok' : 'degraded',
      dependencies: deps,
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

/**
 * GET /api/ocr-pdf/info
 * Información sobre el servicio OCR
 */
router.get('/info', (req, res) => {
  res.json({
    name: 'OCR PDF Service',
    description: 'Convierte PDFs escaneados en documentos con texto seleccionable y buscable',
    features: [
      'Reconocimiento de texto en múltiples idiomas',
      'Detección automática de PDFs escaneados',
      'Extracción de texto puro',
      'Optimización automática del resultado'
    ],
    options: {
      languages: {
        type: 'array',
        default: ['spa', 'eng'],
        description: 'Idiomas para el reconocimiento'
      },
      dpi: {
        type: 'number',
        default: 300,
        min: 150,
        max: 600,
        description: 'Resolución de procesamiento (mayor = mejor calidad, más lento)'
      },
      optimize: {
        type: 'boolean',
        default: true,
        description: 'Optimizar tamaño del PDF resultante'
      }
    },
    endpoints: {
      'POST /': 'Aplicar OCR a un PDF',
      'POST /detect': 'Detectar si un PDF necesita OCR',
      'POST /extract-text': 'Extraer solo el texto (OCR)',
      'GET /languages': 'Listar idiomas disponibles',
      'GET /health': 'Estado del servicio'
    },
    limits: {
      maxFileSize: '100MB',
      maxPages: 100,
      timeout: '5 minutos'
    }
  });
});

module.exports = router;