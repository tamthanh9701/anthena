import React from 'react';
import { Select } from 'antd';
import { useRuns } from '../hooks';

interface RunSelectorProps {
  selectedRunId: string | null;
  onChange: (runId: string) => void;
  status?: string;
  style?: React.CSSProperties;
}

const RunSelector: React.FC<RunSelectorProps> = ({ selectedRunId, onChange, status, style }) => {
  const { runs, loading } = useRuns(status ? { status } : {});

  return (
    <Select
      style={{ minWidth: 200, ...style }}
      placeholder="Select a run..."
      loading={loading}
      value={selectedRunId}
      onChange={onChange}
      options={runs.map((r) => ({
        label: `${r.runId.slice(0, 8)}... — ${r.status} (${r.totalRoutes} routes)`,
        value: r.runId,
      }))}
      showSearch
      filterOption={(input, option) =>
        (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
      }
    />
  );
};

export default RunSelector;