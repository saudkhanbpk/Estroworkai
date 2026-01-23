import { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Wrench,
  XCircle,
  Package,
  Code,
  Server,
  Wifi,
  Shield,
  HelpCircle,
} from 'lucide-react';

// Error severity types
type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

// Error category types
type ErrorCategory =
  | 'dependency'
  | 'syntax'
  | 'runtime'
  | 'build'
  | 'server'
  | 'network'
  | 'permission'
  | 'unknown';

// Error structure from backend
interface ValidationError {
  category: ErrorCategory;
  severity: ErrorSeverity;
  title: string;
  message: string;
  suggestion: string;
  canAutoFix: boolean;
  fixCommand?: string;
}

interface ValidationWarning {
  title: string;
  message: string;
  suggestion: string;
}

interface ValidationCheck {
  name: string;
  passed: boolean;
  details?: Record<string, unknown>;
}

interface AvailableFix {
  command: string;
  description: string;
}

interface ValidationResult {
  valid: boolean;
  summary: string;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  checks: ValidationCheck[];
  availableFixes: AvailableFix[];
  canAutoFixAll: boolean;
}

interface ErrorDisplayProps {
  validation: ValidationResult | null;
  onAutoFix?: (fixes: AvailableFix[]) => void;
  onRefresh?: () => void;
  isFixing?: boolean;
  compact?: boolean;
}

// Get icon for error category
function getCategoryIcon(category: ErrorCategory) {
  switch (category) {
    case 'dependency':
      return Package;
    case 'syntax':
      return Code;
    case 'runtime':
      return AlertCircle;
    case 'build':
      return Wrench;
    case 'server':
      return Server;
    case 'network':
      return Wifi;
    case 'permission':
      return Shield;
    default:
      return HelpCircle;
  }
}

// Get color classes for severity
function getSeverityColors(severity: ErrorSeverity) {
  switch (severity) {
    case 'critical':
      return {
        bg: 'bg-red-500/10',
        border: 'border-red-500/30',
        text: 'text-red-400',
        icon: 'text-red-500',
      };
    case 'high':
      return {
        bg: 'bg-orange-500/10',
        border: 'border-orange-500/30',
        text: 'text-orange-400',
        icon: 'text-orange-500',
      };
    case 'medium':
      return {
        bg: 'bg-yellow-500/10',
        border: 'border-yellow-500/30',
        text: 'text-yellow-400',
        icon: 'text-yellow-500',
      };
    case 'low':
      return {
        bg: 'bg-blue-500/10',
        border: 'border-blue-500/30',
        text: 'text-blue-400',
        icon: 'text-blue-500',
      };
  }
}

// Single error card component
function ErrorCard({ error, compact }: { error: ValidationError; compact?: boolean }) {
  const [expanded, setExpanded] = useState(!compact);
  const colors = getSeverityColors(error.severity);
  const CategoryIcon = getCategoryIcon(error.category);

  return (
    <div
      className={`rounded-lg border ${colors.bg} ${colors.border} overflow-hidden transition-all duration-200`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-white/5 transition-colors"
      >
        <div className={`p-2 rounded-lg ${colors.bg}`}>
          <CategoryIcon className={`w-4 h-4 ${colors.icon}`} />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className={`font-medium ${colors.text} truncate`}>{error.title}</h4>
          {!expanded && (
            <p className="text-sm text-gray-400 truncate">{error.message}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {error.canAutoFix && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-green-500/20 text-green-400 border border-green-500/30">
              Auto-fixable
            </span>
          )}
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          <div className="pl-11">
            <p className="text-gray-300 text-sm">{error.message}</p>
            {error.suggestion && (
              <p className="text-gray-500 text-sm mt-2">
                <span className="text-gray-400">Suggestion:</span> {error.suggestion}
              </p>
            )}
            {error.fixCommand && (
              <div className="mt-3 p-2 rounded bg-black/30 border border-white/10">
                <code className="text-xs text-green-400 font-mono">
                  {error.fixCommand}
                </code>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Warning card component
function WarningCard({ warning }: { warning: ValidationWarning }) {
  return (
    <div className="rounded-lg border bg-yellow-500/5 border-yellow-500/20 px-4 py-3 flex items-start gap-3">
      <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5 flex-shrink-0" />
      <div>
        <h4 className="font-medium text-yellow-400 text-sm">{warning.title}</h4>
        <p className="text-gray-400 text-sm mt-1">{warning.message}</p>
      </div>
    </div>
  );
}

// Validation checks summary
function ChecksSummary({ checks }: { checks: ValidationCheck[] }) {
  const passedCount = checks.filter((c) => c.passed).length;
  const totalCount = checks.length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-400">Validation Checks</span>
        <span
          className={
            passedCount === totalCount ? 'text-green-400' : 'text-yellow-400'
          }
        >
          {passedCount}/{totalCount} passed
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {checks.map((check, index) => (
          <div
            key={index}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs ${
              check.passed
                ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                : 'bg-red-500/10 text-red-400 border border-red-500/20'
            }`}
          >
            {check.passed ? (
              <CheckCircle className="w-3 h-3" />
            ) : (
              <XCircle className="w-3 h-3" />
            )}
            {check.name}
          </div>
        ))}
      </div>
    </div>
  );
}

// Main ErrorDisplay component
export default function ErrorDisplay({
  validation,
  onAutoFix,
  onRefresh,
  isFixing = false,
  compact = false,
}: ErrorDisplayProps) {
  if (!validation) return null;

  const hasErrors = validation.errors.length > 0;
  const hasWarnings = validation.warnings.length > 0;

  // If valid and no warnings, show success state
  if (validation.valid && !hasWarnings) {
    return (
      <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30 flex items-center gap-3">
        <div className="p-2 rounded-lg bg-green-500/20">
          <CheckCircle className="w-5 h-5 text-green-500" />
        </div>
        <div className="flex-1">
          <h3 className="font-medium text-green-400">All Checks Passed</h3>
          <p className="text-sm text-gray-400">Your app is ready for preview!</p>
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
            title="Refresh validation"
          >
            <RefreshCw className="w-4 h-4 text-gray-400" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <div
        className={`p-4 rounded-lg flex items-center gap-3 ${
          hasErrors
            ? 'bg-red-500/10 border border-red-500/30'
            : 'bg-yellow-500/10 border border-yellow-500/30'
        }`}
      >
        <div
          className={`p-2 rounded-lg ${
            hasErrors ? 'bg-red-500/20' : 'bg-yellow-500/20'
          }`}
        >
          {hasErrors ? (
            <XCircle
              className={`w-5 h-5 ${
                hasErrors ? 'text-red-500' : 'text-yellow-500'
              }`}
            />
          ) : (
            <AlertTriangle className="w-5 h-5 text-yellow-500" />
          )}
        </div>
        <div className="flex-1">
          <h3
            className={`font-medium ${
              hasErrors ? 'text-red-400' : 'text-yellow-400'
            }`}
          >
            {validation.summary}
          </h3>
          {hasErrors && validation.canAutoFixAll && (
            <p className="text-sm text-gray-400 mt-1">
              {validation.availableFixes.length} issue
              {validation.availableFixes.length !== 1 ? 's' : ''} can be
              automatically fixed.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {validation.canAutoFixAll && onAutoFix && (
            <button
              onClick={() => onAutoFix(validation.availableFixes)}
              disabled={isFixing}
              className="px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isFixing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Fixing...
                </>
              ) : (
                <>
                  <Wrench className="w-4 h-4" />
                  Fix All
                </>
              )}
            </button>
          )}
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isFixing}
              className="p-2 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50"
              title="Refresh validation"
            >
              <RefreshCw
                className={`w-4 h-4 text-gray-400 ${
                  isFixing ? 'animate-spin' : ''
                }`}
              />
            </button>
          )}
        </div>
      </div>

      {/* Errors list */}
      {hasErrors && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-gray-400 px-1">
            {validation.errors.length} Error
            {validation.errors.length !== 1 ? 's' : ''}
          </h4>
          <div className="space-y-2">
            {validation.errors.map((error, index) => (
              <ErrorCard key={index} error={error} compact={compact} />
            ))}
          </div>
        </div>
      )}

      {/* Warnings list */}
      {hasWarnings && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-gray-400 px-1">
            {validation.warnings.length} Warning
            {validation.warnings.length !== 1 ? 's' : ''}
          </h4>
          <div className="space-y-2">
            {validation.warnings.map((warning, index) => (
              <WarningCard key={index} warning={warning} />
            ))}
          </div>
        </div>
      )}

      {/* Validation checks */}
      {validation.checks.length > 0 && !compact && (
        <div className="pt-4 border-t border-white/10">
          <ChecksSummary checks={validation.checks} />
        </div>
      )}
    </div>
  );
}

// Compact inline error banner for preview
export function ErrorBanner({
  validation,
  onViewDetails,
  onAutoFix,
  isFixing,
}: {
  validation: ValidationResult | null;
  onViewDetails?: () => void;
  onAutoFix?: () => void;
  isFixing?: boolean;
}) {
  if (!validation || validation.valid) return null;

  const errorCount = validation.errors.length;
  const highSeverityCount = validation.errors.filter(
    (e) => e.severity === 'high' || e.severity === 'critical'
  ).length;

  return (
    <div className="bg-red-500/10 border-b border-red-500/30 px-4 py-2 flex items-center gap-3">
      <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
      <span className="text-sm text-red-300 flex-1">
        {highSeverityCount > 0
          ? `${highSeverityCount} critical issue${highSeverityCount !== 1 ? 's' : ''} detected`
          : `${errorCount} issue${errorCount !== 1 ? 's' : ''} found`}
      </span>
      <div className="flex items-center gap-2">
        {validation.canAutoFixAll && onAutoFix && (
          <button
            onClick={onAutoFix}
            disabled={isFixing}
            className="px-2 py-1 text-xs rounded bg-green-600 hover:bg-green-700 text-white font-medium transition-colors disabled:opacity-50 flex items-center gap-1"
          >
            {isFixing ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <Wrench className="w-3 h-3" />
            )}
            Fix
          </button>
        )}
        {onViewDetails && (
          <button
            onClick={onViewDetails}
            className="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            Details
          </button>
        )}
      </div>
    </div>
  );
}
