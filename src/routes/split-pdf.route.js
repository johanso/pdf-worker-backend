const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const { cleanupFiles } = require('../utils/cleanup.utils');
const { PDFDocument } = require('pdf-lib');
const JSZip = require('jszip');
const fs = require('fs').promises;

router.post('/', upload.single('file'), async (req, res) => {
  const tempFiles = req.file ? [req.file.path] : [];
  
  try {
    if (!req.file || !req.body.mode) {
      await cleanupFiles(tempFiles);
      return res.status(400).json({ error: 'Faltan archivo o modo' });
    }

    const mode = req.body.mode;
    const config = JSON.parse(req.body.config || '{}');
    const fileBuffer = await fs.readFile(req.file.path);
    const sourcePdf = await PDFDocument.load(fileBuffer, { ignoreEncryption: true });
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
        outputs.push({ name: 'extracted-pages.pdf', pdf: newPdf });
      } else {
        for (const pageIndex of selectedPages) {
          if (pageIndex >= 0 && pageIndex < totalPages) {
            const newPdf = await createDocFromIndices([pageIndex]);
            outputs.push({ name: 'page-' + (pageIndex + 1) + '.pdf', pdf: newPdf });
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
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="' + outputs[0].name + '"');
      return res.send(Buffer.from(pdfBytes));
    }

    const zip = new JSZip();
    for (const output of outputs) {
      const pdfBytes = await output.pdf.save();
      zip.file(output.name, pdfBytes);
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="split-files.zip"');
    res.send(zipBuffer);

  } catch (error) {
    console.error('Error splitting PDF:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ error: error.message || 'Error interno' });
  }
});

module.exports = router;
