/**
 * Error Handler Utility
 * Transforms technical errors into user-friendly messages
 */

const logger = require('./logger');

// Error categories for better classification
const ErrorCategory = {
  DEPENDENCY: 'dependency',
  SYNTAX: 'syntax',
  RUNTIME: 'runtime',
  BUILD: 'build',
  SERVER: 'server',
  NETWORK: 'network',
  PERMISSION: 'permission',
  UNKNOWN: 'unknown',
};

// Error severity levels
const ErrorSeverity = {
  LOW: 'low',       // Warnings, minor issues
  MEDIUM: 'medium', // Fixable issues
  HIGH: 'high',     // Critical errors that block preview
  CRITICAL: 'critical', // System-level failures
};

/**
 * Error pattern matchers with user-friendly messages and solutions
 */
const errorPatterns = [
  // Dependency errors
  {
    pattern: /Cannot find module ['"]([^'"]+)['"]/i,
    category: ErrorCategory.DEPENDENCY,
    severity: ErrorSeverity.HIGH,
    getMessage: (match) => ({
      title: 'Missing Package',
      message: `The package "${match[1]}" is not installed.`,
      suggestion: 'This package needs to be installed for your app to work.',
      solution: `npm install ${match[1]}`,
      autoFix: true,
    }),
  },
  {
    pattern: /Module not found: Error: Can't resolve ['"]([^'"]+)['"]/i,
    category: ErrorCategory.DEPENDENCY,
    severity: ErrorSeverity.HIGH,
    getMessage: (match) => ({
      title: 'Module Not Found',
      message: `Unable to find the module "${match[1]}".`,
      suggestion: 'Check if the package is installed or if the import path is correct.',
      solution: `npm install ${match[1]}`,
      autoFix: true,
    }),
  },
  {
    pattern: /caniuse-lite.*outdated/i,
    category: ErrorCategory.DEPENDENCY,
    severity: ErrorSeverity.MEDIUM,
    getMessage: () => ({
      title: 'Outdated Browser Data',
      message: 'The browser compatibility database needs to be updated.',
      suggestion: 'Updating will ensure accurate browser support information.',
      solution: 'npm update caniuse-lite browserslist',
      autoFix: true,
    }),
  },
  {
    pattern: /Cannot find module 'caniuse-lite\/dist\/unpacker\/agents'/i,
    category: ErrorCategory.DEPENDENCY,
    severity: ErrorSeverity.HIGH,
    getMessage: () => ({
      title: 'Corrupted Browser Data Package',
      message: 'The caniuse-lite package is corrupted or incomplete.',
      suggestion: 'This is a common issue that can be fixed by reinstalling the package.',
      solution: 'npm update caniuse-lite browserslist',
      autoFix: true,
    }),
  },
  {
    pattern: /ENOENT.*package\.json/i,
    category: ErrorCategory.DEPENDENCY,
    severity: ErrorSeverity.HIGH,
    getMessage: () => ({
      title: 'Missing Configuration',
      message: 'The package.json file is missing.',
      suggestion: 'Your project needs a package.json file to manage dependencies.',
      solution: 'Create a package.json file with the required dependencies.',
      autoFix: false,
    }),
  },
  {
    pattern: /npm ERR! peer dep missing/i,
    category: ErrorCategory.DEPENDENCY,
    severity: ErrorSeverity.MEDIUM,
    getMessage: () => ({
      title: 'Peer Dependency Missing',
      message: 'Some packages require additional dependencies to be installed.',
      suggestion: 'Running npm install again might resolve this.',
      solution: 'npm install',
      autoFix: true,
    }),
  },

  // Syntax errors
  {
    pattern: /SyntaxError: Unexpected token ['"]?([^'"]+)['"]?/i,
    category: ErrorCategory.SYNTAX,
    severity: ErrorSeverity.HIGH,
    getMessage: (match) => ({
      title: 'Syntax Error',
      message: `There's an unexpected "${match[1]}" in your code.`,
      suggestion: 'Check for missing brackets, parentheses, or semicolons.',
      solution: null,
      autoFix: false,
    }),
  },
  {
    pattern: /SyntaxError: (.+) at line (\d+)/i,
    category: ErrorCategory.SYNTAX,
    severity: ErrorSeverity.HIGH,
    getMessage: (match) => ({
      title: 'Syntax Error',
      message: `${match[1]} on line ${match[2]}.`,
      suggestion: 'Review the code around this line for typos or missing syntax.',
      solution: null,
      autoFix: false,
    }),
  },
  {
    pattern: /Unexpected token '<'/i,
    category: ErrorCategory.SYNTAX,
    severity: ErrorSeverity.HIGH,
    getMessage: () => ({
      title: 'JSX Syntax Error',
      message: 'JSX code was found but not properly configured.',
      suggestion: 'Make sure the file extension is .jsx and React is properly configured.',
      solution: null,
      autoFix: false,
    }),
  },
  {
    pattern: /Unterminated string constant/i,
    category: ErrorCategory.SYNTAX,
    severity: ErrorSeverity.HIGH,
    getMessage: () => ({
      title: 'Unterminated String',
      message: 'A string in your code is missing its closing quote.',
      suggestion: 'Check for missing quotes in your strings.',
      solution: null,
      autoFix: false,
    }),
  },

  // Runtime errors
  {
    pattern: /TypeError: (.+) is not a function/i,
    category: ErrorCategory.RUNTIME,
    severity: ErrorSeverity.HIGH,
    getMessage: (match) => ({
      title: 'Type Error',
      message: `"${match[1]}" cannot be called as a function.`,
      suggestion: 'Check if you\'re calling the right method or if the variable is defined correctly.',
      solution: null,
      autoFix: false,
    }),
  },
  {
    pattern: /TypeError: Cannot read propert(?:y|ies) ['"]?([^'"]+)['"]? of (undefined|null)/i,
    category: ErrorCategory.RUNTIME,
    severity: ErrorSeverity.HIGH,
    getMessage: (match) => ({
      title: 'Undefined Variable',
      message: `Trying to access "${match[1]}" on something that doesn't exist.`,
      suggestion: 'Make sure the object exists before accessing its properties.',
      solution: null,
      autoFix: false,
    }),
  },
  {
    pattern: /ReferenceError: (.+) is not defined/i,
    category: ErrorCategory.RUNTIME,
    severity: ErrorSeverity.HIGH,
    getMessage: (match) => ({
      title: 'Undefined Reference',
      message: `"${match[1]}" is used but hasn't been defined.`,
      suggestion: 'Check for typos in variable names or missing imports.',
      solution: null,
      autoFix: false,
    }),
  },

  // Build errors
  {
    pattern: /error during build/i,
    category: ErrorCategory.BUILD,
    severity: ErrorSeverity.HIGH,
    getMessage: () => ({
      title: 'Build Failed',
      message: 'The project failed to build.',
      suggestion: 'Check the console for more details about what went wrong.',
      solution: null,
      autoFix: false,
    }),
  },
  {
    pattern: /vite.*plugin.*react.*not found/i,
    category: ErrorCategory.BUILD,
    severity: ErrorSeverity.HIGH,
    getMessage: () => ({
      title: 'Missing Vite React Plugin',
      message: 'The Vite React plugin is required but not installed.',
      suggestion: 'Installing the plugin will enable React support.',
      solution: 'npm install @vitejs/plugin-react --save-dev',
      autoFix: true,
    }),
  },
  {
    pattern: /Failed to resolve import ['"]([^'"]+)['"]/i,
    category: ErrorCategory.BUILD,
    severity: ErrorSeverity.HIGH,
    getMessage: (match) => ({
      title: 'Import Resolution Failed',
      message: `Cannot find the import "${match[1]}".`,
      suggestion: 'Verify the file exists and the path is correct.',
      solution: null,
      autoFix: false,
    }),
  },

  // Server errors
  {
    pattern: /EADDRINUSE.*:(\d+)/i,
    category: ErrorCategory.SERVER,
    severity: ErrorSeverity.MEDIUM,
    getMessage: (match) => ({
      title: 'Port Already in Use',
      message: `Port ${match[1]} is already being used by another process.`,
      suggestion: 'The existing server will be stopped and restarted.',
      solution: 'pkill -f "node|vite|serve" && npm run dev',
      autoFix: true,
    }),
  },
  {
    pattern: /ECONNREFUSED/i,
    category: ErrorCategory.NETWORK,
    severity: ErrorSeverity.MEDIUM,
    getMessage: () => ({
      title: 'Connection Refused',
      message: 'The server isn\'t responding.',
      suggestion: 'The server may still be starting up. Try refreshing in a moment.',
      solution: null,
      autoFix: false,
    }),
  },

  // Permission errors
  {
    pattern: /EACCES.*permission denied/i,
    category: ErrorCategory.PERMISSION,
    severity: ErrorSeverity.HIGH,
    getMessage: () => ({
      title: 'Permission Denied',
      message: 'The system doesn\'t have permission to access a file or folder.',
      suggestion: 'This might be a system configuration issue.',
      solution: null,
      autoFix: false,
    }),
  },

  // ESLint/Linting errors
  {
    pattern: /eslint.*error/i,
    category: ErrorCategory.SYNTAX,
    severity: ErrorSeverity.LOW,
    getMessage: () => ({
      title: 'Code Style Issue',
      message: 'Some code doesn\'t follow the recommended style guidelines.',
      suggestion: 'These are recommendations to improve code quality.',
      solution: 'npx eslint --fix .',
      autoFix: true,
    }),
  },

  // TypeScript errors
  {
    pattern: /TS(\d+): (.+)/i,
    category: ErrorCategory.SYNTAX,
    severity: ErrorSeverity.HIGH,
    getMessage: (match) => ({
      title: 'TypeScript Error',
      message: match[2],
      suggestion: 'Fix the type error to continue.',
      solution: null,
      autoFix: false,
    }),
  },
];

/**
 * Parse raw error and return user-friendly error object
 * @param {string} rawError - The raw error message
 * @returns {Object} User-friendly error object
 */
function parseError(rawError) {
  if (!rawError || typeof rawError !== 'string') {
    return {
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.MEDIUM,
      title: 'Something Went Wrong',
      message: 'An unexpected error occurred.',
      suggestion: 'Try refreshing or running the server again.',
      solution: null,
      autoFix: false,
      raw: rawError,
    };
  }

  // Try to match against known patterns
  for (const errorDef of errorPatterns) {
    const match = rawError.match(errorDef.pattern);
    if (match) {
      const friendlyError = errorDef.getMessage(match);
      return {
        category: errorDef.category,
        severity: errorDef.severity,
        ...friendlyError,
        raw: rawError,
      };
    }
  }

  // Generic fallback for unrecognized errors
  // Try to extract the most useful part of the error
  const lines = rawError.split('\n').filter(l => l.trim());
  const mainError = lines[0] || rawError;

  return {
    category: ErrorCategory.UNKNOWN,
    severity: ErrorSeverity.MEDIUM,
    title: 'Error Occurred',
    message: mainError.length > 150 ? mainError.substring(0, 150) + '...' : mainError,
    suggestion: 'Check the error details for more information.',
    solution: null,
    autoFix: false,
    raw: rawError,
  };
}

/**
 * Parse multiple errors from a log output
 * @param {string} logOutput - Full log output that may contain multiple errors
 * @returns {Array} Array of user-friendly error objects
 */
function parseErrors(logOutput) {
  if (!logOutput) return [];

  const errors = [];
  const errorIndicators = [
    /error/i,
    /failed/i,
    /cannot/i,
    /exception/i,
    /ENOENT/i,
    /EACCES/i,
    /TypeError/i,
    /SyntaxError/i,
    /ReferenceError/i,
  ];

  // Split by common error boundaries
  const lines = logOutput.split('\n');
  let currentError = '';

  for (const line of lines) {
    // Check if this line starts a new error
    const isErrorLine = errorIndicators.some(indicator => indicator.test(line));

    if (isErrorLine) {
      if (currentError) {
        errors.push(parseError(currentError.trim()));
      }
      currentError = line;
    } else if (currentError) {
      // Continue building current error context
      currentError += '\n' + line;
    }
  }

  // Don't forget the last error
  if (currentError) {
    errors.push(parseError(currentError.trim()));
  }

  // Deduplicate errors by title
  const uniqueErrors = [];
  const seenTitles = new Set();

  for (const error of errors) {
    if (!seenTitles.has(error.title)) {
      seenTitles.add(error.title);
      uniqueErrors.push(error);
    }
  }

  return uniqueErrors;
}

/**
 * Get suggested auto-fix commands for errors
 * @param {Array} errors - Array of error objects
 * @returns {Array} Array of unique fix commands
 */
function getAutoFixCommands(errors) {
  const fixes = [];
  const seenCommands = new Set();

  for (const error of errors) {
    if (error.autoFix && error.solution && !seenCommands.has(error.solution)) {
      seenCommands.add(error.solution);
      fixes.push({
        command: error.solution,
        description: error.title,
        category: error.category,
      });
    }
  }

  return fixes;
}

/**
 * Format error for API response
 * @param {Object} error - Error object
 * @returns {Object} Formatted error for frontend
 */
function formatErrorForResponse(error) {
  return {
    category: error.category,
    severity: error.severity,
    title: error.title,
    message: error.message,
    suggestion: error.suggestion,
    canAutoFix: error.autoFix && !!error.solution,
    fixCommand: error.autoFix ? error.solution : null,
  };
}

/**
 * Format multiple errors for API response
 * @param {Array} errors - Array of error objects
 * @returns {Object} Formatted response with errors and fixes
 */
function formatErrorsForResponse(errors) {
  const formattedErrors = errors.map(formatErrorForResponse);
  const fixes = getAutoFixCommands(errors);

  // Determine overall severity
  let overallSeverity = ErrorSeverity.LOW;
  for (const error of errors) {
    if (error.severity === ErrorSeverity.CRITICAL) {
      overallSeverity = ErrorSeverity.CRITICAL;
      break;
    } else if (error.severity === ErrorSeverity.HIGH && overallSeverity !== ErrorSeverity.CRITICAL) {
      overallSeverity = ErrorSeverity.HIGH;
    } else if (error.severity === ErrorSeverity.MEDIUM && overallSeverity === ErrorSeverity.LOW) {
      overallSeverity = ErrorSeverity.MEDIUM;
    }
  }

  return {
    hasErrors: errors.length > 0,
    errorCount: errors.length,
    severity: overallSeverity,
    errors: formattedErrors,
    availableFixes: fixes,
    canAutoFixAll: fixes.length > 0 && fixes.length === errors.filter(e => e.autoFix).length,
  };
}

/**
 * Create a user-friendly error summary
 * @param {Array} errors - Array of error objects
 * @returns {string} Human-readable summary
 */
function createErrorSummary(errors) {
  if (!errors || errors.length === 0) {
    return 'No errors detected.';
  }

  if (errors.length === 1) {
    const error = errors[0];
    return `${error.title}: ${error.message}`;
  }

  const categories = {};
  for (const error of errors) {
    categories[error.category] = (categories[error.category] || 0) + 1;
  }

  const parts = [];
  for (const [category, count] of Object.entries(categories)) {
    parts.push(`${count} ${category} issue${count > 1 ? 's' : ''}`);
  }

  return `Found ${errors.length} issues: ${parts.join(', ')}.`;
}

module.exports = {
  ErrorCategory,
  ErrorSeverity,
  parseError,
  parseErrors,
  getAutoFixCommands,
  formatErrorForResponse,
  formatErrorsForResponse,
  createErrorSummary,
};
