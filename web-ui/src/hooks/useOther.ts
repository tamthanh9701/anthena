import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/endpoints';
import type {
  ApproveQueue,
  SyncResponse,
  SignalReliabilityReport,
  DeltaReport,
  AppConfig,
  SyncStatus,
  SnapshotDetail,
} from '../types';

// ── Approve Queue ──
export function useApproveQueue(runId: string | null) {
  const queryClient = useQueryClient();

  const queueQuery = useQuery<ApproveQueue>({
    queryKey: ['approve-queue', runId],
    queryFn: () => api.getApproveQueue(runId!),
    enabled: !!runId,
    staleTime: 15_000,
  });

  const syncMutation = useMutation<SyncResponse, any, void>({
    mutationFn: () => api.syncToFigma(runId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approve-queue', runId] });
    },
  });

  const exportMutation = useMutation({
    mutationFn: (format: 'w3c-tokens' | 'style-dictionary') => api.exportTokens(runId!, { format }),
  });

  return {
    queue: queueQuery.data ?? null,
    loading: queueQuery.isLoading,
    error: queueQuery.error,
    syncToFigma: syncMutation,
    exportTokens: exportMutation,
    refetch: queueQuery.refetch,
  };
}

// ── Signal Report ──
export function useSignalReport(runId: string | null) {
  return useQuery<SignalReliabilityReport>({
    queryKey: ['signal-report', runId],
    queryFn: () => api.getSignalReliabilityReport(runId!),
    enabled: !!runId,
    staleTime: 60_000,
  });
}

// ── Delta ──
export function useDelta(runId: string | null, baselineRunId: string | null) {
  return useQuery<DeltaReport>({
    queryKey: ['delta', runId, baselineRunId],
    queryFn: () => api.getDelta(runId!, baselineRunId!),
    enabled: !!runId && !!baselineRunId,
    staleTime: 60_000,
  });
}

// ── Config ──
export function useConfig() {
  return useQuery<AppConfig>({
    queryKey: ['config'],
    queryFn: api.getConfig,
    staleTime: 60_000,
  });
}

// ── Snapshot ──
export function useSnapshot(snapshotId: string | null) {
  return useQuery<SnapshotDetail>({
    queryKey: ['snapshot', snapshotId],
    queryFn: () => api.getSnapshot(snapshotId!),
    enabled: !!snapshotId,
  });
}

// ── Sync Status ──
export function useSyncStatus() {
  return useQuery<SyncStatus>({
    queryKey: ['sync-status'],
    queryFn: api.getSyncStatus,
    staleTime: 30_000,
  });
}

// ── Health ──
export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: api.getHealth,
    staleTime: 15_000,
  });
}