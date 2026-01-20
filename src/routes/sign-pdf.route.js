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
 * /api/sign-pdf:
 *   post:
 *     summary: Firma un PDF insertando imágenes de firma en posiciones específicas
 *     tags: [Seguridad]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *               - signatures
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Archivo PDF o comprimido (.gz)
 *               signatures:
 *                 type: string
 *                 description: Array JSON con instrucciones de firma
 *                 example: '[{"pageNumber":1,"x":100,"y":500,"width":200,"height":100,"image":"data:image/png;base64,..."}]'
 *               fileName:
 *                 type: string
 *                 description: Nombre personalizado para el PDF resultante
 *               compressed:
 *                 type: string
 *                 enum: ['true', 'false']
 *                 description: Indica si el archivo está comprimido con gzip
 *     responses:
 *       200:
 *         description: PDF firmado exitosamente
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
 *                 fileName:
 *                   type: string
 *                 originalSize:
 *                   type: number
 *                 resultSize:
 *                   type: number
 *                 signaturesApplied:
 *                   type: number
 *                 pages:
 *                   type: array
 *                   items:
 *                     type: number
 *                   description: Páginas que contienen firmas
 *       400:
 *         description: Firmas inválidas o páginas fuera de rango
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

    // Parsear firmas
    let signatures = [];
    if (req.body.signatures) {
      try {
        signatures = typeof req.body.signatures === 'string' 
          ? JSON.parse(req.body.signatures)
          : req.body.signatures;
      } catch (e) {
        await cleanupFiles(tempFiles);
        return res.status(400).json({ error: 'Formato de firmas inválido', details: e.message });
      }
    }

    // Validar que haya al menos una firma
    if (!signatures || signatures.length === 0) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'Se requiere al menos una firma' });
    }

    // Validar formato de cada firma
    for (let i = 0; i < signatures.length; i++) {
      const sig = signatures[i];
      if (!sig.pageNumber || !sig.x === undefined || sig.y === undefined || !sig.width || !sig.height || !sig.image) {
        await cleanupFiles(tempFiles);
        return res.status(400).json({ 
          error: `Firma ${i + 1} incompleta`,
          details: 'Cada firma debe tener: pageNumber, x, y, width, height, image'
        });
      }

      // Validar que la imagen sea base64
      if (!sig.image.startsWith('data:image/')) {
        await cleanupFiles(tempFiles);
        return res.status(400).json({ 
          error: `Firma ${i + 1} tiene formato de imagen inválido`,
          details: 'La imagen debe ser base64 con formato data:image/png o data:image/jpeg'
        });
      }
    }

    // Nombre de salida
    const outputFileName = req.body.fileName || originalName.replace(/\.pdf$/i, '-signed.pdf');

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

    console.log(`[Sign PDF] Processing: ${originalName}`);
    console.log(`[Sign PDF] Signatures to apply: ${signatures.length}`);

    const startTime = Date.now();

    // Cargar PDF con pdf-lib
    const { PDFDocument, degrees } = require('pdf-lib');
    const pdfBytes = await fs.readFile(inputPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    
    const totalPages = pdfDoc.getPageCount();
    console.log(`[Sign PDF] Total pages: ${totalPages}`);

    // Validar que las páginas existan
    for (const sig of signatures) {
      if (sig.pageNumber < 1 || sig.pageNumber > totalPages) {
        await cleanupFiles(tempFiles);
        return res.status(400).json({ 
          error: `Página ${sig.pageNumber} no existe`,
          details: `El PDF tiene ${totalPages} páginas`
        });
      }
    }

    // Aplicar cada firma
    const pagesWithSignatures = new Set();

    for (const sig of signatures) {
      console.log(`[Sign PDF] Applying signature to page ${sig.pageNumber} at (${sig.x}, ${sig.y})`);
      
      // Obtener la página (0-based en pdf-lib)
      const page = pdfDoc.getPage(sig.pageNumber - 1);
      const pageHeight = page.getHeight();
      
      // Extraer imagen base64
      const base64Data = sig.image.split(',')[1];
      const imageBuffer = Buffer.from(base64Data, 'base64');
      
      // Determinar tipo de imagen y embedear
      let embeddedImage;
      if (sig.image.includes('image/png')) {
        embeddedImage = await pdfDoc.embedPng(imageBuffer);
      } else if (sig.image.includes('image/jpeg') || sig.image.includes('image/jpg')) {
        embeddedImage = await pdfDoc.embedJpg(imageBuffer);
      } else {
        console.warn(`[Sign PDF] Unknown image type, trying PNG: ${sig.image.substring(0, 30)}...`);
        embeddedImage = await pdfDoc.embedPng(imageBuffer);
      }

      // IMPORTANTE: PDF usa coordenadas desde ABAJO-IZQUIERDA
      // Si el frontend envía coordenadas desde ARRIBA-IZQUIERDA, necesitas convertir:
      // const pdfY = pageHeight - sig.y - sig.height;
      // Pero según nuestra spec, el frontend ya debe enviar coordenadas PDF correctas
      
      // Aplicar opacidad si está especificada
      const opacity = sig.opacity !== undefined ? sig.opacity : 1.0;
      
      // Dibujar imagen en la página
      page.drawImage(embeddedImage, {
        x: sig.x,
        y: sig.y,
        width: sig.width,
        height: sig.height,
        rotate: degrees(sig.rotation || 0),
        opacity: opacity,
      });

      pagesWithSignatures.add(sig.pageNumber);
    }

    // Guardar PDF firmado
    const signedPdfBytes = await pdfDoc.save();
    const timestamp = Date.now();
    const outputPath = path.join(outputDir, `signed-${timestamp}.pdf`);
    await fs.writeFile(outputPath, signedPdfBytes);
    tempFiles.push(outputPath);

    const resultSize = signedPdfBytes.length;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Sign PDF] Completed in ${elapsed}s`);

    // Guardar en file store
    const fileId = await fileStore.storeFile(
      Buffer.from(signedPdfBytes),
      outputFileName,
      'application/pdf'
    );

    await cleanupFiles(tempFiles);

    console.log(`[Sign PDF] Success: ${outputFileName} (${(resultSize/1024/1024).toFixed(2)}MB)`);

    res.json({
      success: true,
      fileId,
      fileName: outputFileName,
      originalSize,
      resultSize,
      signaturesApplied: signatures.length,
      pages: Array.from(pagesWithSignatures).sort((a, b) => a - b)
    });
    
  } catch (error) {
    console.error('[Sign PDF] Error:', error);
    await cleanupFiles(tempFiles);
    
    let errorMessage = 'Error al firmar PDF';
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
 * @swagger
 * /api/sign-pdf/info:
 *   get:
 *     summary: Obtiene información sobre el formato de firmas digitales
 *     tags: [Seguridad]
 *     responses:
 *       200:
 *         description: Información sobre el formato de firma
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 description:
 *                   type: string
 *                 useCases:
 *                   type: array
 *                   items:
 *                     type: string
 *                 signatureFormat:
 *                   type: object
 *                 coordinateSystem:
 *                   type: object
 *                 limits:
 *                   type: object
 *                 example:
 *                   type: object
 *                 engine:
 *                   type: string
 */
router.get('/info', (req, res) => {
  res.json({
    description: 'Firma documentos PDF insertando imágenes de firma',
    useCases: [
      'Firmar contratos digitalmente',
      'Agregar firmas visuales a documentos',
      'Múltiples firmas en diferentes páginas',
      'Firmas con transparencia y rotación'
    ],
    signatureFormat: {
      pageNumber: 'Número de página (1-based)',
      x: 'Coordenadas X en puntos PDF (desde izquierda)',
      y: 'Coordenadas Y en puntos PDF (desde ABAJO)',
      width: 'Ancho en puntos PDF',
      height: 'Alto en puntos PDF',
      rotation: 'Rotación en grados (0, 90, 180, 270)',
      opacity: 'Opacidad (0.0 - 1.0, opcional, default: 1.0)',
      image: 'Imagen base64 (data:image/png;base64,... o jpeg)'
    },
    coordinateSystem: {
      origin: 'Abajo-izquierda (PDF estándar)',
      units: 'Puntos (1 punto = 1/72 pulgada)',
      note: 'Tamaño A4 = 595x842 puntos, Letter = 612x792 puntos'
    },
    limits: {
      maxFileSize: '150MB',
      maxSignatures: 50,
      supportedImageFormats: ['PNG', 'JPEG']
    },
    example: {
      signatures: [
        {
          id: 'sig-1',
          pageNumber: 1,
          x: 100,
          y: 100,
          width: 200,
          height: 80,
          rotation: 0,
          opacity: 1.0,
          image: 'data:image/png;base64,iVBORw0KG...'
        }
      ]
    },
    engine: 'pdf-lib'
  });
});

module.exports = router;