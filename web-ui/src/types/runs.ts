// Run types — matching contract.yaml Run schemas
export type RunStatus = 'pending' | 'running' | 'completed' | 'partially-completed' | 'failed' | 'interrupted';

export interface RunSummary {
  runId: string;
  status: RunStatus;
  totalRoutes: number;
  completedRoutes: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  duration: number | null;
  error: string | null;
  pinned: boolean;
}

export interface PaginatedRuns {
  runs: RunSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface RunDetail {
  runId: string;
  status: RunStatus;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  routeList: string[];
  roleList: string[];
  processedRoutes: ProcessedRoute[];
  retryCount: number;
  totalRoutes: number;
  completedRoutes: number;
  pinned: boolean;
  pilotContractId: string | null;
  schemaVersion: string;
}

export interface ProcessedRoute {
  route: string;
  role: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  retryCount: number;
  error: string | null;
}

export interface RunStatusProgress {
  runId: string;
  status: RunStatus;
  totalRoutes: number;
  completedRoutes: number;
  progress: number;
  currentStage: 'collecting' | 'extracting' | 'analyzing';
  startedAt: string | null;
  estimatedRemainingSeconds: number | null;
  errors: RunError[];
}

export interface RunError {
  route: string;
  role: string;
  message: string;
}

export interface RunSummaryData {
  runId: string;
  status: RunStatus;
  metrics: {
    routesCrawled: number;
    totalNodes: number;
    totalClusters: number;
    topDriftScore: number | null;
    crawlDuration: number;
    extractionDuration: number;
    analysisDuration: number;
  };
  topFindings: TopFinding[];
  routes: RouteBreakdown[];
  reportFiles: string[];
  createdAt: string;
  completedAt: string | null;
}

export interface TopFinding {
  clusterId: string;
  clusterName: string;
  priorityScore: number;
  representativeCrop: string;
}

export interface RouteBreakdown {
  url: string;
  role: string;
  status: string;
  nodeCount: number;
  clusterCount: number;
  driftScore: number | null;
}

export interface CreateRunRequest {
  mode: 'all' | 'route';
  route?: string;
  roles?: string[];
}

export interface CreateRunResponse {
  runId: string;
  status: 'pending';
  totalRoutes: number;
}

export interface ResumeRunResponse {
  runId: string;
  status: 'running';
  checkpoint: {
    completedRoutes: number;
    remainingRoutes: number;
  };
}