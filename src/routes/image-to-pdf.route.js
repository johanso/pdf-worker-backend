const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const { execAsync } = require('../utils/file.utils');
const { cleanupFiles } = require('../utils/cleanup.utils');
const path = require('path');
const fs = require('fs').promises;

const PAGE_SIZES = {
  a4: { width: 595, height: 842 },
  letter: { width: 612, height: 792 },
  legal: { width: 612, height: 1008 },
};

const MARGINS = {
  none: 0,
  small: 20,
  normal: 40,
};

router.post('/', upload.array('images', 200), async (req, res) => {
  const tempFiles = [];
  const outputDir = path.join(__dirname, '../../outputs');
  
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Se requieren imágenes' });
    }

    const files = req.files;
    tempFiles.push(...files.map(f => f.path));

    const pageSize = req.body.pageSize || 'a4';
    const orientation = req.body.orientation || 'auto';
    const margin = req.body.margin || 'small';
    const quality = req.body.quality || 'original';
    
    let rotations = [];
    if (req.body.rotations) {
      if (Array.isArray(req.body.rotations)) {
        rotations = req.body.rotations.map(r => parseInt(r) || 0);
      } else {
        rotations = req.body.rotations.split(',').map(r => parseInt(r) || 0);
      }
    }

    const marginPx = MARGINS[margin] || MARGINS.small;
    const timestamp = Date.now();
    const outputPath = path.join(outputDir, `images-${timestamp}.pdf`);

    const processedImages = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const rotation = rotations[i] || 0;
      
      let imagePath = file.path;

      if (rotation !== 0) {
        const ext = file.originalname.split('.').pop().toLowerCase();
        const rotatedPath = file.path + `-rotated.${ext}`;
        await execAsync(`convert "${file.path}" -rotate ${rotation} "${rotatedPath}"`);
        tempFiles.push(rotatedPath);
        imagePath = rotatedPath;
      }

      if (quality === 'compressed') {
        const compressedPath = file.path + `-compressed.jpg`;
        await execAsync(`convert "${imagePath}" -quality 80 "${compressedPath}"`);
        tempFiles.push(compressedPath);
        imagePath = compressedPath;
      }

      processedImages.push(imagePath);
    }

    if (pageSize === 'fit') {
      const marginArg = marginPx > 0 ? `-border ${marginPx} -bordercolor white` : '';
      await execAsync(`
        convert ${processedImages.map(p => \`"\${p}"\`).join(' ')} \
          ${marginArg} \
          -quality 95 \
          "${outputPath}"
      `);
    } else {
      const size = PAGE_SIZES[pageSize] || PAGE_SIZES.a4;
      const pdfPages = [];
      
      for (let i = 0; i < processedImages.length; i++) {
        const imgPath = processedImages[i];
        const pagePath = path.join(outputDir, `page-${timestamp}-${i}.pdf`);
        tempFiles.push(pagePath);

        const identifyResult = await execAsync(`identify -format "%w %h" "${imgPath}"`);
        const [imgWidth, imgHeight] = identifyResult.stdout.trim().split(' ').map(Number);

        let pageWidth = size.width;
        let pageHeight = size.height;

        if (orientation === 'landscape') {
          [pageWidth, pageHeight] = [pageHeight, pageWidth];
        } else if (orientation === 'auto') {
          const imgRatio = imgWidth / imgHeight;
          const portraitRatio = size.width / size.height;
          
          if (imgRatio > 1 && portraitRatio < 1) {
            [pageWidth, pageHeight] = [pageHeight, pageWidth];
          }
        }

        const availableWidth = pageWidth - marginPx * 2;
        const availableHeight = pageHeight - marginPx * 2;

        await execAsync(`
          convert "${imgPath}" \
            -resize ${availableWidth}x${availableHeight} \
            -gravity center \
            -background white \
            -extent ${pageWidth}x${pageHeight} \
            -units PixelsPerInch \
            -density 72 \
            "${pagePath}"
        `);

        pdfPages.push(pagePath);
      }

      if (pdfPages.length === 1) {
        await fs.copyFile(pdfPages[0], outputPath);
      } else {
        try {
          await execAsync(`pdfunite ${pdfPages.map(p => \`"\${p}"\`).join(' ')} "${outputPath}"`);
        } catch (e) {
          await execAsync(`convert ${pdfPages.map(p => \`"\${p}"\`).join(' ')} "${outputPath}"`);
        }
      }
    }

    await fs.access(outputPath);
    tempFiles.push(outputPath);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="images-to-pdf.pdf"');
    
    res.sendFile(outputPath, async (err) => {
      await cleanupFiles(tempFiles);
    });

  } catch (error) {
    console.error('Error Image→PDF:', error);
    await cleanupFiles(tempFiles);
    res.status(500).json({ 
      error: 'Error al crear PDF', 
      details: error.message 
    });
  }
});

router.get('/info', (req, res) => {
  res.json({
    supportedFormats: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff'],
    pageSizes: ['a4', 'letter', 'legal', 'fit'],
    orientations: ['auto', 'portrait', 'landscape'],
    margins: ['none', 'small', 'normal'],
    qualities: ['original', 'compressed'],
    limits: {
      maxImages: 200,
      maxFileSize: '50MB per image',
    }
  });
});

module.exports = router;
