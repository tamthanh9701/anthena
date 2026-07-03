// Node, Cluster, Finding types — matching contract.yaml
export interface NodeIdentity {
  name: string | null;
  source: 'react-fiber' | 'dom-css' | 'antd-class' | 'a11y-tree' | 'heuristic';
  confidence: number;
  ownerPath: string[] | null;
  evidence: string[];
}

export interface Classification {
  type: 'antd' | 'custom' | 'unknown';
  source: 'ensemble' | 'dom-css' | 'antd-class' | 'a11y-tree' | 'react-fiber' | 'heuristic';
  confidence: number;
  evidence: string[];
}

export interface NodeSummary {
  id: string;
  nodeIdentifier: string | null;
  domTag: string;
  classList: string[];
  identity: NodeIdentity;
  classification: Classification;
  rectX: number;
  rectY: number;
  rectW: number;
  rectH: number;
  thumbnailUrl: string | null;
  cropUrl: string | null;
  driftScore: number | null;
  confidence: number;
}

export interface NodeDetail {
  id: string;
  snapshotId: string;
  nodeIdentifier: string | null;
  identity: NodeIdentity;
  classification: Classification;
  rectX: number;
  rectY: number;
  rectW: number;
  rectH: number;
  computedStyles: Record<string, string>;
  driftScore: number | null;
  cropUrl: string | null;
  thumbnailUrl: string | null;
  visualHash: string | null;
  domTag: string;
  classList: string[];
  extractedAt: string;
}

export interface ClusterDetail {
  clusterId: string;
  name: string;
  usageCount: number;
  driftScore: number | null;
  driftClassification: 'antd-aligned' | 'drifted' | 'custom' | null;
  driftedProperties: DriftedProperty[];
  priorityScore: number | null;
  approvalStatus: 'pending' | 'approved' | 'rejected' | 'deferred';
  approvalNote: string | null;
  approvedAt: string | null;
  representativeNodeId: string | null;
  representativeCrop: string | null;
  confidenceDistribution: {
    min: number;
    max: number;
    avg: number;
  };
  screens: ScreenRef[];
  memberNodes: NodeSummary[];
  evidenceCitations: string[];
}

export interface DriftedProperty {
  property: string;
  expected: string;
  actual: string;
}

export interface ScreenRef {
  url: string;
  role: string;
}

export interface FindingSummary {
  findingId: string;
  clusterId: string;
  clusterName: string;
  priorityScore: number;
  rank: number;
  usageCount: number;
  driftScore: number | null;
  driftClassification: 'antd-aligned' | 'drifted' | 'custom' | null;
  representativeCrop: string | null;
  screens: string[];
  roles: string[];
  status: 'pending' | 'reviewed' | 'approved' | 'rejected';
  confidenceAvg: number | null;
}

export interface FindingDetail extends FindingSummary {
  identity: NodeIdentity;
  classification: Classification;
  evidence: string[];
  confidenceDistribution: {
    min: number;
    max: number;
    avg: number;
  };
  designerFeedback: string | null;
  feedbackAt: string | null;
}

export interface PaginatedFindings {
  findings: FindingSummary[];
  total: number;
  page: number;
  limit: number;
  topN: number | null;
}

export interface PaginatedClusters {
  clusters: ClusterDetail[];
  total: number;
  page: number;
  limit: number;
}