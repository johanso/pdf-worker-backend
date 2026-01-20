const { execFileWithTimeout } = require('../utils/file.utils');
const path = require('path');
const fs = require('fs').promises;

class ImageMagickService {

  async pdfToImages(inputPath, outputDir, format = 'jpg', quality = 90, dpi = 300) {
    const filename = path.basename(inputPath, '.pdf');
    const outputPattern = path.join(outputDir, `${filename}-%03d.${format}`);

    await execFileWithTimeout('convert', [
      '-density', String(dpi),
      '-quality', String(quality),
      inputPath,
      outputPattern
    ], { timeout: 240000 }); // 4 min timeout

    const files = await fs.readdir(outputDir);
    return files
      .filter(f => f.startsWith(filename) && f.endsWith(`.${format}`))
      .map(f => path.join(outputDir, f));
  }

  async imagesToPdf(imagePaths, outputDir) {
    const outputPath = path.join(outputDir, `images-${Date.now()}.pdf`);

    // Pasar todas las rutas de imágenes como argumentos separados
    await execFileWithTimeout('convert', [
      ...imagePaths,
      '-quality', '95',
      outputPath
    ], { timeout: 240000 });

    return outputPath;
  }
}

module.exports = new ImageMagickService();
