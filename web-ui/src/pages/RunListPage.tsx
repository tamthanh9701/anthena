import React, { useState } from 'react';
import { Table, Tag, Button, Space, Progress, message, Typography, Popconfirm } from 'antd';
import { DeleteOutlined, ReloadOutlined, EyeOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useRuns, useRunProgress } from '../hooks';
import { PageHeader, StatusTag, LoadingSkeleton, EmptyState } from '../components';
import type { RunSummary } from '../types';

const { Text } = Typography;

const RunListPage: React.FC = () => {
  const navigate = useNavigate();
  const { runs, total, loading, createRun, deleteRun, resumeRun, refetch } = useRuns();
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const { data: progress } = useRunProgress(activeRunId, !!activeRunId);

  const runningRun = runs.find((r) => r.status === 'running' || r.status === 'pending');
  if (runningRun && !activeRunId) setActiveRunId(runningRun.runId);

  const handleDelete = async (runId: string) => {
    try {
      await deleteRun.mutateAsync(runId);
      message.success('Run deleted');
    } catch (err: any) {
      message.error(err?.error || 'Failed to delete run');
    }
  };

  const handleResume = async (runId: string) => {
    try {
      await resumeRun.mutateAsync(runId);
      message.success('Run resumed');
      refetch();
    } catch (err: any) {
      message.error(err?.error || 'Failed to resume run');
    }
  };

  const columns = [
    {
      title: 'Run ID',
      dataIndex: 'runId',
      key: 'runId',
      render: (id: string) => <Text code>{id.slice(0, 12)}...</Text>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => <StatusTag status={s as any} />,
    },
    {
      title: 'Routes',
      key: 'routes',
      render: (_: any, r: RunSummary) => r.completedRoutes + ' / ' + r.totalRoutes,
    },
    {
      title: 'Progress',
      key: 'progress',
      render: (_: any, r: RunSummary) => {
        if (r.status === 'running' && progress) {
          return <Progress percent={Math.round(progress.progress)} size="small" style={{ width: 120 }} />;
        }
        if (r.status === 'completed') return <Progress percent={100} size="small" style={{ width: 120 }} />;
        if (r.status === 'failed') return <Progress percent={0} status="exception" size="small" style={{ width: 120 }} />;
        return '-';
      },
    },
    {
      title: 'Started',
      dataIndex: 'startedAt',
      key: 'startedAt',
      render: (d: string | null) => d ? new Date(d).toLocaleString() : '-',
    },
    {
      title: 'Duration',
      dataIndex: 'duration',
      key: 'duration',
      render: (d: number | null) => {
        if (d == null) return '-';
        if (d < 60) return Math.round(d) + 's';
        return Math.floor(d / 60) + 'm ' + Math.round(d % 60) + 's';
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, r: RunSummary) => (
        <Space>
          {r.status === 'completed' && (
            <Button
              size="small"
              icon={<EyeOutlined />}
              onClick={() => navigate('/run-summary/' + r.runId)}
            >
              View
            </Button>
          )}
          {r.status === 'interrupted' && (
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => handleResume(r.runId)}
              loading={resumeRun.isPending}
            >
              Resume
            </Button>
          )}
          {r.status !== 'running' && (
            <Popconfirm title="Delete this run?" onConfirm={() => handleDelete(r.runId)}>
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Run Manager"
        subtitle={total + ' total runs'}
      />

      {runningRun && progress && (
        <div style={{ marginBottom: 16, padding: 16, background: '#f6f8fa', borderRadius: 8 }}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Text strong>Active Run: {activeRunId?.slice(0, 12)}...</Text>
            <Progress percent={Math.round(progress.progress)} status="active" />
            <Space>
              <Tag color="processing">{progress.currentStage}</Tag>
              <Text type="secondary">
                {progress.completedRoutes} / {progress.totalRoutes} routes completed
              </Text>
              {progress.estimatedRemainingSeconds != null && (
                <Text type="secondary">
                  Est. remaining: {Math.round(progress.estimatedRemainingSeconds / 60)}m
                </Text>
              )}
            </Space>
          </Space>
        </div>
      )}

      <LoadingSkeleton loading={loading}>
        {runs.length === 0 ? (
          <EmptyState
            message="No runs yet"
            actionLabel="Create First Run"
            onAction={() => createRun.mutate({ mode: 'all' })}
          />
        ) : (
          <Table
            dataSource={runs}
            columns={columns}
            rowKey="runId"
            pagination={{ pageSize: 20, showSizeChanger: false, total }}
            size="small"
          />
        )}
      </LoadingSkeleton>
    </div>
  );
};

export default RunListPage;