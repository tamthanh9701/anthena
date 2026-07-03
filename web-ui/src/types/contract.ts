// Pilot Contract types — matching contract.yaml PilotContract schema
export interface PilotContract {
  id: string;
  operatorName: string;
  operatorRole: string;
  environment: 'dev' | 'staging';
  routeList: string[];
  reviewBudgetMinutes: number;
  maxCandidates: number;
  reviewMode: 'screen' | 'component-cluster' | 'token-group' | 'drift-severity';
  definitionOfInsight: string[];
  phase0DoD: string[];
  pilotDoD: string[];
  topN: number;
  cosignedAt: string | null;
  cosignedBy: string | null;
  createdAt: string;
  version: number;
}

export interface PilotContractInput {
  operatorName: string;
  operatorRole: string;
  environment: 'dev' | 'staging';
  routeList: string[];
  reviewBudgetMinutes: number;
  maxCandidates: number;
  reviewMode: string;
  definitionOfInsight: string[];
  phase0DoD: string[];
  pilotDoD: string[];
  topN?: number;
}

export interface CosignResponse {
  status: 'signed';
  cosignedAt: string;
  cosignedBy: string;
}

export interface ContractStatus {
  signed: boolean;
  cosignedAt: string | null;
  cosignedBy: string | null;
}