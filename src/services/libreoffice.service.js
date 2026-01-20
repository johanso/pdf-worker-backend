const { execFileWithTimeout } = require('../utils/file.utils');
const path = require('path');

class LibreOfficeService {

  async wordToPdf(inputPath, outputDir) {
    const filename = path.basename(inputPath, path.extname(inputPath));
    await execFileWithTimeout('libreoffice', [
      '--headless',
      '--convert-to', 'pdf',
      '--outdir', outputDir,
      inputPath
    ], { timeout: 180000 }); // 3 min timeout para archivos grandes
    return path.join(outputDir, `${filename}.pdf`);
  }

  async pdfToWord(inputPath, outputDir) {
    const filename = path.basename(inputPath, '.pdf');
    await execFileWithTimeout('libreoffice', [
      '--headless',
      '--convert-to', 'docx',
      '--infilter=writer_pdf_import',
      '--outdir', outputDir,
      inputPath
    ], { timeout: 180000 });
    return path.join(outputDir, `${filename}.docx`);
  }

  async excelToPdf(inputPath, outputDir) {
    const filename = path.basename(inputPath, path.extname(inputPath));
    await execFileWithTimeout('libreoffice', [
      '--headless',
      '--convert-to', 'pdf',
      '--outdir', outputDir,
      inputPath
    ], { timeout: 180000 });
    return path.join(outputDir, `${filename}.pdf`);
  }

  async pdfToExcel(inputPath, outputDir) {
    const filename = path.basename(inputPath, '.pdf');
    await execFileWithTimeout('libreoffice', [
      '--headless',
      '--convert-to', 'xlsx',
      '--infilter=calc_pdf_import',
      '--outdir', outputDir,
      inputPath
    ], { timeout: 180000 });
    return path.join(outputDir, `${filename}.xlsx`);
  }

  async pptToPdf(inputPath, outputDir) {
    const filename = path.basename(inputPath, path.extname(inputPath));
    await execFileWithTimeout('libreoffice', [
      '--headless',
      '--convert-to', 'pdf',
      '--outdir', outputDir,
      inputPath
    ], { timeout: 180000 });
    return path.join(outputDir, `${filename}.pdf`);
  }

  async pdfToPpt(inputPath, outputDir) {
    const filename = path.basename(inputPath, '.pdf');
    await execFileWithTimeout('libreoffice', [
      '--headless',
      '--convert-to', 'pptx',
      '--infilter=impress_pdf_import',
      '--outdir', outputDir,
      inputPath
    ], { timeout: 180000 });
    return path.join(outputDir, `${filename}.pptx`);
  }
}

module.exports = new LibreOfficeService();
