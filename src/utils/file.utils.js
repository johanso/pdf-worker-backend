const { exec, execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * Ejecuta un comando con timeout usando execFile (más seguro contra command injection)
 * @param {string} command - Comando a ejecutar
 * @param {string[]} args - Argumentos del comando
 * @param {object} options - Opciones (timeout, cwd, etc.)
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
async function execFileWithTimeout(command, args = [], options = {}) {
  const timeout = options.timeout || 120000; // 2 minutos por defecto

  return execFileAsync(command, args, {
    ...options,
    timeout,
    maxBuffer: 50 * 1024 * 1024, // 50MB buffer
    killSignal: 'SIGKILL'
  });
}

/**
 * Ejecuta comando de shell con timeout (usar solo cuando sea absolutamente necesario)
 * ADVERTENCIA: Vulnerable a command injection si no se sanitizan los inputs
 * @param {string} command - Comando completo
 * @param {object} options - Opciones
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
async function execWithTimeout(command, options = {}) {
  const timeout = options.timeout || 120000;

  return execAsync(command, {
    ...options,
    timeout,
    maxBuffer: 50 * 1024 * 1024,
    killSignal: 'SIGKILL'
  });
}

/**
 * Sanitiza el nombre de archivo para prevenir path traversal y otros ataques
 * @param {string} filename - Nombre de archivo a sanitizar
 * @returns {string} - Nombre de archivo seguro
 */
function sanitizeFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    return 'file';
  }

  // 1. Usar path.basename para eliminar cualquier ruta
  let safe = path.basename(filename);

  // 2. Eliminar caracteres nulos y peligrosos
  safe = safe.replace(/\x00/g, '');

  // 3. Eliminar secuencias de path traversal que pudieran quedar
  safe = safe.replace(/\.\.+/g, '.');

  // 4. Eliminar caracteres no permitidos (mantener letras, números, -, _, .)
  safe = safe.replace(/[^a-zA-Z0-9._-]/g, '_');

  // 5. Prevenir nombres que empiecen con punto (archivos ocultos)
  if (safe.startsWith('.')) {
    safe = '_' + safe;
  }

  // 6. Limitar longitud del nombre (máximo 200 caracteres)
  if (safe.length > 200) {
    const ext = path.extname(safe);
    const nameWithoutExt = safe.slice(0, 200 - ext.length);
    safe = nameWithoutExt + ext;
  }

  // 7. Si quedó vacío, usar un nombre genérico
  if (!safe || safe.length === 0) {
    safe = 'file';
  }

  return safe;
}

module.exports = {
  execAsync, // Deprecated - usar execWithTimeout
  execFileAsync,
  execFileWithTimeout,
  execWithTimeout,
  sanitizeFilename
};
