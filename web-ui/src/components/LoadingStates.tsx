import React from 'react';
import { Skeleton, Empty, Button } from 'antd';

interface LoadingSkeletonProps {
  loading: boolean;
  children: React.ReactNode;
  rows?: number;
}

export const LoadingSkeleton: React.FC<LoadingSkeletonProps> = ({ loading, children, rows = 3 }) => {
  if (loading) {
    return (
      <div>
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} active paragraph={{ rows: 2 }} style={{ marginBottom: 16 }} />
        ))}
      </div>
    );
  }
  return <>{children}</>;
};

interface EmptyStateProps {
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  message = 'No data available',
  actionLabel,
  onAction,
}) => {
  return (
    <Empty
      description={message}
      style={{ margin: '48px 0' }}
    >
      {actionLabel && onAction && (
        <Button type="primary" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </Empty>
  );
};

export const ErrorState: React.FC<{ message: string; onRetry?: () => void }> = ({
  message,
  onRetry,
}) => {
  return (
    <Empty
      description={message}
      style={{ margin: '48px 0' }}
    >
      {onRetry && (
        <Button onClick={onRetry}>Retry</Button>
      )}
    </Empty>
  );
};