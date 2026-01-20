# Deployment al VPS

Esta guía explica cómo deployar el proyecto al VPS con la configuración de seguridad.

## Paso 1: Subir el Código (Sin .env)

```bash
# En tu máquina local
git add .
git commit -m "security: complete security hardening"
git push origin master
```

**IMPORTANTE:** El archivo `.env` NO se sube a git (está en `.gitignore`).

## Paso 2: Actualizar el Código en el VPS

```bash
# Conectar al VPS
ssh root@tu-vps-ip

# Ir al directorio del proyecto
cd /root/pdf-worker-backend  # o donde esté tu proyecto

# Pull del código nuevo
git pull origin master

# Instalar nuevas dependencias
npm install
```

## Paso 3: Crear el Archivo .env en el VPS

### Opción A: Copiar desde plantilla y editar

```bash
# Copiar la plantilla
cp .env.example .env

# Editar con nano
nano .env
```

En nano, configura tus valores:

```bash
# ===== CONFIGURACIÓN DEL SERVIDOR =====
PORT=3001
NODE_ENV=production

# ===== SEGURIDAD - CORS =====
# IMPORTANTE: Cambia esto por tu dominio real
ALLOWED_ORIGINS=https://tu-dominio.com,https://www.tu-dominio.com
```

Guardar: `Ctrl+X` → `Y` → `Enter`

### Opción B: Crear con un solo comando

```bash
cat > .env << 'EOF'
PORT=3001
NODE_ENV=production
ALLOWED_ORIGINS=https://tu-dominio.com,https://www.tu-dominio.com
EOF
```

### Opción C: Usar echo (rápido)

```bash
echo "PORT=3001" > .env
echo "NODE_ENV=production" >> .env
echo "ALLOWED_ORIGINS=https://tu-dominio.com,https://www.tu-dominio.com" >> .env
```

## Paso 4: Verificar el Archivo .env

```bash
# Ver el contenido
cat .env

# Verificar que tiene los permisos correctos
ls -la .env

# Debe ser:
# -rw-r--r-- 1 root root ... .env
```

### Cambiar permisos si es necesario (solo root puede leer)

```bash
chmod 600 .env
```

Ahora el archivo será:
```
-rw------- 1 root root ... .env
```

Solo el owner (root) puede leer/escribir.

## Paso 5: Reiniciar PM2

```bash
# Reiniciar la aplicación
pm2 restart pdf-worker

# Ver los logs para verificar CORS
pm2 logs pdf-worker --lines 50
```

Debes ver algo como:
```
[CORS] Orígenes permitidos: https://tu-dominio.com, https://www.tu-dominio.com
```

## Paso 6: Verificar que Funciona

### Test 1: Health check

```bash
curl http://localhost:3001/health
```

Debe retornar:
```json
{"status":"ok","timestamp":"..."}
```

### Test 2: Verificar CORS desde tu frontend

Abre tu frontend (https://tu-dominio.com) y en la consola del navegador:

```javascript
fetch('https://api.tu-dominio.com/health')
  .then(r => r.json())
  .then(console.log);
```

Debe funcionar. Si pruebas desde otro dominio:

```javascript
// En consola de google.com
fetch('https://api.tu-dominio.com/health')
  .then(r => r.json());
```

Debe dar error CORS (esto es correcto).

## Troubleshooting

### Error: "No está permitido por CORS"

**Causa:** El dominio del frontend no está en `ALLOWED_ORIGINS`

**Solución:**
```bash
# Editar .env
nano .env

# Agregar el dominio (separado por coma, sin espacios)
ALLOWED_ORIGINS=https://tu-dominio.com,https://www.tu-dominio.com,https://otro-dominio.com

# Reiniciar
pm2 restart pdf-worker
```

### Error: Variables de entorno no se cargan

**Causa:** PM2 no lee el .env automáticamente

**Solución 1:** Reiniciar PM2
```bash
pm2 restart pdf-worker
```

**Solución 2:** Configurar PM2 ecosystem
```bash
# Crear ecosystem.config.js
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'pdf-worker',
    script: './server.js',
    env: {
      PORT: 3001,
      NODE_ENV: 'production'
    },
    env_file: '.env'
  }]
}
EOF

# Usar ecosystem
pm2 delete pdf-worker
pm2 start ecosystem.config.js
pm2 save
```

### .env no existe en el VPS

**Verificar:**
```bash
ls -la .env
```

Si no existe:
```bash
cp .env.example .env
nano .env
```

## Seguridad del .env

### ✅ Buenas Prácticas

1. **NUNCA subir .env a git**
   - Ya está en `.gitignore`
   - Verificar: `cat .gitignore | grep .env`

2. **Permisos restrictivos**
   ```bash
   chmod 600 .env  # Solo owner puede leer
   ```

3. **Diferentes valores por entorno**
   - Desarrollo: `.env` en local
   - Producción: `.env` en VPS
   - Valores diferentes en cada uno

4. **Backup seguro del .env**
   ```bash
   # Backup local (NO en git)
   cp .env .env.backup

   # O guardar en password manager (1Password, LastPass, etc.)
   ```

### ❌ Errores Comunes

1. ❌ Subir .env a git
   ```bash
   # Verificar que NO esté staged
   git status  # No debe aparecer .env
   ```

2. ❌ Compartir .env por email/Slack
   - Usar canales seguros
   - O regenerar secrets después

3. ❌ Hardcodear valores en el código
   ```javascript
   // ❌ MAL
   const ALLOWED_ORIGINS = 'https://tu-dominio.com';

   // ✅ BIEN
   const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS;
   ```

## Actualizar ALLOWED_ORIGINS

Si agregas un nuevo dominio:

```bash
# 1. SSH al VPS
ssh root@tu-vps-ip

# 2. Editar .env
cd /root/pdf-worker-backend
nano .env

# 3. Agregar el dominio
ALLOWED_ORIGINS=https://tu-dominio.com,https://www.tu-dominio.com,https://nuevo-dominio.com

# 4. Reiniciar
pm2 restart pdf-worker

# 5. Verificar logs
pm2 logs pdf-worker --lines 20
```

## Múltiples Entornos

Si tienes staging/producción:

```bash
# Staging (.env en staging)
ALLOWED_ORIGINS=https://staging.tu-dominio.com

# Producción (.env en producción)
ALLOWED_ORIGINS=https://tu-dominio.com,https://www.tu-dominio.com
```

## Variables de Entorno desde PM2

Alternativa: pasar variables directamente a PM2:

```bash
pm2 delete pdf-worker

pm2 start server.js --name pdf-worker \
  --env PORT=3001 \
  --env NODE_ENV=production \
  --env ALLOWED_ORIGINS="https://tu-dominio.com,https://www.tu-dominio.com"

pm2 save
```

Pero `.env` es más fácil de mantener.

## Resumen del Proceso

1. ✅ Hacer commit del código (sin .env)
2. ✅ Push a git
3. ✅ SSH al VPS
4. ✅ Git pull
5. ✅ npm install
6. ✅ Crear .env manualmente
7. ✅ Configurar ALLOWED_ORIGINS
8. ✅ pm2 restart
9. ✅ Verificar logs

**¡Listo!** Tu API ahora tiene CORS configurado.
