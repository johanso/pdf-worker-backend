const { exec, execFile } = require('child_process');
const { promisify } = require('util');

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

module.exports = {
  execAsync, // Deprecated - usar execWithTimeout
  execFileAsync,
  execFileWithTimeout,
  execWithTimeout
};
