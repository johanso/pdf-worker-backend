# PDF Worker - Backend VPS

Servidor Node.js para conversión de documentos PDF.

## Stack Tecnológico
- Node.js 20
- Express
- LibreOffice (Office ↔ PDF)
- wkhtmltopdf (HTML → PDF)
- Ghostscript (Compresión)
- ImageMagick (PDF ↔ Imágenes)
- QPDF (Seguridad)

## Estructura del Proyecto
```
/root/pdf-worker/
├── server.js              # Entry point
├── package.json
├── src/
│   ├── routes/           # Endpoints API
│   ├── services/         # Lógica de conversión
│   ├── middleware/       # Multer, error handling
│   └── utils/           # Helpers
├── uploads/             # Temporal (auto-cleanup)
└── outputs/             # Temporal (auto-cleanup)
```

## Endpoints Disponibles

### Conversiones Office
- POST /api/word-to-pdf
- POST /api/pdf-to-word
- POST /api/excel-to-pdf
- POST /api/pdf-to-excel
- POST /api/ppt-to-pdf
- POST /api/pdf-to-ppt

### HTML
- POST /api/html-to-pdf
- POST /api/html-to-pdf/preview

### Utilidades
- POST /api/compress-pdf
- POST /api/pdf-to-image
- POST /api/protect-pdf
- POST /api/unlock-pdf

### Health Check
- GET /health

## Instalación
```bash
# Dependencias del sistema
apt-get update
apt-get install -y libreoffice ghostscript imagemagick qpdf wkhtmltopdf

# Dependencias Node
npm install

# PM2
npm install -g pm2

# Iniciar servidor
pm2 start server.js --name pdf-worker
pm2 save
pm2 startup
```

## Variables de Entorno
No hay variables de entorno requeridas actualmente.

## Deployment
- VPS: Hostinger KVM 2 (2 vCPU, 8GB RAM)
- IP: 145.223.126.240
- Puerto: 3001
- Process Manager: PM2

## Comandos Útiles
```bash
# Ver logs
pm2 logs pdf-worker

# Reiniciar
pm2 restart pdf-worker

# Estado
pm2 status

# Monitoreo
pm2 monit
```

## Mantenimiento
- Auto-cleanup: Archivos >1 hora se eliminan automáticamente
- Logs: Rotan automáticamente con PM2

## API Client (Frontend)
Ver documentación en el repositorio del frontend.
