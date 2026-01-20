const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'PDF Worker API',
      version: '1.0.0',
      description: 'API completa para procesamiento de documentos PDF con múltiples herramientas',
      contact: {
        name: 'API Support'
      }
    },
    servers: [
      {
        url: 'http://localhost:3001',
        description: 'Servidor de desarrollo'
      },
      {
        url: 'https://api.tu-dominio.com',
        description: 'Servidor de producción'
      }
    ],
    tags: [
      { name: 'Health', description: 'Estado del servidor' },
      { name: 'Download', description: 'Descarga de archivos procesados' },
      { name: 'Office → PDF', description: 'Conversión de documentos Office a PDF' },
      { name: 'PDF → Office', description: 'Conversión de PDF a documentos Office' },
      { name: 'Manipulación PDF', description: 'Operaciones de manipulación de PDFs' },
      { name: 'Compresión y Optimización', description: 'Compresión y optimización de PDFs' },
      { name: 'Imágenes', description: 'Conversión entre PDF e imágenes' },
      { name: 'Seguridad', description: 'Protección y desbloqueo de PDFs' },
      { name: 'OCR', description: 'Reconocimiento óptico de caracteres' },
      { name: 'HTML → PDF', description: 'Conversión de HTML a PDF' },
      { name: 'Utilidades', description: 'Reparación, firma y otras utilidades' }
    ],
    components: {
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Mensaje de error'
            },
            code: {
              type: 'string',
              description: 'Código de error'
            }
          }
        },
        SuccessResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            fileId: {
              type: 'string',
              description: 'ID del archivo procesado para descarga'
            },
            filename: {
              type: 'string',
              description: 'Nombre del archivo generado'
            },
            downloadUrl: {
              type: 'string',
              description: 'URL para descargar el archivo'
            }
          }
        }
      }
    }
  },
  apis: ['./src/routes/*.js', './server.js']
};

module.exports = swaggerJsdoc(options);
