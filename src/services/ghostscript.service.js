const { execAsync } = require('../utils/file.utils');
const path = require('path');
const fs = require('fs').promises;

class GhostscriptService {
  
  /**
   * Presets de compresión simplificados (sin estimaciones falsas)
   */
  getPresets() {
    return {
      extreme: {
        name: 'Compresión Extrema',
        description: 'Menor tamaño, menos calidad',
        pdfSettings: '/screen',
        dpi: 72,
        imageQuality: 40
      },
      recommended: {
        name: 'Compresión Recomendada', 
        description: 'Buen balance calidad/tamaño',
        pdfSettings: '/ebook',
        dpi: 120,
        imageQuality: 60
      },
      low: {
        name: 'Baja Compresión',
        description: 'Alta calidad, archivo más grande',
        pdfSettings: '/printer',
        dpi: 200,
        imageQuality: 85
      }
    };
  }

  /**
   * Comprime PDF con preset (modo simple) - OPTIMIZADO PARA VELOCIDAD
   */
  async compressPdfWithPreset(inputPath, outputDir, preset = 'recommended') {
    const presets = this.getPresets();
    const config = presets[preset] || presets.recommended;
    
    return this.compressPdf(inputPath, outputDir, {
      dpi: config.dpi,
      imageQuality: config.imageQuality,
      pdfSettings: config.pdfSettings
    });
  }

  /**
   * Comprime PDF - OPTIMIZADO PARA VELOCIDAD
   */
  async compressPdf(inputPath, outputDir, options = {}) {
    const {
      dpi = 120,
      imageQuality = 60,
      pdfSettings = '/ebook'
    } = options;

    const filename = path.basename(inputPath, '.pdf');
    const timestamp = Date.now();
    const outputPath = path.join(outputDir, `${filename}-compressed-${timestamp}.pdf`);
    
    const finalDpi = Math.max(36, Math.min(600, parseInt(dpi) || 120));
    const finalQuality = Math.max(10, Math.min(100, parseInt(imageQuality) || 60));
    
    // Comando OPTIMIZADO - menos parámetros, más rápido
    const cmd = `gs -sDEVICE=pdfwrite \
      -dCompatibilityLevel=1.4 \
      -dPDFSETTINGS=${pdfSettings} \
      -dNOPAUSE -dQUIET -dBATCH \
      -dFastWebView=true \
      -dDetectDuplicateImages=true \
      -dCompressFonts=true \
      -dSubsetFonts=true \
      -dColorImageResolution=${finalDpi} \
      -dGrayImageResolution=${finalDpi} \
      -dMonoImageResolution=${finalDpi} \
      -dJPEGQ=${finalQuality} \
      -sOutputFile="${outputPath}" \
      "${inputPath}"`;

    console.log(`[Compress] Preset DPI: ${finalDpi}, Quality: ${finalQuality}`);
    const startTime = Date.now();
    
    await execAsync(cmd);
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Compress] Completed in ${elapsed}s`);
    
    await fs.access(outputPath);
    return outputPath;
  }
}

module.exports = new GhostscriptService();
