import React from 'react';
import { Card, Table, Tag, Descriptions, Button, Typography, Space, Dropdown } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useConfig, useRuns } from '../hooks';
import { PageHeader, LoadingSkeleton } from '../components';
import type { CreateRunRequest } from '../types';

const { Text } = Typography;

const RunConfigurationPage: React.FC = () => {
  const { data: config, loading } = useConfig();
  const { createRun } = useRuns();

  const handleTriggerRun = async (mode: CreateRunRequest['mode']) => {
    try {
      await createRun.mutateAsync({ mode });
    } catch (err: any) {
      // error handled by hook
    }
  };

  const roleColumns = [
    { title: 'Role Name', dataIndex: 'role', key: 'role' },
    {
      title: 'Routes',
      dataIndex: 'routes',
      key: 'routes',
      render: (routes: string[]) => (
        <Space wrap>
          {routes.map((r) => (
            <Tag key={r} style={{ fontSize: 11 }}>{r.split('/').pop() || r}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: 'Credential Status',
      dataIndex: 'hasCreds',
      key: 'creds',
      render: (val: boolean) => (
        <Tag color={val ? 'green' : 'red'}>
          {val ? 'Configured' : 'Missing'}
        </Tag>
      ),
    },
  ];

  const items = [
    { key: 'all', label: 'Re-crawl all routes', icon: <ReloadOutlined />, onClick: () => handleTriggerRun('all') },
    { key: 'route', label: 'Re-crawl specific route', icon: <PlusOutlined />, onClick: () => handleTriggerRun('route') },
  ];

  return (
    <div>
      <PageHeader
        title="Run Configuration"
        subtitle="View current configuration and trigger runs"
      />

      <LoadingSkeleton loading={loading}>
        {config && (
          <>
            <Card title="Route List" style={{ marginBottom: 16 }}>
              {config.routeList.map((url) => (
                <div key={url}>
                  <Text code copyable={{ text: url }}>{url}</Text>
                </div>
              ))}
              <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                Edit via .env file — config file path: /app/config/.env
              </Text>
            </Card>

            <Card title="Role Configuration" style={{ marginBottom: 16 }}>
              <Table
                dataSource={Object.entries(config.roleMap).map(([role, routes]) => ({
                  role,
                  routes,
                  hasCreds: true,
                }))}
                columns={roleColumns}
                rowKey="role"
                size="small"
                pagination={false}
              />
              <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                Credential values: •••••••• (never displayed in plaintext)
              </Text>
            </Card>

            <Card title="Retention Policy" style={{ marginBottom: 16 }}>
              <Descriptions column={2} size="small" bordered>
                <Descriptions.Item label="Max Runs Per Route">{config.maxRunsPerRoute}</Descriptions.Item>
                <Descriptions.Item label="Failed Run Retention (days)">{config.failedRunRetentionDays}</Descriptions.Item>
                <Descriptions.Item label="Retry Count">{config.retryCount}</Descriptions.Item>
                <Descriptions.Item label="Route Timeout (ms)">{config.routeTimeoutMs}</Descriptions.Item>
                <Descriptions.Item label="Queue Poll Interval (ms)">{config.queuePollIntervalMs}</Descriptions.Item>
                <Descriptions.Item label="Playwright Headless">
                  <Tag color={config.playwrightHeadless ? 'green' : 'orange'}>
                    {config.playwrightHeadless ? 'Yes' : 'No'}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Figma Configured">
                  <Tag color={config.figmaConfigured ? 'green' : 'red'}>
                    {config.figmaConfigured ? 'Yes' : 'No'}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Log Level">
                  <Tag>{config.logLevel}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Pilot Contract Signed">
                  <Tag color={config.pilotContractSigned ? 'green' : 'orange'}>
                    {config.pilotContractSigned ? 'Yes' : 'No'}
                  </Tag>
                </Descriptions.Item>
              </Descriptions>
            </Card>

            <Card title="Trigger Re-Crawl">
              <Space>
                <Dropdown menu={{ items }} trigger={['click']}>
                  <Button type="primary" icon={<PlusOutlined />} loading={createRun.isPending}>
                    New Run
                  </Button>
                </Dropdown>
              </Space>
            </Card>
          </>
        )}
      </LoadingSkeleton>
    </div>
  );
};

export default RunConfigurationPage;
