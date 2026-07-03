import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/endpoints';
import type {
  PaginatedRuns,
  CreateRunRequest,
  CreateRunResponse,
  RunStatusProgress,
  RunSummaryData,
  RunDetail,
} from '../types';

export function useRuns(params?: { page?: number; limit?: number; status?: string }) {
  const queryClient = useQueryClient();

  const runsQuery = useQuery<PaginatedRuns>({
    queryKey: ['runs', params],
    queryFn: () => api.listRuns(params),
    staleTime: 10_000,
  });

  const createRunMutation = useMutation<CreateRunResponse, any, CreateRunRequest>({
    mutationFn: (data) => api.createRun(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runs'] });
    },
  });

  const deleteRunMutation = useMutation({
    mutationFn: (runId: string) => api.deleteRun(runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runs'] });
    },
  });

  const resumeRunMutation = useMutation({
    mutationFn: (runId: string) => api.resumeRun(runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runs'] });
    },
  });

  return {
    runs: runsQuery.data?.runs ?? [],
    total: runsQuery.data?.total ?? 0,
    loading: runsQuery.isLoading,
    error: runsQuery.error,
    createRun: createRunMutation,
    deleteRun: deleteRunMutation,
    resumeRun: resumeRunMutation,
    refetch: runsQuery.refetch,
  };
}

export function useRunProgress(runId: string | null, enabled: boolean = false) {
  return useQuery<RunStatusProgress>({
    queryKey: ['run-progress', runId],
    queryFn: () => api.getRunProgress(runId!),
    enabled: !!runId && enabled,
    refetchInterval: 5000,
    staleTime: 4000,
  });
}

export function useRunDetail(runId: string | null) {
  return useQuery<RunDetail>({
    queryKey: ['run-detail', runId],
    queryFn: () => api.getRun(runId!),
    enabled: !!runId,
  });
}

export function useRunSummary(runId: string | null) {
  return useQuery<RunSummaryData>({
    queryKey: ['run-summary', runId],
    queryFn: () => api.getRunSummary(runId!),
    enabled: !!runId,
    staleTime: 30_000,
  });
}