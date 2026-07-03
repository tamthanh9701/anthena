import React from 'react';
import { Tag } from 'antd';
import type { RunStatus } from '../types';

const statusConfig: Record<RunStatus, { color: string; label: string }> = {
  pending: { color: 'default', label: 'Pending' },
  running: { color: 'processing', label: 'Running' },
  completed: { color: 'success', label: 'Completed' },
  'partially-completed': { color: 'warning', label: 'Partial' },
  failed: { color: 'error', label: 'Failed' },
  interrupted: { color: 'default', label: 'Interrupted' },
};

interface StatusTagProps {
  status: RunStatus;
}

const StatusTag: React.FC<StatusTagProps> = ({ status }) => {
  const config = statusConfig[status] ?? { color: 'default', label: status };
  return <Tag color={config.color}>{config.label}</Tag>;
};

export default StatusTag;