const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const { cleanupFiles } = require('../utils/cleanup.utils');
const fileStore = require('../services/file-store.service');
const { PDFDocument } = require('pdf-lib');
const JSZip = require('jszip');
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

router.post('/', upload.single('file'), async (req, res) => {
  const tempFiles = req.file ? [req.file.path] : [];
  
  try {
    if (!req.file || !req.body.mode) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'Faltan archivo o modo' });
    }

    const isCompressed = req.body.compressed === 'true';
    const mode = req.body.mode;
    const config = JSON.parse(req.body.config || '{}');
    
    let fileBuffer = await fs.readFile(req.file.path);
    if (isCompressed || req.file.originalname.endsWith('.gz')) {
      fileBuffer = await decompressIfNeeded(fileBuffer, req.file.originalname);
    }
    
    const sourcePdf = await PDFDocument.load(fileBuffer);
    const totalPages = sourcePdf.getPageCount();
    

    const outputs = [];

    const createDocFromIndices = async (indices) => {
      const newPdf = await PDFDocument.create();
      const copiedPages = await newPdf.copyPages(sourcePdf, indices);
      copiedPages.forEach((page) => newPdf.addPage(page));
      return newPdf;
    };

    if (mode === 'ranges') {
      const ranges = (config.ranges || []).sort((a, b) => a - b);
      if (ranges.length === 0) {
        await cleanupFiles(tempFiles);
        return res.status(400).json({ error: 'No se definieron rangos' });
      }

      let startIndex = 0;
      let rangeCounter = 1;
      const splitPoints = [...ranges, totalPages];

      for (const splitPoint of splitPoints) {
        const endIndex = Math.min(splitPoint, totalPages);
        if (startIndex >= endIndex) continue;

        const pageIndices = [];
        for (let i = startIndex; i < endIndex; i++) pageIndices.push(i);

        if (pageIndices.length > 0) {
          const newPdf = await createDocFromIndices(pageIndices);
          outputs.push({ name: 'archivo-' + rangeCounter + '.pdf', pdf: newPdf });
          rangeCounter++;
        }
        startIndex = endIndex;
      }

    } else if (mode === 'extract') {
      const selectedPages = (config.pages || []).map(p => p - 1);
      if (selectedPages.length === 0) {
        await cleanupFiles(tempFiles);
        return res.status(400).json({ error: 'No se seleccionaron páginas' });
      }

      if (config.merge) {
        const newPdf = await createDocFromIndices(selectedPages);
        const baseName = (req.body.fileName || 'archivo_modificado').replace(/\.(pdf|zip)$/, '');
        outputs.push({ name: baseName + '.pdf', pdf: newPdf });
      } else {
        for (const pageIndex of selectedPages) {
          if (pageIndex >= 0 && pageIndex < totalPages) {
            const newPdf = await createDocFromIndices([pageIndex]);
            outputs.push({ name: 'archivo-' + (pageIndex + 1) + '.pdf', pdf: newPdf });
          }
        }
      }

    } else if (mode === 'fixed') {
      const size = parseInt(config.size);
      if (!size || size < 1) {
        await cleanupFiles(tempFiles);
        return res.status(400).json({ error: 'Tamaño de división inválido' });
      }

      for (let i = 0; i < totalPages; i += size) {
        const pageIndices = [];
        for (let j = 0; j < size && (i + j) < totalPages; j++) pageIndices.push(i + j);

        const partNum = Math.floor(i / size) + 1;
        const newPdf = await createDocFromIndices(pageIndices);
        outputs.push({ name: 'archivo-' + partNum + '.pdf', pdf: newPdf });
      }
    }

    if (outputs.length === 0) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'No se generaron archivos' });
    }

    await cleanupFiles(tempFiles);

    if (outputs.length === 1) {
      const pdfBytes = await outputs[0].pdf.save();
      const finalFileName = outputs[0].name;

      const fileId = await fileStore.storeFile(
        Buffer.from(pdfBytes),
        finalFileName,
        'application/pdf'
      );
      return res.json({
        success: true,
        fileId,
        fileName: finalFileName,
        size: pdfBytes.byteLength,
        outputFiles: 1,
        totalPages: totalPages,
        resultSize: pdfBytes.byteLength,
        mode: mode 
      });
    }

    // Múltiples archivos - crear ZIP
    const zip = new JSZip();
    for (const output of outputs) {
      const pdfBytes = await output.pdf.save();
      zip.file(output.name, pdfBytes);
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const outputFileName = req.body.fileName || 'archivos_modificado.zip';

    const fileId = await fileStore.storeFile(
      zipBuffer,
      outputFileName,
      'application/zip'
    );

    res.json({
      success: true,
      fileId,
      fileName: outputFileName,
      size: zipBuffer.length,
      outputFiles: outputs.length,
      totalPages: totalPages,
      mode: mode 
    });

  } catch (error) {
    console.error('Error splitting PDF:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ error: error.message || 'Error interno' });
  }
});

module.exports = router;