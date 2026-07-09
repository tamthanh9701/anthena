import React, { Suspense, lazy, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Button, Card, ConfigProvider, Form, Input, Spin, Typography } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AppLayout from './layouts/AppLayout';
import { RunsProvider } from './layouts/RunsContext';
import { setSessionToken } from './api/client';

const { Paragraph, Text, Title } = Typography;

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
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const handleTokenSubmit = ({ token }: { token: string }) => {
    const trimmedToken = token.trim();
    if (!trimmedToken) return;
    setSessionToken(trimmedToken);
    setIsAuthenticated(true);
  };

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
        {!isAuthenticated ? (
          <div
            style={{
              minHeight: '100vh',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#f5f5f5',
              padding: 24,
            }}
          >
            <Card style={{ width: '100%', maxWidth: 420 }}>
              <Title level={3} style={{ marginTop: 0 }}>Anthena Web UI</Title>
              <Paragraph type="secondary">
                Enter the admin API token for this session. The token is kept in memory only and is cleared when the page refreshes.
              </Paragraph>
              <Form layout="vertical" onFinish={handleTokenSubmit}>
                <Form.Item
                  label="Admin API token"
                  name="token"
                  rules={[{ required: true, message: 'Enter the admin API token' }]}
                >
                  <Input.Password autoFocus autoComplete="off" placeholder="Paste token" />
                </Form.Item>
                <Button type="primary" htmlType="submit" block>
                  Open dashboard
                </Button>
              </Form>
              <Text type="secondary" style={{ display: 'block', marginTop: 16 }}>
                The static UI loads publicly; API actions require Bearer auth.
              </Text>
            </Card>
          </div>
        ) : (
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
        )}
      </ConfigProvider>
    </QueryClientProvider>
  );
};

export default App;
