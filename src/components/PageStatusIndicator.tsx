/**
 * PageStatusIndicator Component
 * Shows the generation status for a single page with retry capability
 */

import React from 'react';
import type { PageStatus } from '../types';
import './PageStatusIndicator.css';

export interface PageStatusIndicatorProps {
  status: PageStatus;
  pageNum: number;
  error?: string;
  retryCount?: number;
  onRetry?: (pageNum: number) => void;
  onCancel?: (pageNum: number) => void;
}

/**
 * Get status display configuration
 */
function getStatusConfig(status: PageStatus): {
  label: string;
  icon: string;
  className: string;
} {
  switch (status) {
    case 'idle':
      return {
        label: 'Pending',
        icon: '⏳',
        className: 'status-idle',
      };
    case 'queued':
      return {
        label: 'Queued',
        icon: '📋',
        className: 'status-queued',
      };
    case 'generating':
      return {
        label: 'Generating',
        icon: '✨',
        className: 'status-generating',
      };
    case 'complete':
      return {
        label: 'Complete',
        icon: '✅',
        className: 'status-complete',
      };
    case 'error':
      return {
        label: 'Failed',
        icon: '❌',
        className: 'status-error',
      };
    default:
      return {
        label: 'Unknown',
        icon: '❓',
        className: 'status-unknown',
      };
  }
}

/**
 * PageStatusIndicator component
 */
export const PageStatusIndicator: React.FC<PageStatusIndicatorProps> = ({
  status,
  pageNum,
  error,
  retryCount,
  onRetry,
  onCancel,
}) => {
  const config = getStatusConfig(status);

  const handleRetry = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRetry?.(pageNum);
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    onCancel?.(pageNum);
  };

  return (
    <div
      className={`page-status-indicator ${config.className}`}
      role="status"
      aria-label={`Page ${pageNum + 1} status: ${config.label}`}
    >
      <span className="status-icon" aria-hidden="true">
        {config.icon}
      </span>
      <span className="status-label">{config.label}</span>

      {retryCount !== undefined && retryCount > 0 && (
        <span className="retry-count" title={`Retried ${retryCount} times`}>
          ({retryCount})
        </span>
      )}

      {status === 'error' && error && (
        <div className="error-details">
          <p className="error-message">{error}</p>
          {onRetry && (
            <button
              className="retry-button"
              onClick={handleRetry}
              aria-label={`Retry page ${pageNum + 1}`}
            >
              🔄 Retry
            </button>
          )}
        </div>
      )}

      {status === 'generating' && onCancel && (
        <button
          className="cancel-button"
          onClick={handleCancel}
          aria-label={`Cancel page ${pageNum + 1} generation`}
        >
          ⏹ Stop
        </button>
      )}
    </div>
  );
};

/**
 * PageStatusGrid Component
 * Shows status indicators for all pages in a grid
 */
export interface PageStatusGridProps {
  pageStatuses: PageStatus[];
  errors?: string[];
  retryCounts?: number[];
  onRetry?: (pageNum: number) => void;
  onCancel?: (pageNum: number) => void;
  totalPages: number;
}

export const PageStatusGrid: React.FC<PageStatusGridProps> = ({
  pageStatuses,
  errors,
  retryCounts,
  onRetry,
  onCancel,
  totalPages,
}) => {
  return (
    <div className="page-status-grid" role="group" aria-label="Page generation status">
      {Array.from({ length: totalPages }).map((_, idx) => (
        <PageStatusIndicator
          key={idx}
          status={pageStatuses[idx] || 'idle'}
          pageNum={idx}
          error={errors?.[idx]}
          retryCount={retryCounts?.[idx]}
          onRetry={onRetry}
          onCancel={onCancel}
        />
      ))}
    </div>
  );
};

export default PageStatusIndicator;
