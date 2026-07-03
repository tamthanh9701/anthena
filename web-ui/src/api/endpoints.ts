import apiClient from './client';
import type {
  PilotContract,
  PilotContractInput,
  CosignResponse,
  ContractStatus,
  PaginatedRuns,
  CreateRunRequest,
  CreateRunResponse,
  ResumeRunResponse,
  RunDetail,
  RunStatusProgress,
  RunSummaryData,
  PaginatedFindings,
  FindingDetail,
  PaginatedClusters,
  ClusterDetail,
  ApproveQueue,
  BatchReviewRequest,
  BatchReviewResponse,
  ClusterReviewAction,
  FeedbackPayload,
  SnapshotDetail,
  SnapshotFeedbackPayload,
  SignalReliabilityReport,
  DeltaReport,
  SyncResponse,
  ExportRequest,
  SyncStatus,
  AppConfig,
  HealthResponse,
} from '../types';

// ── Operations ──
export const getHealth = () => apiClient.get<HealthResponse>('/health').then((r) => r.data);
export const getConfig = () => apiClient.get<AppConfig>('/api/config').then((r) => r.data);

// ── Pilot Contract ──
export const getPilotContract = () =>
  apiClient.get<PilotContract>('/api/pilot-contract').then((r) => r.data);
export const upsertPilotContract = (data: PilotContractInput) =>
  apiClient.post<{ status: string; id: string }>('/api/pilot-contract', data).then((r) => r.data);
export const cosignPilotContract = (operatorName: string, operatorRole: string) =>
  apiClient.post<CosignResponse>('/api/pilot-contract/co-sign', { operatorName, operatorRole }).then((r) => r.data);
export const getPilotContractStatus = () =>
  apiClient.get<ContractStatus>('/api/pilot-contract/status').then((r) => r.data);

// ── Runs ──
export const listRuns = (params?: { page?: number; limit?: number; status?: string; search?: string }) =>
  apiClient.get<PaginatedRuns>('/api/runs', { params }).then((r) => r.data);
export const createRun = (data: CreateRunRequest) =>
  apiClient.post<CreateRunResponse>('/api/runs', data).then((r) => r.data);
export const getRun = (runId: string) =>
  apiClient.get<RunDetail>(`/api/runs/${runId}`).then((r) => r.data);
export const deleteRun = (runId: string) =>
  apiClient.delete<{ success: boolean; runId: string }>(`/api/runs/${runId}`).then((r) => r.data);
export const startRun = (runId: string) =>
  apiClient.post<{ runId: string; status: 'running' }>(`/api/runs/${runId}/start`).then((r) => r.data);
export const resumeRun = (runId: string) =>
  apiClient.post<ResumeRunResponse>(`/api/runs/${runId}/resume`).then((r) => r.data);
export const getRunProgress = (runId: string) =>
  apiClient.get<RunStatusProgress>(`/api/runs/${runId}/progress`).then((r) => r.data);
export const getRunSummary = (runId: string) =>
  apiClient.get<RunSummaryData>(`/api/runs/${runId}/summary`).then((r) => r.data);

// ── Snapshots ──
export const listSnapshots = (runId: string, params?: { page?: number; limit?: number; role?: string; url?: string; status?: string }) =>
  apiClient.get<{ snapshots: any[]; total: number; page: number; limit: number }>(`/api/runs/${runId}/snapshots`, { params }).then((r) => r.data);
export const getSnapshot = (snapshotId: string) =>
  apiClient.get<SnapshotDetail>(`/api/snapshots/${snapshotId}`).then((r) => r.data);
export const postSnapshotFeedback = (snapshotId: string, data: SnapshotFeedbackPayload) =>
  apiClient.post<{ status: string; feedbackId: string }>(`/api/snapshots/${snapshotId}/feedback`, data).then((r) => r.data);
export const getScreenshotUrl = (runId: string, snapshotId: string, w?: number) => {
  const url = `/api/runs/${runId}/snapshots/${snapshotId}/screenshot`;
  return w ? `${url}?w=${w}` : url;
};

// ── Nodes ──
export const listNodes = (snapshotId: string, params?: { page?: number; limit?: number; domTag?: string; classificationType?: string }) =>
  apiClient.get<{ nodes: any[]; total: number; page: number; limit: number }>(`/api/snapshots/${snapshotId}/nodes`, { params }).then((r) => r.data);
export const getNode = (nodeId: string) =>
  apiClient.get(`/api/nodes/${nodeId}`).then((r) => r.data);
export const getNodeCropUrl = (snapshotId: string, nodeId: string) =>
  `/api/snapshots/${snapshotId}/crops/${nodeId}`;
export const getNodeThumbnailUrl = (snapshotId: string, nodeId: string) =>
  `/api/snapshots/${snapshotId}/thumbnails/${nodeId}`;

// ── Clusters ──
export const listClusters = (runId: string, params?: { page?: number; limit?: number; driftClassification?: string; approvalStatus?: string; sortBy?: string; order?: string }) =>
  apiClient.get<PaginatedClusters>(`/api/runs/${runId}/clusters`, { params }).then((r) => r.data);
export const getCluster = (clusterId: string) =>
  apiClient.get<ClusterDetail>(`/api/clusters/${clusterId}`).then((r) => r.data);
export const updateCluster = (clusterId: string, data: ClusterReviewAction) =>
  apiClient.patch(`/api/clusters/${clusterId}`, data).then((r) => r.data);
export const batchReviewClusters = (runId: string, data: BatchReviewRequest) =>
  apiClient.post<BatchReviewResponse>(`/api/runs/${runId}/clusters/batch-review`, data).then((r) => r.data);

// ── Findings ──
export const listFindings = (runId: string, params?: { page?: number; limit?: number; topN?: number; driftType?: string; role?: string; status?: string }) =>
  apiClient.get<PaginatedFindings>(`/api/runs/${runId}/findings`, { params }).then((r) => r.data);
export const getFinding = (runId: string, findingId: string) =>
  apiClient.get<FindingDetail>(`/api/runs/${runId}/findings/${findingId}`).then((r) => r.data);
export const updateFinding = (findingId: string, data: FeedbackPayload) =>
  apiClient.patch(`/api/findings/${findingId}`, data).then((r) => r.data);

// ── Approve Queue ──
export const getApproveQueue = (runId: string, status?: string) =>
  apiClient.get<ApproveQueue>(`/api/runs/${runId}/approve-queue`, { params: status ? { status } : {} }).then((r) => r.data);

// ── Reports ──
export const getSignalReliabilityReport = (runId: string) =>
  apiClient.get<SignalReliabilityReport>(`/api/runs/${runId}/reports/signal-reliability`).then((r) => r.data);

// ── Delta ──
export const getDelta = (runId: string, baselineRunId: string) =>
  apiClient.get<DeltaReport>(`/api/runs/${runId}/delta`, { params: { baselineRunId } }).then((r) => r.data);

// ── Token Sync ──
export const syncToFigma = (runId: string) =>
  apiClient.post<SyncResponse>(`/api/runs/${runId}/sync/figma`).then((r) => r.data);
export const exportTokens = (runId: string, data: ExportRequest) =>
  apiClient.post(`/api/runs/${runId}/sync/export`, data).then((r) => r.data);
export const getSyncStatus = () =>
  apiClient.get<SyncStatus>('/api/sync/status').then((r) => r.data);