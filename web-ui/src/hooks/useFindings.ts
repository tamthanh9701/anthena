import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/endpoints';
import type {
  PaginatedFindings,
  FindingDetail,
  FeedbackPayload,
  PaginatedClusters,
  ClusterDetail,
  ClusterReviewAction,
  BatchReviewRequest,
  BatchReviewResponse,
} from '../types';

export function useFindings(
  runId: string | null,
  params?: { page?: number; limit?: number; topN?: number; driftType?: string; role?: string; status?: string }
) {
  const queryClient = useQueryClient();

  const findingsQuery = useQuery<PaginatedFindings>({
    queryKey: ['findings', runId, params],
    queryFn: () => api.listFindings(runId!, params),
    enabled: !!runId,
    staleTime: 30_000,
  });

  const feedbackMutation = useMutation({
    mutationFn: ({ findingId, data }: { findingId: string; data: FeedbackPayload }) =>
      api.updateFinding(findingId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['findings', runId] });
    },
  });

  return {
    findings: findingsQuery.data?.findings ?? [],
    total: findingsQuery.data?.total ?? 0,
    loading: findingsQuery.isLoading,
    error: findingsQuery.error,
    submitFeedback: feedbackMutation,
    refetch: findingsQuery.refetch,
  };
}

export function useFindingDetail(runId: string | null, findingId: string | null) {
  return useQuery<FindingDetail>({
    queryKey: ['finding', runId, findingId],
    queryFn: () => api.getFinding(runId!, findingId!),
    enabled: !!runId && !!findingId,
  });
}

export function useClusters(
  runId: string | null,
  params?: { page?: number; limit?: number; driftClassification?: string; approvalStatus?: string; sortBy?: string; order?: string }
) {
  const queryClient = useQueryClient();

  const clustersQuery = useQuery<PaginatedClusters>({
    queryKey: ['clusters', runId, params],
    queryFn: () => api.listClusters(runId!, params),
    enabled: !!runId,
    staleTime: 30_000,
  });

  const updateClusterMutation = useMutation({
    mutationFn: ({ clusterId, data }: { clusterId: string; data: ClusterReviewAction }) =>
      api.updateCluster(clusterId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clusters', runId] });
    },
  });

  const batchReviewMutation = useMutation<BatchReviewResponse, any, { runId: string; data: BatchReviewRequest }>({
    mutationFn: ({ runId: rid, data }) => api.batchReviewClusters(rid, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clusters', runId] });
    },
  });

  return {
    clusters: clustersQuery.data?.clusters ?? [],
    total: clustersQuery.data?.total ?? 0,
    loading: clustersQuery.isLoading,
    error: clustersQuery.error,
    updateCluster: updateClusterMutation,
    batchReview: batchReviewMutation,
    refetch: clustersQuery.refetch,
  };
}

export function useClusterDetail(clusterId: string | null) {
  return useQuery<ClusterDetail>({
    queryKey: ['cluster', clusterId],
    queryFn: () => api.getCluster(clusterId!),
    enabled: !!clusterId,
  });
}