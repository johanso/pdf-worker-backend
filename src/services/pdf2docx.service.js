const { execAsync } = require('../utils/file.utils');
const path = require('path');

class Pdf2DocxService {
  
  async pdfToWord(inputPath, outputDir) {
    const filename = path.basename(inputPath, '.pdf');
    const outputPath = path.join(outputDir, `${filename}.docx`);
    
    // Usar pdf2docx desde Python
    await execAsync(`python3 -c "
from pdf2docx import Converter
cv = Converter('${inputPath}')
cv.convert('${outputPath}', start=0, end=None)
cv.close()
"`);
    
    return outputPath;
  }
}

module.exports = new Pdf2DocxService();
