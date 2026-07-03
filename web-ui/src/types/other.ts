// Queue, Snapshot, Signal Report, Delta, Config types
export interface ApproveQueue {
  pending: QueueItem[];
  approved: QueueItem[];
  rejected: QueueItem[];
  deferred: QueueItem[];
  figmaLicenseConfirmed: boolean;
  total: number;
}

export interface QueueItem {
  id: string;
  type: 'token' | 'component';
  name: string;
  clusterId: string | null;
  priorityScore: number;
  cropPath: string;
  submittedAt: string;
  note: string | null;
}

export interface SnapshotSummary {
  id: string;
  runId: string;
  url: string;
  role: string;
  status: 'captured' | 'extracted' | 'analyzed';
  capturedAt: string;
  nodeCount: number;
  viewportWidth: number;
  viewportHeight: number;
  schemaVersion: string;
  error: string | null;
  isLegacy: boolean;
}

export interface SnapshotDetail {
  id: string;
  runId: string;
  url: string;
  role: string;
  capturedAt: string;
  schemaVersion: string;
  extractorVersion: string | null;
  analyzerVersion: string | null;
  status: 'captured' | 'extracted' | 'analyzed';
  nodeCount: number;
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor: number;
  };
  screenshotUrl: string;
  nodes: NodeSummary[];
  error: string | null;
  isLegacy: boolean;
  feedback: Record<string, unknown> | null;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { NodeSummary } from './nodes';

export interface SignalReliabilityReport {
  runId: string;
  contractRef: string;
  operatorName: string;
  operatorRole: string;
  environment: string;
  pilotRoute: string;
  generatedAt: string;
  signals: SignalCheck[];
  killCriteria: KillCriterion[];
  metrics: {
    crawlDuration: number;
    extractionDuration: number;
  };
}

export interface SignalCheck {
  name: string;
  status: 'YES' | 'NO';
  blockerType: 'blocker' | 'non-blocker' | null;
  reason: string | null;
}

export interface KillCriterion {
  id: string;
  description: string;
  triggered: boolean;
}

export interface DeltaReport {
  runId: string;
  previousRunId: string;
  comparedAt: string;
  categories: {
    newComponents: DeltaItem[];
    missingComponents: DeltaItem[];
    tokenChanges: DeltaTokenChange[];
    driftScoreChanges: DeltaDriftChange[];
  };
  changelog: ChangelogEntry[];
}

export interface DeltaItem {
  clusterName: string;
  route: string;
  role: string;
  oldCrop: string | null;
  newCrop: string | null;
  description: string;
  detectedAt: string;
}

export interface DeltaTokenChange {
  tokenName: string;
  oldValue: string;
  newValue: string;
  route: string;
  role: string;
  description: string;
  detectedAt: string;
}

export interface DeltaDriftChange {
  clusterName: string;
  oldDriftScore: number;
  newDriftScore: number;
  change: number;
  description: string;
  detectedAt: string;
}

export interface ChangelogEntry {
  id: string;
  type: 'added' | 'removed' | 'changed';
  category: 'component' | 'token' | 'drift-score';
  description: string;
  route: string;
  role: string;
  detectedAt: string;
}

export interface AppConfig {
  port: number;
  targetUrl: string;
  routeList: string[];
  roleMap: Record<string, string[]>;
  maxRunsPerRoute: number;
  failedRunRetentionDays: number;
  retryCount: number;
  routeTimeoutMs: number;
  queuePollIntervalMs: number;
  logLevel: string;
  playwrightHeadless: boolean;
  figmaConfigured: boolean;
  pilotContractSigned: boolean;
}

export interface ErrorResponse {
  error: string;
  code: string;
  requestId: string;
  gate?: string | null;
  details?: Record<string, unknown> | null;
}

export interface FeedbackPayload {
  feedback?: 'correct-priority' | 'over-prioritized' | 'under-prioritized';
  note?: string;
}

export interface ClusterReviewAction {
  action: 'approve' | 'reject' | 'defer';
  note?: string;
}

export interface BatchReviewRequest {
  clusterIds: string[];
  action: 'approve' | 'reject' | 'defer';
  note?: string;
}

export interface BatchReviewResponse {
  results: Array<{ clusterId: string; success: boolean; error: string | null }>;
  totalProcessed: number;
  totalErrors: number;
}

export interface SnapshotFeedbackPayload {
  targetType?: 'snapshot';
  targetId?: string;
  feedbackType: 'thumbs' | 'text' | 'assessment';
  feedbackValue: Record<string, unknown>;
  operatorId: string;
}

export interface SyncResponse {
  syncId: string;
  status: 'queued';
  estimatedTokenCount: number;
}

export interface ExportRequest {
  format: 'w3c-tokens' | 'style-dictionary';
}

export interface SyncStatus {
  syncActive: boolean;
  lastSyncAt: string | null;
  lastSyncResult: 'success' | 'failed' | null;
  figmaConfigured: boolean;
  figmaFileKey: string;
  pendingTokenCount: number;
}

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  uptime: number;
  database: { status: 'ok' | 'error'; latency: number };
  playwright: { status: 'ok' | 'error' | 'not-launched'; version: string | null };
}