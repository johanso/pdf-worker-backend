const { PDFDocument, rgb, degrees, StandardFonts } = require('pdf-lib');
const fs = require('fs').promises;

/**
 * Posiciones predefinidas para las marcas de agua
 */
const POSITIONS = {
  center: 'center',
  topLeft: 'top-left',
  topRight: 'top-right',
  bottomLeft: 'bottom-left',
  bottomRight: 'bottom-right',
  diagonal: 'diagonal',
  custom: 'custom'
};

/**
 * Fuentes disponibles en pdf-lib
 */
const FONTS = {
  'Helvetica': StandardFonts.Helvetica,
  'Helvetica-Bold': StandardFonts.HelveticaBold,
  'Helvetica-Oblique': StandardFonts.HelveticaOblique,
  'Helvetica-BoldOblique': StandardFonts.HelveticaBoldOblique,
  'Times-Roman': StandardFonts.TimesRoman,
  'Times-Bold': StandardFonts.TimesRomanBold,
  'Times-Italic': StandardFonts.TimesRomanItalic,
  'Times-BoldItalic': StandardFonts.TimesRomanBoldItalic,
  'Courier': StandardFonts.Courier,
  'Courier-Bold': StandardFonts.CourierBold,
  'Courier-Oblique': StandardFonts.CourierOblique,
  'Courier-BoldOblique': StandardFonts.CourierBoldOblique
};

/**
 * Convierte un color hexadecimal a RGB
 * @param {string} hex - Color en formato hex (ej: "#FF0000" o "FF0000")
 * @returns {object} - Objeto con valores r, g, b entre 0 y 1
 */
function hexToRgb(hex) {
  // Remover el # si existe
  hex = hex.replace('#', '');

  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  return { r, g, b };
}

/**
 * Calcula las coordenadas según la posición especificada
 * @param {string} position - Posición (center, top-left, etc.)
 * @param {number} pageWidth - Ancho de la página
 * @param {number} pageHeight - Alto de la página
 * @param {number} contentWidth - Ancho del contenido (texto o imagen)
 * @param {number} contentHeight - Alto del contenido
 * @param {object} customPosition - Posición personalizada {x, y}
 * @returns {object} - Coordenadas {x, y}
 */
function calculatePosition(position, pageWidth, pageHeight, contentWidth, contentHeight, customPosition = {}) {
  const margin = 50; // Margen desde los bordes

  switch (position) {
    case POSITIONS.center:
      return {
        x: (pageWidth - contentWidth) / 2,
        y: (pageHeight - contentHeight) / 2
      };

    case POSITIONS.topLeft:
      return {
        x: margin,
        y: pageHeight - contentHeight - margin
      };

    case POSITIONS.topRight:
      return {
        x: pageWidth - contentWidth - margin,
        y: pageHeight - contentHeight - margin
      };

    case POSITIONS.bottomLeft:
      return {
        x: margin,
        y: margin
      };

    case POSITIONS.bottomRight:
      return {
        x: pageWidth - contentWidth - margin,
        y: margin
      };

    case POSITIONS.diagonal:
      // Diagonal desde abajo izquierda hacia arriba derecha (centro de la diagonal)
      return {
        x: pageWidth / 2,
        y: pageHeight / 2
      };

    case POSITIONS.custom:
      return {
        x: customPosition.x || 0,
        y: customPosition.y || 0
      };

    default:
      return {
        x: (pageWidth - contentWidth) / 2,
        y: (pageHeight - contentHeight) / 2
      };
  }
}

/**
 * Agrega marca de agua de texto a un PDF
 * @param {Buffer} pdfBuffer - Buffer del PDF original
 * @param {object} options - Opciones de la marca de agua
 * @returns {Promise<{pdfBytes: Buffer, pageNumbers: number[]}>} - PDF con marca de agua y páginas procesadas
 */
async function addTextWatermark(pdfBuffer, options) {
  const {
    text = 'CONFIDENTIAL',
    fontSize = 48,
    fontName = 'Helvetica-Bold',
    color = '#FF0000',
    opacity = 0.5,
    rotation = 45,
    position = POSITIONS.center,
    customPosition = {},
    pages = 'all', // 'all' o array de números de página [1, 2, 3]
    pattern = false, // Modo patrón repetido
    patternSpacing = 200 // Espaciado entre repeticiones en modo patrón
  } = options;

  const pdfDoc = await PDFDocument.load(pdfBuffer);

  // Seleccionar fuente
  const fontKey = FONTS[fontName] || StandardFonts.HelveticaBold;
  const font = await pdfDoc.embedFont(fontKey);

  const colorRgb = hexToRgb(color);
  const totalPages = pdfDoc.getPageCount();

  // Determinar qué páginas procesar
  const pagesToProcess = pages === 'all'
    ? Array.from({ length: totalPages }, (_, i) => i)
    : pages.map(p => p - 1); // Convertir a índice base 0

  const processedPages = [];

  for (const pageIndex of pagesToProcess) {
    if (pageIndex < 0 || pageIndex >= totalPages) {
      continue; // Saltar páginas inválidas
    }

    const page = pdfDoc.getPage(pageIndex);
    const { width, height } = page.getSize();

    // Calcular dimensiones del texto
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    const textHeight = fontSize;

    if (pattern) {
      // Modo patrón: repetir la marca de agua por toda la página
      const rotationRad = (rotation * Math.PI) / 180;
      const spacingX = patternSpacing;
      const spacingY = patternSpacing;

      // Calcular cuántas repeticiones necesitamos
      const numCols = Math.ceil(width / spacingX) + 2;
      const numRows = Math.ceil(height / spacingY) + 2;

      for (let row = -1; row < numRows; row++) {
        for (let col = -1; col < numCols; col++) {
          const x = col * spacingX;
          const y = row * spacingY;

          page.drawText(text, {
            x: x,
            y: y,
            size: fontSize,
            font: font,
            color: rgb(colorRgb.r, colorRgb.g, colorRgb.b),
            opacity: opacity,
            rotate: degrees(rotation)
          });
        }
      }
    } else {
      // Modo normal: una sola marca de agua
      const coords = calculatePosition(
        position,
        width,
        height,
        textWidth,
        textHeight,
        customPosition
      );

      page.drawText(text, {
        x: coords.x,
        y: coords.y,
        size: fontSize,
        font: font,
        color: rgb(colorRgb.r, colorRgb.g, colorRgb.b),
        opacity: opacity,
        rotate: degrees(rotation)
      });
    }

    processedPages.push(pageIndex + 1); // Guardar número de página (base 1)
  }

  const pdfBytes = await pdfDoc.save();

  return {
    pdfBytes,
    pageNumbers: processedPages,
    totalPages
  };
}

/**
 * Agrega marca de agua de imagen a un PDF
 * @param {Buffer} pdfBuffer - Buffer del PDF original
 * @param {Buffer} imageBuffer - Buffer de la imagen (PNG o JPG)
 * @param {object} options - Opciones de la marca de agua
 * @returns {Promise<{pdfBytes: Buffer, pageNumbers: number[]}>} - PDF con marca de agua y páginas procesadas
 */
async function addImageWatermark(pdfBuffer, imageBuffer, options) {
  const {
    width = 200,
    height = null, // Si es null, se calcula para mantener aspect ratio
    opacity = 0.5,
    position = POSITIONS.center,
    customPosition = {},
    maintainAspectRatio = true,
    pages = 'all', // 'all' o array de números de página [1, 2, 3]
    pattern = false, // Modo patrón repetido
    patternSpacing = 250 // Espaciado entre repeticiones en modo patrón
  } = options;

  const pdfDoc = await PDFDocument.load(pdfBuffer);

  // Detectar tipo de imagen y embedear
  let image;
  try {
    // Intentar como PNG primero
    image = await pdfDoc.embedPng(imageBuffer);
  } catch (e) {
    try {
      // Si falla, intentar como JPG
      image = await pdfDoc.embedJpg(imageBuffer);
    } catch (e2) {
      throw new Error('Formato de imagen no soportado. Use PNG o JPG');
    }
  }

  // Calcular dimensiones manteniendo aspect ratio si es necesario
  const imageDims = image.scale(1);
  let finalWidth = width;
  let finalHeight = height;

  if (maintainAspectRatio) {
    const aspectRatio = imageDims.width / imageDims.height;
    finalWidth = width;
    finalHeight = height || (width / aspectRatio);
  } else if (!height) {
    finalHeight = width; // Si no se mantiene aspect ratio y no hay height, usar width
  }

  const totalPages = pdfDoc.getPageCount();

  // Determinar qué páginas procesar
  const pagesToProcess = pages === 'all'
    ? Array.from({ length: totalPages }, (_, i) => i)
    : pages.map(p => p - 1); // Convertir a índice base 0

  const processedPages = [];

  for (const pageIndex of pagesToProcess) {
    if (pageIndex < 0 || pageIndex >= totalPages) {
      continue; // Saltar páginas inválidas
    }

    const page = pdfDoc.getPage(pageIndex);
    const { width: pageWidth, height: pageHeight } = page.getSize();

    if (pattern) {
      // Modo patrón: repetir la imagen por toda la página
      const spacingX = patternSpacing;
      const spacingY = patternSpacing;

      // Calcular cuántas repeticiones necesitamos
      const numCols = Math.ceil(pageWidth / spacingX) + 1;
      const numRows = Math.ceil(pageHeight / spacingY) + 1;

      for (let row = 0; row < numRows; row++) {
        for (let col = 0; col < numCols; col++) {
          const x = col * spacingX;
          const y = row * spacingY;

          page.drawImage(image, {
            x: x,
            y: y,
            width: finalWidth,
            height: finalHeight,
            opacity: opacity
          });
        }
      }
    } else {
      // Modo normal: una sola imagen
      const coords = calculatePosition(
        position,
        pageWidth,
        pageHeight,
        finalWidth,
        finalHeight,
        customPosition
      );

      page.drawImage(image, {
        x: coords.x,
        y: coords.y,
        width: finalWidth,
        height: finalHeight,
        opacity: opacity
      });
    }

    processedPages.push(pageIndex + 1); // Guardar número de página (base 1)
  }

  const pdfBytes = await pdfDoc.save();

  return {
    pdfBytes,
    pageNumbers: processedPages,
    totalPages
  };
}

module.exports = {
  addTextWatermark,
  addImageWatermark,
  POSITIONS,
  FONTS
};
