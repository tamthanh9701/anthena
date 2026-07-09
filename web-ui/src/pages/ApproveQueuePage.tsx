import React, { useState } from 'react';
import { Tabs, Table, Button, Tag, Space, Badge, Modal, message, Typography, Tooltip, Empty } from 'antd';
import { SyncOutlined, DownloadOutlined } from '@ant-design/icons';
import { useParams } from 'react-router-dom';
import { useApproveQueue } from '../hooks';
import { PageHeader, RunSelector, CropThumbnail, LoadingSkeleton } from '../components';
import type { QueueItem } from '../types';

const { Text } = Typography;

const ApproveQueuePage: React.FC = () => {
  const { runId: paramId } = useParams<{ runId: string }>();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(paramId || null);
  const [activeTab, setActiveTab] = useState('pending');
  const [syncModalOpen, setSyncModalOpen] = useState(false);

  const { queue, loading, syncToFigma, exportTokens, refetch } = useApproveQueue(selectedRunId);

  const getTabData = (tab: string): QueueItem[] => {
    if (!queue) return [];
    switch (tab) {
      case 'pending': return queue.pending;
      case 'approved': return queue.approved;
      case 'rejected': return queue.rejected;
      case 'deferred': return queue.deferred;
      default: return [];
    }
  };

  const handleSync = async () => {
    try {
      await syncToFigma.mutateAsync();
      message.success('Sync initiated successfully');
      setSyncModalOpen(false);
      refetch();
    } catch (err: any) {
      message.error(err?.error || 'Sync failed');
    }
  };

  const handleExport = async (format: 'w3c-tokens' | 'style-dictionary') => {
    try {
      await exportTokens.mutateAsync(format);
      message.success('Export (' + format + ') initiated');
    } catch (err: any) {
      message.error(err?.error || 'Export failed');
    }
  };

  const columns = [
    {
      title: 'Thumbnail',
      dataIndex: 'cropPath',
      key: 'crop',
      width: 80,
      render: (path: string) => <CropThumbnail cropUrl={path} size={48} />,
    },
    { title: 'Name', dataIndex: 'name', key: 'name', ellipsis: true },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      width: 100,
      render: (t: string) => <Tag>{t}</Tag>,
    },
    {
      title: 'Priority Score',
      dataIndex: 'priorityScore',
      key: 'priorityScore',
      width: 120,
      sorter: (a: any, b: any) => a.priorityScore - b.priorityScore,
      render: (v: number) => <Text strong>{v.toFixed(1)}</Text>,
    },
    {
      title: 'Submitted',
      dataIndex: 'submittedAt',
      key: 'submittedAt',
      width: 160,
      render: (d: string) => new Date(d).toLocaleString(),
    },
    {
      title: 'Note',
      dataIndex: 'note',
      key: 'note',
      ellipsis: true,
      render: (n: string | null) => n || '-',
    },
  ];

  const tabItems = [
    { key: 'pending', label: <Badge count={queue?.pending.length ?? 0} size="small">Pending</Badge> },
    { key: 'approved', label: <Badge count={queue?.approved.length ?? 0} size="small" color="green">Approved</Badge> },
    { key: 'rejected', label: <Badge count={queue?.rejected.length ?? 0} size="small" color="red">Rejected</Badge> },
    { key: 'deferred', label: <Badge count={queue?.deferred.length ?? 0} size="small" color="orange">Deferred</Badge> },
  ];

  const currentData = getTabData(activeTab);

  return (
    <div>
      <PageHeader
        title="Approve Queue"
        subtitle={selectedRunId ? 'Run: ' + selectedRunId.slice(0, 8) + '...' : undefined}
        extra={
          <RunSelector selectedRunId={selectedRunId} onChange={setSelectedRunId} />
        }
      />

      <LoadingSkeleton loading={loading}>
        {!queue ? (
          <Empty description="No queue data available" />
        ) : (
          <>
            <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              items={tabItems.map((t) => ({
                key: t.key,
                label: t.label,
                children: (
                  <Table
                    dataSource={currentData}
                    columns={columns}
                    rowKey="id"
                    size="small"
                    pagination={{ pageSize: 20, showSizeChanger: false }}
                  />
                ),
              }))}
            />

            <div style={{ marginTop: 24, padding: 16, background: '#fafafa', borderRadius: 8 }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text strong>Sync Actions</Text>
                <Space>
                  <Tooltip title={queue.approved.length === 0 ? 'No approved items to sync' : undefined}>
                    <Button
                      type="primary"
                      icon={<SyncOutlined />}
                      onClick={() => setSyncModalOpen(true)}
                      disabled={queue.approved.length === 0}
                    >
                      Sync Approved to Figma
                    </Button>
                  </Tooltip>
                  {!queue.figmaLicenseConfirmed && (
                    <Text type="warning">Figma API unavailable — use fallback export</Text>
                  )}
                  <Button icon={<DownloadOutlined />} onClick={() => handleExport('w3c-tokens')}>
                    Export W3C Tokens
                  </Button>
                  <Button icon={<DownloadOutlined />} onClick={() => handleExport('style-dictionary')}>
                    Export Style Dictionary
                  </Button>
                </Space>
              </Space>
            </div>
          </>
        )}
      </LoadingSkeleton>

      <Modal
        title="Confirm Sync"
        open={syncModalOpen}
        onOk={handleSync}
        onCancel={() => setSyncModalOpen(false)}
        confirmLoading={syncToFigma.isPending}
        okText="Confirm Sync"
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text>Items to sync: <strong>{queue?.approved.length ?? 0}</strong></Text>
          {queue?.approved.map((item) => (
            <div key={item.id}>
              <Tag>{item.type}</Tag> {item.name}
            </div>
          ))}
          {!queue?.figmaLicenseConfirmed && (
            <Text type="warning" style={{ display: 'block', marginTop: 8 }}>
              Figma API license not confirmed. Consider using export instead.
            </Text>
          )}
        </Space>
      </Modal>
    </div>
  );
};

export default ApproveQueuePage;
