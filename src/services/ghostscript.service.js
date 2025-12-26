const { execAsync } = require('../utils/file.utils');
const path = require('path');

class GhostscriptService {
  
  async compressPdf(inputPath, outputDir, quality = 'medium') {
    const filename = path.basename(inputPath, '.pdf');
    const outputPath = path.join(outputDir, `${filename}-compressed.pdf`);
    
    const qualitySettings = {
      low: '/screen',
      medium: '/ebook',
      high: '/printer'
    };
    
    const dpiSettings = {
      low: '72',
      medium: '150',
      high: '300'
    };
    
    await execAsync(`
      gs -sDEVICE=pdfwrite \\
         -dCompatibilityLevel=1.4 \\
         -dPDFSETTINGS=${qualitySettings[quality]} \\
         -dNOPAUSE \\
         -dQUIET \\
         -dBATCH \\
         -dColorImageResolution=${dpiSettings[quality]} \\
         -dGrayImageResolution=${dpiSettings[quality]} \\
         -dMonoImageResolution=${dpiSettings[quality]} \\
         -sOutputFile="${outputPath}" \\
         "${inputPath}"
    `);
    
    return outputPath;
  }
}

module.exports = new GhostscriptService();
