import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/endpoints';
import type {
  PilotContract,
  PilotContractInput,
  CosignResponse,
  ContractStatus,
} from '../types';

export function useContract() {
  const queryClient = useQueryClient();

  const contractQuery = useQuery<PilotContract>({
    queryKey: ['pilot-contract'],
    queryFn: api.getPilotContract,
    retry: 1,
    staleTime: 60_000,
  });

  const statusQuery = useQuery<ContractStatus>({
    queryKey: ['pilot-contract-status'],
    queryFn: api.getPilotContractStatus,
    retry: 1,
    staleTime: 30_000,
  });

  const saveDraft = useMutation({
    mutationFn: (data: PilotContractInput) => api.upsertPilotContract(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pilot-contract'] });
    },
  });

  const cosign = useMutation<CosignResponse, any, { operatorName: string; operatorRole: string }>({
    mutationFn: ({ operatorName, operatorRole }) => api.cosignPilotContract(operatorName, operatorRole),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pilot-contract'] });
      queryClient.invalidateQueries({ queryKey: ['pilot-contract-status'] });
    },
  });

  return {
    contract: contractQuery.data ?? null,
    status: statusQuery.data ?? null,
    isSigned: statusQuery.data?.signed ?? false,
    loading: contractQuery.isLoading || statusQuery.isLoading,
    error: contractQuery.error || statusQuery.error,
    saveDraft,
    cosign,
  };
}