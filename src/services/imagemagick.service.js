const { execAsync } = require('../utils/file.utils');
const path = require('path');
const fs = require('fs').promises;

class ImageMagickService {
  
  async pdfToImages(inputPath, outputDir, format = 'jpg', quality = 90, dpi = 300) {
    const filename = path.basename(inputPath, '.pdf');
    const outputPattern = path.join(outputDir, `${filename}-%03d.${format}`);
    
    await execAsync(`
      convert -density ${dpi} \
              -quality ${quality} \
              "${inputPath}" \
              "${outputPattern}"
    `);
    
    const files = await fs.readdir(outputDir);
    return files
      .filter(f => f.startsWith(filename) && f.endsWith(`.${format}`))
      .map(f => path.join(outputDir, f));
  }
  
  async imagesToPdf(imagePaths, outputDir) {
    const outputPath = path.join(outputDir, `images-${Date.now()}.pdf`);
    const imagesStr = imagePaths.map(p => `"${p}"`).join(' ');
    
    await execAsync(`
      convert ${imagesStr} \
              -quality 95 \
              "${outputPath}"
    `);
    
    return outputPath;
  }
}

module.exports = new ImageMagickService();
