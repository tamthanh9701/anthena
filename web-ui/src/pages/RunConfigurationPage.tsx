import React, { useMemo, useState } from 'react';
import { Alert, Card, Table, Tag, Descriptions, Button, Typography, Space, Dropdown, Select, message } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useConfig, useRuns } from '../hooks';
import { PageHeader, LoadingSkeleton } from '../components';
import type { CreateRunRequest } from '../types';

const { Paragraph, Text } = Typography;

function getErrorMessage(err: any, fallback: string) {
  return err?.error || err?.message || fallback;
}

const RunConfigurationPage: React.FC = () => {
  const { data: config, isLoading: loading } = useConfig();
  const { createRun } = useRuns();
  const [selectedRoute, setSelectedRoute] = useState<string | undefined>();

  const routes = config?.routeList ?? [];
  const hasCrawlerRoutes = routes.length > 0;

  const routeOptions = useMemo(
    () => routes.map((route) => ({ label: route, value: route })),
    [routes]
  );

  const handleTriggerRun = async (mode: CreateRunRequest['mode']) => {
    try {
      if (mode === 'route') {
        if (!selectedRoute) {
          message.warning('Choose a route before starting a specific-route crawl');
          return;
        }
        const result = await createRun.mutateAsync({ mode, route: selectedRoute });
        message.success(`Route crawl queued: ${result.runId}`);
        return;
      }

      const result = await createRun.mutateAsync({ mode });
      if (result.totalRoutes === 0) {
        message.info(`Run created as an extension capture container: ${result.runId}`);
      } else {
        message.success(`Crawl queued: ${result.runId}`);
      }
    } catch (err: any) {
      message.error(getErrorMessage(err, 'Failed to create run'));
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
    {
      key: 'all',
      label: hasCrawlerRoutes ? 'Re-crawl all routes' : 'Create extension capture run',
      icon: <ReloadOutlined />,
      onClick: () => handleTriggerRun('all'),
    },
    {
      key: 'route',
      label: 'Re-crawl selected route',
      icon: <PlusOutlined />,
      disabled: !hasCrawlerRoutes || !selectedRoute,
      onClick: () => handleTriggerRun('route'),
    },
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
            {!hasCrawlerRoutes && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
                message="No crawler routes configured"
                description="Crawler actions will create a zero-route run. That run is still useful as an extension upload container, but Playwright route coverage needs ROUTE_LIST/ROLE_MAP configured later."
              />
            )}

            <Card title="Route List" style={{ marginBottom: 16 }}>
              {hasCrawlerRoutes ? (
                config.routeList.map((url) => (
                  <div key={url}>
                    <Text code copyable={{ text: url }}>{url}</Text>
                  </div>
                ))
              ) : (
                <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                  No routes are configured in production. Use the Run Manager to create an extension capture run, or add routes to the deployment .env before using Playwright crawling.
                </Paragraph>
              )}
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
                locale={{ emptyText: 'No roles configured' }}
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

            <Card title="Trigger Run">
              <Space direction="vertical" style={{ width: '100%' }}>
                <Select
                  allowClear
                  disabled={!hasCrawlerRoutes}
                  placeholder={hasCrawlerRoutes ? 'Optional: choose a route for specific-route crawl' : 'No crawler routes configured'}
                  options={routeOptions}
                  value={selectedRoute}
                  onChange={setSelectedRoute}
                  style={{ width: '100%' }}
                />
                <Space>
                  <Dropdown menu={{ items }} trigger={['click']}>
                    <Button type="primary" icon={<PlusOutlined />} loading={createRun.isPending}>
                      New Run
                    </Button>
                  </Dropdown>
                  {!hasCrawlerRoutes && (
                    <Text type="secondary">
                      Creates a run container for extension uploads.
                    </Text>
                  )}
                </Space>
              </Space>
            </Card>
          </>
        )}
      </LoadingSkeleton>
    </div>
  );
};

export default RunConfigurationPage;
