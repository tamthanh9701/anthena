import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, Spin, theme } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AppLayout from './layouts/AppLayout';
import { RunsProvider } from './layouts/RunsContext';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

// Lazy-loaded pages for code splitting
const PilotContractPage = lazy(() => import('./pages/PilotContractPage'));
const RunSummaryPage = lazy(() => import('./pages/RunSummaryPage'));
const PriorityFindingsPage = lazy(() => import('./pages/PriorityFindingsPage'));
const ClusterReviewPage = lazy(() => import('./pages/ClusterReviewPage'));
const ApproveQueuePage = lazy(() => import('./pages/ApproveQueuePage'));
const SnapshotViewerPage = lazy(() => import('./pages/SnapshotViewerPage'));
const DeltaChangelogPage = lazy(() => import('./pages/DeltaChangelogPage'));
const RunConfigurationPage = lazy(() => import('./pages/RunConfigurationPage'));
const SignalReliabilityReportPage = lazy(() => import('./pages/SignalReliabilityReportPage'));
const RunListPage = lazy(() => import('./pages/RunListPage'));

const Loading = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
    <Spin size="large" tip="Loading..." />
  </div>
);

const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider
        theme={{
          token: {
            colorPrimary: '#1677ff',
            borderRadius: 6,
          },
        }}
      >
        <BrowserRouter>
          <RunsProvider>
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route element={<AppLayout />}>
                  <Route path="/" element={<Navigate to="/run-summary" replace />} />
                  <Route path="/pilot-contract" element={<PilotContractPage />} />
                  <Route path="/run-summary" element={<RunSummaryPage />} />
                  <Route path="/run-summary/:runId" element={<RunSummaryPage />} />
                  <Route path="/runs" element={<RunListPage />} />
                  <Route path="/priority-findings/:runId" element={<PriorityFindingsPage />} />
                  <Route path="/cluster-review/:runId" element={<ClusterReviewPage />} />
                  <Route path="/approve-queue/:runId" element={<ApproveQueuePage />} />
                  <Route path="/snapshot-viewer/:snapshotId" element={<SnapshotViewerPage />} />
                  <Route path="/delta/:runId" element={<DeltaChangelogPage />} />
                  <Route path="/config" element={<RunConfigurationPage />} />
                  <Route path="/signal-report/:runId" element={<SignalReliabilityReportPage />} />
                </Route>
              </Routes>
            </Suspense>
          </RunsProvider>
        </BrowserRouter>
      </ConfigProvider>
    </QueryClientProvider>
  );
};

export default App;