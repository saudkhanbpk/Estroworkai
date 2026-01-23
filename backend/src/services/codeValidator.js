/**
 * Code Validator Service
 * Validates generated code before showing preview
 * Checks for common issues and provides fixes
 */

const dockerUtils = require('../utils/docker');
const errorHandler = require('../utils/errorHandler');
const logger = require('../utils/logger');

/**
 * Validation result structure
 */
class ValidationResult {
  constructor() {
    this.valid = true;
    this.errors = [];
    this.warnings = [];
    this.checks = [];
    this.fixes = [];
  }

  addError(error) {
    this.valid = false;
    this.errors.push(error);
  }

  addWarning(warning) {
    this.warnings.push(warning);
  }

  addCheck(name, passed, details = null) {
    this.checks.push({ name, passed, details });
    if (!passed && details?.severity === 'error') {
      this.valid = false;
    }
  }

  addFix(fix) {
    this.fixes.push(fix);
  }
}

/**
 * Check if required files exist
 */
async function checkRequiredFiles(containerId, projectType) {
  const checks = [];

  if (projectType === 'vite' || projectType === 'react') {
    const requiredFiles = [
      { path: '/workspace/package.json', critical: true },
      { path: '/workspace/vite.config.js', critical: true },
      { path: '/workspace/index.html', critical: true },
      { path: '/workspace/src/main.jsx', critical: false },
      { path: '/workspace/src/App.jsx', critical: false },
    ];

    for (const file of requiredFiles) {
      const result = await dockerUtils.execCommand(
        containerId,
        `[ -f '${file.path}' ] && echo "EXISTS" || echo "MISSING"`
      );
      const exists = result.output?.trim() === 'EXISTS';
      checks.push({
        file: file.path,
        exists,
        critical: file.critical,
      });
    }
  } else if (projectType === 'static') {
    const result = await dockerUtils.execCommand(
      containerId,
      `[ -f '/workspace/index.html' ] && echo "EXISTS" || echo "MISSING"`
    );
    checks.push({
      file: '/workspace/index.html',
      exists: result.output?.trim() === 'EXISTS',
      critical: true,
    });
  }

  return checks;
}

/**
 * Check if dependencies are installed
 */
async function checkDependencies(containerId) {
  const result = {
    hasNodeModules: false,
    hasPackageLock: false,
    missingCritical: [],
  };

  // Check node_modules exists
  const nodeModulesCheck = await dockerUtils.execCommand(
    containerId,
    `[ -d '/workspace/node_modules' ] && echo "EXISTS" || echo "MISSING"`
  );
  result.hasNodeModules = nodeModulesCheck.output?.trim() === 'EXISTS';

  // Check package-lock exists
  const packageLockCheck = await dockerUtils.execCommand(
    containerId,
    `[ -f '/workspace/package-lock.json' ] && echo "EXISTS" || echo "MISSING"`
  );
  result.hasPackageLock = packageLockCheck.output?.trim() === 'EXISTS';

  // Check critical dependencies
  const criticalDeps = [
    { name: 'react', path: 'react' },
    { name: 'react-dom', path: 'react-dom' },
    { name: '@vitejs/plugin-react', path: '@vitejs/plugin-react' },
    { name: 'vite', path: 'vite' },
    { name: 'caniuse-lite', path: 'caniuse-lite' },
    { name: 'browserslist', path: 'browserslist' },
  ];

  for (const dep of criticalDeps) {
    const checkResult = await dockerUtils.execCommand(
      containerId,
      `[ -d '/workspace/node_modules/${dep.path}' ] && echo "EXISTS" || echo "MISSING"`
    );
    if (checkResult.output?.trim() === 'MISSING') {
      result.missingCritical.push(dep.name);
    }
  }

  return result;
}

/**
 * Check for syntax errors in JavaScript/JSX files
 */
async function checkSyntax(containerId) {
  const errors = [];

  // Use node to check syntax of main files
  const filesToCheck = [
    '/workspace/src/main.jsx',
    '/workspace/src/App.jsx',
    '/workspace/vite.config.js',
  ];

  for (const file of filesToCheck) {
    // First check if file exists
    const existsCheck = await dockerUtils.execCommand(
      containerId,
      `[ -f '${file}' ] && echo "EXISTS" || echo "MISSING"`
    );

    if (existsCheck.output?.trim() === 'MISSING') continue;

    // Check syntax using node --check (for .js files) or babel for JSX
    if (file.endsWith('.jsx')) {
      // For JSX, we'll check if it can be parsed by reading and looking for common issues
      const content = await dockerUtils.readFile(containerId, file);

      // Check for common JSX issues
      if (content.output) {
        // Count brackets to detect obvious mismatches
        const openBrackets = (content.output.match(/\{/g) || []).length;
        const closeBrackets = (content.output.match(/\}/g) || []).length;
        const openParens = (content.output.match(/\(/g) || []).length;
        const closeParens = (content.output.match(/\)/g) || []).length;

        if (openBrackets !== closeBrackets) {
          errors.push({
            file,
            type: 'syntax',
            message: 'Mismatched curly braces { }',
          });
        }

        if (openParens !== closeParens) {
          errors.push({
            file,
            type: 'syntax',
            message: 'Mismatched parentheses ( )',
          });
        }

        // Check for common issues
        if (content.output.includes('import React') && !content.output.includes('from')) {
          errors.push({
            file,
            type: 'syntax',
            message: 'Incomplete import statement',
          });
        }
      }
    } else {
      // For regular JS, use node --check
      const syntaxCheck = await dockerUtils.execCommand(
        containerId,
        `node --check '${file}' 2>&1`,
        { timeout: 5000 }
      );

      if (syntaxCheck.exitCode !== 0 && syntaxCheck.output) {
        errors.push({
          file,
          type: 'syntax',
          message: syntaxCheck.output,
        });
      }
    }
  }

  return errors;
}

/**
 * Check server logs for runtime errors
 */
async function checkServerLogs(containerId) {
  const result = await dockerUtils.execCommand(
    containerId,
    'cat /tmp/server.log 2>/dev/null | tail -50'
  );

  if (!result.output) {
    return { hasLogs: false, errors: [], warnings: [] };
  }

  const parsedErrors = errorHandler.parseErrors(result.output);
  const errors = parsedErrors.filter(e =>
    e.severity === errorHandler.ErrorSeverity.HIGH ||
    e.severity === errorHandler.ErrorSeverity.CRITICAL
  );
  const warnings = parsedErrors.filter(e =>
    e.severity === errorHandler.ErrorSeverity.LOW ||
    e.severity === errorHandler.ErrorSeverity.MEDIUM
  );

  return {
    hasLogs: true,
    errors,
    warnings,
    raw: result.output,
  };
}

/**
 * Check if the dev server is running
 */
async function checkServerStatus(containerId) {
  const result = await dockerUtils.execCommand(
    containerId,
    'pgrep -f "node|vite|serve" > /dev/null && echo "RUNNING" || echo "STOPPED"'
  );

  const isRunning = result.output?.trim() === 'RUNNING';

  // Try to check if server is responding
  let isResponding = false;
  if (isRunning) {
    const healthCheck = await dockerUtils.execCommand(
      containerId,
      'curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null || echo "000"',
      { timeout: 5000 }
    );
    const statusCode = parseInt(healthCheck.output?.trim() || '000', 10);
    isResponding = statusCode >= 200 && statusCode < 500;
  }

  return {
    isRunning,
    isResponding,
  };
}

/**
 * Detect project type
 */
async function detectProjectType(containerId) {
  // Check for Vite config
  const viteCheck = await dockerUtils.execCommand(
    containerId,
    '[ -f /workspace/vite.config.js ] || [ -f /workspace/vite.config.ts ] && echo "VITE" || echo "NO"'
  );

  if (viteCheck.output?.trim() === 'VITE') {
    return 'vite';
  }

  // Check for Next.js
  const nextCheck = await dockerUtils.execCommand(
    containerId,
    '[ -f /workspace/next.config.js ] || [ -f /workspace/next.config.mjs ] && echo "NEXT" || echo "NO"'
  );

  if (nextCheck.output?.trim() === 'NEXT') {
    return 'nextjs';
  }

  // Check for package.json with react
  const packageCheck = await dockerUtils.execCommand(
    containerId,
    'cat /workspace/package.json 2>/dev/null | grep -q "react" && echo "REACT" || echo "NO"'
  );

  if (packageCheck.output?.trim() === 'REACT') {
    return 'react';
  }

  // Check for simple HTML
  const htmlCheck = await dockerUtils.execCommand(
    containerId,
    '[ -f /workspace/index.html ] && echo "HTML" || echo "NO"'
  );

  if (htmlCheck.output?.trim() === 'HTML') {
    return 'static';
  }

  return 'unknown';
}

/**
 * Main validation function
 * @param {string} containerId - Docker container ID
 * @returns {ValidationResult} Complete validation result
 */
async function validateWorkspace(containerId) {
  const validation = new ValidationResult();

  try {
    // 1. Detect project type
    const projectType = await detectProjectType(containerId);
    validation.addCheck('Project Detection', true, { projectType });

    if (projectType === 'unknown') {
      validation.addWarning({
        title: 'Unknown Project Type',
        message: 'Could not determine the project type.',
        suggestion: 'Make sure you have a valid project structure.',
      });
    }

    // 2. Check required files
    const fileChecks = await checkRequiredFiles(containerId, projectType);
    const missingCritical = fileChecks.filter(f => f.critical && !f.exists);

    if (missingCritical.length > 0) {
      for (const file of missingCritical) {
        validation.addError({
          category: errorHandler.ErrorCategory.BUILD,
          severity: errorHandler.ErrorSeverity.HIGH,
          title: 'Missing Required File',
          message: `The file ${file.file} is required but missing.`,
          suggestion: 'This file needs to be created for the project to work.',
        });
      }
      validation.addCheck('Required Files', false, { missingFiles: missingCritical.map(f => f.file) });
    } else {
      validation.addCheck('Required Files', true);
    }

    // 3. Check dependencies (only for non-static projects)
    if (projectType !== 'static') {
      const depCheck = await checkDependencies(containerId);

      if (!depCheck.hasNodeModules) {
        validation.addError({
          category: errorHandler.ErrorCategory.DEPENDENCY,
          severity: errorHandler.ErrorSeverity.HIGH,
          title: 'Dependencies Not Installed',
          message: 'The node_modules folder is missing.',
          suggestion: 'Dependencies need to be installed.',
          autoFix: true,
          solution: 'npm install',
        });
        validation.addFix({
          command: 'npm install',
          description: 'Install project dependencies',
        });
        validation.addCheck('Dependencies Installed', false);
      } else if (depCheck.missingCritical.length > 0) {
        // Check for specific critical missing deps
        for (const dep of depCheck.missingCritical) {
          if (dep === 'caniuse-lite' || dep === 'browserslist') {
            validation.addError({
              category: errorHandler.ErrorCategory.DEPENDENCY,
              severity: errorHandler.ErrorSeverity.HIGH,
              title: 'Browser Data Package Missing',
              message: `The ${dep} package is missing or corrupted.`,
              suggestion: 'This package needs to be updated.',
              autoFix: true,
              solution: 'npm update caniuse-lite browserslist',
            });
            validation.addFix({
              command: 'npm update caniuse-lite browserslist',
              description: 'Update browser compatibility data',
            });
          } else if (dep === '@vitejs/plugin-react') {
            validation.addError({
              category: errorHandler.ErrorCategory.DEPENDENCY,
              severity: errorHandler.ErrorSeverity.HIGH,
              title: 'Vite React Plugin Missing',
              message: 'The @vitejs/plugin-react package is required for React support.',
              suggestion: 'Installing this plugin will enable React.',
              autoFix: true,
              solution: 'npm install @vitejs/plugin-react --save-dev',
            });
            validation.addFix({
              command: 'npm install @vitejs/plugin-react --save-dev',
              description: 'Install Vite React plugin',
            });
          }
        }
        validation.addCheck('Dependencies Installed', false, { missing: depCheck.missingCritical });
      } else {
        validation.addCheck('Dependencies Installed', true);
      }
    }

    // 4. Check syntax
    const syntaxErrors = await checkSyntax(containerId);
    if (syntaxErrors.length > 0) {
      for (const error of syntaxErrors) {
        validation.addError({
          category: errorHandler.ErrorCategory.SYNTAX,
          severity: errorHandler.ErrorSeverity.HIGH,
          title: 'Syntax Error',
          message: `${error.message} in ${error.file}`,
          suggestion: 'Fix the syntax error in your code.',
        });
      }
      validation.addCheck('Syntax Check', false, { errors: syntaxErrors });
    } else {
      validation.addCheck('Syntax Check', true);
    }

    // 5. Check server status
    const serverStatus = await checkServerStatus(containerId);
    validation.addCheck('Server Running', serverStatus.isRunning);
    validation.addCheck('Server Responding', serverStatus.isResponding);

    // 6. Check server logs for errors
    const logCheck = await checkServerLogs(containerId);
    if (logCheck.errors.length > 0) {
      for (const error of logCheck.errors) {
        validation.addError(error);
        if (error.autoFix && error.solution) {
          validation.addFix({
            command: error.solution,
            description: error.title,
          });
        }
      }
      validation.addCheck('Server Logs', false, { errorCount: logCheck.errors.length });
    } else {
      validation.addCheck('Server Logs', true);
    }

    for (const warning of logCheck.warnings) {
      validation.addWarning(warning);
    }

    logger.info(`Validation complete for container ${containerId}: valid=${validation.valid}, errors=${validation.errors.length}`);

  } catch (error) {
    logger.error('Validation error:', error);
    validation.addError({
      category: errorHandler.ErrorCategory.UNKNOWN,
      severity: errorHandler.ErrorSeverity.HIGH,
      title: 'Validation Failed',
      message: 'An error occurred during validation.',
      suggestion: 'Try refreshing the page or running the server again.',
    });
  }

  return validation;
}

/**
 * Attempt to auto-fix detected issues
 * @param {string} containerId - Docker container ID
 * @param {Array} fixes - Array of fix commands to run
 * @returns {Object} Fix results
 */
async function autoFix(containerId, fixes) {
  const results = [];

  for (const fix of fixes) {
    try {
      logger.info(`Running auto-fix: ${fix.command}`);
      const result = await dockerUtils.execCommand(
        containerId,
        `cd /workspace && ${fix.command}`,
        { timeout: 120000 } // 2 minute timeout for npm operations
      );

      results.push({
        command: fix.command,
        success: result.exitCode === 0,
        output: result.output,
        error: result.error,
      });
    } catch (error) {
      results.push({
        command: fix.command,
        success: false,
        error: error.message,
      });
    }
  }

  return {
    totalFixes: fixes.length,
    successCount: results.filter(r => r.success).length,
    results,
  };
}

/**
 * Format validation result for API response
 * @param {ValidationResult} validation - Validation result
 * @returns {Object} Formatted response
 */
function formatValidationResponse(validation) {
  return {
    valid: validation.valid,
    summary: validation.valid
      ? 'All checks passed! Your app is ready.'
      : `Found ${validation.errors.length} issue${validation.errors.length !== 1 ? 's' : ''} that need attention.`,
    errors: validation.errors.map(e => ({
      category: e.category,
      severity: e.severity,
      title: e.title,
      message: e.message,
      suggestion: e.suggestion,
      canAutoFix: e.autoFix && !!e.solution,
    })),
    warnings: validation.warnings.map(w => ({
      title: w.title,
      message: w.message,
      suggestion: w.suggestion,
    })),
    checks: validation.checks,
    availableFixes: validation.fixes,
    canAutoFixAll: validation.fixes.length > 0,
  };
}

module.exports = {
  validateWorkspace,
  autoFix,
  formatValidationResponse,
  detectProjectType,
  checkServerStatus,
  checkServerLogs,
  ValidationResult,
};
