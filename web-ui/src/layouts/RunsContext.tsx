import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import type { RunSummary } from '../types';

interface RunsContextValue {
  selectedRunId: string | null;
  runs: RunSummary[];
  setRuns: (runs: RunSummary[]) => void;
  selectRun: (runId: string) => void;
  latestRun: RunSummary | null;
}

const RunsContext = createContext<RunsContextValue>({
  selectedRunId: null,
  runs: [],
  setRuns: () => {},
  selectRun: () => {},
  latestRun: null,
});

export const useRunsContext = () => useContext(RunsContext);

export const RunsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);

  const selectRun = useCallback((runId: string) => {
    setSelectedRunId(runId);
  }, []);

  const latestRun = useMemo(() => {
    if (runs.length === 0) return null;
    return runs[0]; // runs sorted desc by createdAt
  }, [runs]);

  const value = useMemo(
    () => ({ selectedRunId, runs, setRuns, selectRun, latestRun }),
    [selectedRunId, runs, selectRun, latestRun]
  );

  return <RunsContext.Provider value={value}>{children}</RunsContext.Provider>;
};