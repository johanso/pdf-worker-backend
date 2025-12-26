const { execAsync } = require('../utils/file.utils');
const path = require('path');

class WkhtmltopdfService {
  
  async htmlToPdf(input, outputDir, options = {}) {
    const filename = options.isUrl ? 'webpage' : path.basename(input, '.html');
    const outputPath = path.join(outputDir, `${filename}.pdf`);
    
    const pageSize = options.format || 'A4';
    const source = options.isUrl ? input : `file://${input}`;
    
    // Opciones mejoradas para URLs
    const wkOptions = [
      `--page-size ${pageSize}`,
      '--margin-top 20mm',
      '--margin-right 20mm',
      '--margin-bottom 20mm',
      '--margin-left 20mm',
      '--enable-local-file-access',
      '--no-stop-slow-scripts',
      '--enable-javascript',
      '--javascript-delay 1000',
      '--load-error-handling ignore',
      '--load-media-error-handling ignore'
    ].join(' ');
    
    await execAsync(`wkhtmltopdf ${wkOptions} "${source}" "${outputPath}"`);
    
    return outputPath;
  }
}

module.exports = new WkhtmltopdfService();
