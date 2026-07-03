import React, { useState } from 'react';
import { Table, Tag, Select, Space, Button, Card, Modal, Input, message, Typography } from 'antd';
import { useParams } from 'react-router-dom';
import { useFindings } from '../hooks';
import { PageHeader, RunSelector, CropThumbnail, ConfidenceBadge, LoadingSkeleton, EmptyState } from '../components';
import type { FindingSummary } from '../types';

const { Text } = Typography;
const { TextArea } = Input;

const driftTypeColors: Record<string, string> = {
  'antd-aligned': 'green',
  'drifted': 'orange',
  'custom': 'red',
};

const PriorityFindingsPage: React.FC = () => {
  const { runId: paramId } = useParams<{ runId: string }>();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(paramId || null);
  const [driftFilter, setDriftFilter] = useState<string | undefined>();
  const [roleFilter, setRoleFilter] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [feedbackModal, setFeedbackModal] = useState<{ findingId: string; clusterName: string } | null>(null);
  const [feedbackValue, setFeedbackValue] = useState<string>('');

  const { findings, total, loading, submitFeedback, refetch } = useFindings(selectedRunId, {
    page,
    limit: 20,
    driftType: driftFilter,
    role: roleFilter,
  });

  const handleFeedback = async () => {
    if (!feedbackModal) return;
    try {
      await submitFeedback.mutateAsync({
        findingId: feedbackModal.findingId,
        data: { feedback: feedbackValue as any },
      });
      message.success('Feedback recorded');
      setFeedbackModal(null);
    } catch (err: any) {
      message.error(err?.error || 'Failed to record feedback');
    }
  };

  const columns = [
    {
      title: 'Rank',
      dataIndex: 'rank',
      key: 'rank',
      width: 60,
    },
    {
      title: 'Thumbnail',
      dataIndex: 'representativeCrop',
      key: 'crop',
      width: 100,
      render: (crop: string) => (
        <CropThumbnail cropUrl={crop} size={60} alt="Finding crop" />
      ),
    },
    {
      title: 'Cluster Name',
      dataIndex: 'clusterName',
      key: 'clusterName',
      render: (name: string, record: FindingSummary) => (
        <Space direction="vertical" size={0}>
          <Text strong>{name}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>ID: {record.clusterId.slice(0, 8)}...</Text>
        </Space>
      ),
    },
    {
      title: 'Priority Score',
      dataIndex: 'priorityScore',
      key: 'priorityScore',
      sorter: (a: any, b: any) => a.priorityScore - b.priorityScore,
      render: (v: number) => <Text strong>{v.toFixed(1)}</Text>,
    },
    {
      title: 'Usage Count',
      dataIndex: 'usageCount',
      key: 'usageCount',
      sorter: (a: any, b: any) => a.usageCount - b.usageCount,
    },
    {
      title: 'Drift Score',
      dataIndex: 'driftScore',
      key: 'driftScore',
      sorter: (a: any, b: any) => (a.driftScore ?? 0) - (b.driftScore ?? 0),
      render: (v: number | null) => v != null ? v.toFixed(2) : '-',
    },
    {
      title: 'Drift Type',
      dataIndex: 'driftClassification',
      key: 'driftType',
      render: (t: string | null) => t ? <Tag color={driftTypeColors[t]}>{t}</Tag> : '-',
    },
    {
      title: 'Screens',
      dataIndex: 'screens',
      key: 'screens',
      ellipsis: true,
      render: (screens: string[]) => (
        <Space size={4} wrap>
          {screens.slice(0, 3).map((s) => <Tag key={s}>{s.split('/').pop()}</Tag>)}
          {screens.length > 3 && <Tag>+{screens.length - 3}</Tag>}
        </Space>
      ),
    },
    {
      title: 'Feedback',
      key: 'feedback',
      width: 120,
      render: (_: any, record: FindingSummary) => (
        <Button
          size="small"
          onClick={() => setFeedbackModal({
            findingId: record.findingId,
            clusterName: record.clusterName,
          })}
        >
          Rate Priority
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Priority Findings"
        subtitle={selectedRunId ? 'Run: ' + selectedRunId.slice(0, 8) + '...' : undefined}
        extra={
          <RunSelector
            selectedRunId={selectedRunId}
            onChange={(id) => { setSelectedRunId(id); setPage(1); }}
          />
        }
      />

      <Card style={{ marginBottom: 16 }}>
        <Space>
          <Text>Drift Type:</Text>
          <Select
            allowClear
            placeholder="All types"
            style={{ width: 160 }}
            value={driftFilter}
            onChange={setDriftFilter}
            options={[
              { value: 'antd-aligned', label: 'AntD Aligned' },
              { value: 'drifted', label: 'Drifted' },
              { value: 'custom', label: 'Custom' },
            ]}
          />
          <Text>Role:</Text>
          <Select
            allowClear
            placeholder="All roles"
            style={{ width: 140 }}
            value={roleFilter}
            onChange={setRoleFilter}
            options={[
              { value: 'admin', label: 'Admin' },
              { value: 'user', label: 'User' },
            ]}
          />
        </Space>
      </Card>

      <LoadingSkeleton loading={loading}>
        {findings.length === 0 ? (
          <EmptyState message="No findings available. Select a run with completed analysis." />
        ) : (
          <Table
            dataSource={findings}
            columns={columns}
            rowKey="findingId"
            pagination={{
              current: page,
              pageSize: 20,
              total,
              onChange: setPage,
              showSizeChanger: false,
            }}
            expandable={{
              expandedRowRender: (record) => (
                <div style={{ padding: 16 }}>
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Space>
                      <Text strong>Identity Confidence:</Text>
                      <ConfidenceBadge confidence={record.confidenceAvg ?? 0} />
                    </Space>
                    <Text>Screens: {record.screens.join(', ')}</Text>
                    <Text>Roles: {record.roles.join(', ')}</Text>
                  </Space>
                </div>
              ),
            }}
          />
        )}
      </LoadingSkeleton>

      <Modal
        title={'Rate Priority: ' + (feedbackModal?.clusterName ?? '')}
        open={!!feedbackModal}
        onOk={handleFeedback}
        onCancel={() => setFeedbackModal(null)}
        confirmLoading={submitFeedback.isPending}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Select
            style={{ width: '100%' }}
            placeholder="Select feedback"
            value={feedbackValue || undefined}
            onChange={setFeedbackValue}
            options={[
              { value: 'correct-priority', label: 'Correct Priority' },
              { value: 'over-prioritized', label: 'Over-Prioritized' },
              { value: 'under-prioritized', label: 'Under-Prioritized' },
            ]}
          />
        </Space>
      </Modal>
    </div>
  );
};

export default PriorityFindingsPage;
