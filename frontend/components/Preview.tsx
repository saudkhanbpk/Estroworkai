import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Globe, Layout, Image, Type, Box, AlertCircle, Wrench } from 'lucide-react';
import { ErrorBanner } from './ErrorDisplay';
import { validateWorkspace, autoFixWorkspace } from '../services/api';

interface ValidationError {
  category: string;
  severity: string;
  title: string;
  message: string;
  suggestion: string;
  canAutoFix: boolean;
  fixCommand?: string;
}

interface ValidationResult {
  valid: boolean;
  summary: string;
  errors: ValidationError[];
  warnings: { title: string; message: string; suggestion: string }[];
  checks: { name: string; passed: boolean; details?: Record<string, unknown> }[];
  availableFixes: { command: string; description: string }[];
  canAutoFixAll: boolean;
}

interface PreviewProps {
  url: string;
  workspaceId?: string;
  onValidationChange?: (validation: ValidationResult | null) => void;
}

// Skeleton component for preview loading
function PreviewSkeleton() {
  return (
    <div className="absolute inset-0 bg-[#1a1a2e] overflow-hidden">
      {/* Animated gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#0f3460] animate-pulse" />

      {/* Skeleton content */}
      <div className="relative h-full flex flex-col p-6">
        {/* Top nav skeleton */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-white/10 animate-pulse" />
            <div className="w-24 h-4 rounded bg-white/10 animate-pulse" />
          </div>
          <div className="flex gap-2">
            <div className="w-16 h-8 rounded-md bg-white/10 animate-pulse" />
            <div className="w-16 h-8 rounded-md bg-white/10 animate-pulse" />
            <div className="w-20 h-8 rounded-md bg-white/10 animate-pulse" />
          </div>
        </div>

        {/* Hero section skeleton */}
        <div className="flex-1 flex flex-col items-center justify-center gap-6 max-w-2xl mx-auto">
          {/* Icon with glow */}
          <div className="relative">
            <div className="absolute inset-0 bg-blue-500/20 blur-xl rounded-full animate-pulse" />
            <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/30 to-purple-500/30 flex items-center justify-center">
              <Globe className="w-8 h-8 text-blue-400/50 animate-pulse" />
            </div>
          </div>

          {/* Title skeleton */}
          <div className="w-64 h-8 rounded-lg bg-white/10 animate-pulse" />

          {/* Subtitle skeleton */}
          <div className="flex flex-col gap-2 items-center">
            <div className="w-80 h-4 rounded bg-white/5 animate-pulse" />
            <div className="w-64 h-4 rounded bg-white/5 animate-pulse" />
          </div>

          {/* CTA buttons skeleton */}
          <div className="flex gap-3 mt-4">
            <div className="w-32 h-10 rounded-lg bg-blue-500/20 animate-pulse" />
            <div className="w-32 h-10 rounded-lg bg-white/10 animate-pulse" />
          </div>
        </div>

        {/* Feature cards skeleton */}
        <div className="grid grid-cols-3 gap-4 mt-8">
          {[Layout, Image, Type].map((Icon, i) => (
            <div
              key={i}
              className="p-4 rounded-xl bg-white/5 border border-white/10"
              style={{ animationDelay: `${i * 150}ms` }}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center animate-pulse">
                  <Icon className="w-5 h-5 text-white/20" />
                </div>
                <div className="w-20 h-4 rounded bg-white/10 animate-pulse" />
              </div>
              <div className="space-y-2">
                <div className="w-full h-3 rounded bg-white/5 animate-pulse" />
                <div className="w-4/5 h-3 rounded bg-white/5 animate-pulse" />
              </div>
            </div>
          ))}
        </div>

        {/* Loading indicator */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2 rounded-full bg-white/5 border border-white/10">
          <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />
          <span className="text-sm text-white/50">Loading preview...</span>
        </div>
      </div>

      {/* Shimmer effect overlay */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full animate-shimmer" />
    </div>
  );
}

// Empty state component
function EmptyPreview() {
  return (
    <div className="absolute inset-0 bg-gradient-to-br from-[#0d1117] via-[#161b22] to-[#0d1117] flex items-center justify-center">
      <div className="text-center max-w-md px-6">
        {/* Animated icon */}
        <div className="relative mb-6 inline-block">
          <div className="absolute inset-0 bg-blue-500/10 blur-2xl rounded-full" />
          <div className="relative w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-[#21262d] to-[#30363d] border border-[#30363d] flex items-center justify-center">
            <Box className="w-10 h-10 text-gray-500" />
          </div>
        </div>

        <h3 className="text-xl font-semibold text-white mb-2">No Preview Available</h3>
        <p className="text-gray-400 mb-6">
          Click the <span className="text-green-400 font-medium">Run</span> button to start the development server and see your app in action.
        </p>

        {/* Steps indicator */}
        <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="w-5 h-5 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center text-xs">1</span>
            Run Server
          </span>
          <span className="text-gray-600">→</span>
          <span className="flex items-center gap-1.5">
            <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs">2</span>
            View Preview
          </span>
        </div>
      </div>
    </div>
  );
}

export default function Preview({ url, workspaceId, onValidationChange }: PreviewProps) {
  const [key, setKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  const [showErrorDetails, setShowErrorDetails] = useState(false);

  // Transform localhost URLs to use the actual host
  // This handles cases where backend returns localhost but we're accessing from browser
  const getPreviewUrl = (originalUrl: string): string => {
    if (!originalUrl) return '';
    
    // If URL contains localhost, replace with current window host
    if (originalUrl.includes('localhost')) {
      // Extract the port from the original URL
      const portMatch = originalUrl.match(/:(\d+)\/?$/);
      if (portMatch) {
        const port = portMatch[1];
        // Use the current browser's hostname (the EC2 public IP)
        const currentHost = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
        return `http://${currentHost}:${port}`;
      }
    }
    
    return originalUrl;
  };

  const previewUrl = getPreviewUrl(url);

  // Validate workspace when URL changes or on manual refresh
  const runValidation = useCallback(async () => {
    if (!workspaceId) return;

    setIsValidating(true);
    try {
      const result = await validateWorkspace(workspaceId);
      setValidation(result);
      onValidationChange?.(result);

      // If validation failed, show error state
      if (!result.valid) {
        setError(true);
        setLoading(false);
      }
    } catch (err) {
      console.error('Validation error:', err);
    } finally {
      setIsValidating(false);
    }
  }, [workspaceId, onValidationChange]);

  // Run validation when URL changes
  useEffect(() => {
    if (url && workspaceId) {
      // Small delay to let server start
      const timer = setTimeout(() => {
        runValidation();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [url, workspaceId, runValidation]);

  const handleRefresh = () => {
    setLoading(true);
    setError(false);
    setValidation(null);
    setKey((k) => k + 1);

    // Re-validate after refresh
    if (workspaceId) {
      setTimeout(() => runValidation(), 1000);
    }
  };

  const handleIframeError = () => {
    setLoading(false);
    setError(true);
    // Try to get validation errors when iframe fails
    if (workspaceId && !validation) {
      runValidation();
    }
  };

  const handleAutoFix = async () => {
    if (!workspaceId || !validation?.availableFixes.length) return;

    setIsFixing(true);
    try {
      const result = await autoFixWorkspace(workspaceId, validation.availableFixes);

      // Update validation state with new result
      if (result.validation) {
        setValidation(result.validation);
        onValidationChange?.(result.validation);

        // If fixed, refresh the preview
        if (result.validation.valid) {
          setError(false);
          handleRefresh();
        }
      }
    } catch (err) {
      console.error('Auto-fix error:', err);
    } finally {
      setIsFixing(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#0d1117]">
      {/* Preview iframe */}
      <div className="flex-1 relative bg-white">
        {!previewUrl ? (
          <EmptyPreview />
        ) : error ? (
          <div className="absolute inset-0 bg-[#0d1117] flex items-center justify-center overflow-auto">
            <div className="text-center px-6 py-8 max-w-lg">
              {validation && !validation.valid ? (
                // Show user-friendly error details
                <div className="text-left">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0">
                      <AlertCircle className="w-6 h-6 text-red-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-medium text-white">Preview Unavailable</h3>
                      <p className="text-gray-400 text-sm">{validation.summary}</p>
                    </div>
                  </div>

                  {/* Error list */}
                  <div className="space-y-3 mb-6">
                    {validation.errors.slice(0, 3).map((err, idx) => (
                      <div
                        key={idx}
                        className="p-4 rounded-lg bg-red-500/10 border border-red-500/20"
                      >
                        <h4 className="font-medium text-red-400 mb-1">{err.title}</h4>
                        <p className="text-gray-300 text-sm">{err.message}</p>
                        {err.suggestion && (
                          <p className="text-gray-500 text-sm mt-2">{err.suggestion}</p>
                        )}
                        {err.canAutoFix && (
                          <span className="inline-block mt-2 px-2 py-0.5 text-xs rounded-full bg-green-500/20 text-green-400 border border-green-500/30">
                            Can be auto-fixed
                          </span>
                        )}
                      </div>
                    ))}
                    {validation.errors.length > 3 && (
                      <p className="text-gray-500 text-sm text-center">
                        +{validation.errors.length - 3} more issue{validation.errors.length - 3 !== 1 ? 's' : ''}
                      </p>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center justify-center gap-3">
                    {validation.canAutoFixAll && (
                      <button
                        onClick={handleAutoFix}
                        disabled={isFixing}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg text-sm text-white font-medium flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isFixing ? (
                          <>
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            Fixing...
                          </>
                        ) : (
                          <>
                            <Wrench className="w-4 h-4" />
                            Fix Issues
                          </>
                        )}
                      </button>
                    )}
                    <button
                      onClick={handleRefresh}
                      disabled={isFixing}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm text-white flex items-center gap-2 transition-colors disabled:opacity-50"
                    >
                      <RefreshCw className={`w-4 h-4 ${isValidating ? 'animate-spin' : ''}`} />
                      {isValidating ? 'Checking...' : 'Retry'}
                    </button>
                  </div>
                </div>
              ) : (
                // Generic connection error
                <>
                  <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                    <Globe className="w-8 h-8 text-red-400" />
                  </div>
                  <h3 className="text-lg font-medium text-white mb-2">Connection Failed</h3>
                  <p className="text-gray-400 mb-4 text-sm">Unable to connect to the preview server.</p>
                  <button
                    onClick={handleRefresh}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm text-white flex items-center gap-2 mx-auto transition-colors"
                  >
                    <RefreshCw className={`w-4 h-4 ${isValidating ? 'animate-spin' : ''}`} />
                    {isValidating ? 'Checking...' : 'Try Again'}
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <>
            {loading && <PreviewSkeleton />}
            {/* Show error banner if there are warnings but preview still works */}
            {!loading && validation && validation.warnings.length > 0 && (
              <div className="absolute top-0 left-0 right-0 z-10">
                <ErrorBanner
                  validation={validation as any}
                  onViewDetails={() => setShowErrorDetails(true)}
                  onAutoFix={validation.canAutoFixAll ? handleAutoFix : undefined}
                  isFixing={isFixing}
                />
              </div>
            )}
            <iframe
              key={key}
              src={previewUrl}
              className={`w-full h-full border-0 bg-white transition-opacity duration-300 ${loading ? 'opacity-0' : 'opacity-100'}`}
              onLoad={() => {
                setLoading(false);
                // Re-validate on successful load
                if (workspaceId && !validation) {
                  runValidation();
                }
              }}
              onError={handleIframeError}
              sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals"
            />
          </>
        )}
      </div>
    </div>
  );
}
