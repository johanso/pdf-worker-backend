const { execFileWithTimeout } = require('../utils/file.utils');
const path = require('path');

class QpdfService {

  async encryptPdf(inputPath, outputDir, password) {
    const filename = path.basename(inputPath, '.pdf');
    const outputPath = path.join(outputDir, `${filename}-protected.pdf`);

    // Usar execFile para prevenir command injection
    await execFileWithTimeout('qpdf', [
      '--encrypt', password, password, '256', '--',
      inputPath,
      outputPath
    ]);

    return outputPath;
  }

  async decryptPdf(inputPath, outputDir, password) {
    const filename = path.basename(inputPath, '.pdf');
    const outputPath = path.join(outputDir, `${filename}-unlocked.pdf`);

    // Usar execFile para prevenir command injection
    await execFileWithTimeout('qpdf', [
      '--decrypt',
      `--password=${password}`,
      inputPath,
      outputPath
    ]);

    return outputPath;
  }
}

module.exports = new QpdfService();
