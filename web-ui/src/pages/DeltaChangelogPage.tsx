import React, { useState } from 'react';
import { Tabs, Card, Row, Col, Image, Tag, Space, Typography, List, Alert, Empty } from 'antd';
import { useParams } from 'react-router-dom';
import { useDelta, useRuns } from '../hooks';
import { PageHeader, RunSelector, StatusTag, LoadingSkeleton } from '../components';

const { Text, Title } = Typography;

const DeltaChangelogPage: React.FC = () => {
  const { runId: paramId } = useParams<{ runId: string }>();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(paramId || null);
  const { runs } = useRuns();

  const prevRunId = runs.length > 1 ? runs.find((r) => r.runId !== selectedRunId)?.runId ?? null : null;
  const { data: delta, loading, error } = useDelta(selectedRunId, prevRunId);

  const categoryItems = [
{ key: 'newComponents', label: 'New Components (' + (delta?.categories.newComponents.length ?? 0) + ')' },
    { key: 'missingComponents', label: 'Missing Components (' + (delta?.categories.missingComponents.length ?? 0) + ')' },
    { key: 'tokenChanges', label: 'Token Changes (' + (delta?.categories.tokenChanges.length ?? 0) + ')' },
    { key: 'driftScoreChanges', label: 'Drift Score Changes (' + (delta?.categories.driftScoreChanges.length ?? 0) + ')' },
  ];

  const renderSideBySide = (item: any, type: string) => {
    if (type === 'tokenChanges') {
      return (
        <Card size="small" style={{ marginBottom: 8 }}>
          <Space direction="vertical">
            <Text strong>{item.tokenName}: <Text delete>{item.oldValue}</Text> → <Text style={{ color: '#1677ff' }}>{item.newValue}</Text></Text>
            <Text type="secondary">{item.description}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>{item.route} ({item.role})</Text>
          </Space>
        </Card>
      );
    }

    if (type === 'driftScoreChanges') {
      return (
        <Card size="small" style={{ marginBottom: 8 }}>
          <Space>
            <Text strong>{item.clusterName}</Text>
            <Tag color={item.change > 0 ? 'red' : 'green'}>
              {item.oldDriftScore.toFixed(1)} → {item.newDriftScore.toFixed(1)}
            </Tag>
            <Text type="secondary">{item.description}</Text>
          </Space>
        </Card>
      );
    }

    return (
      <Card size="small" style={{ marginBottom: 8 }}>
        <Row gutter={16} align="middle">
          <Col span={8}>
            {item.oldCrop ? (
              <Image src={item.oldCrop} alt="Old crop" width="100%" style={{ borderRadius: 4 }} fallback="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYwIiBoZWlnaHQ9IjkwIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxNjAiIGhlaWdodD0iOTAiIGZpbGw9IiNmMGYwZjAiLz48dGV4dCB4PSI4MCIgeT0iNDUiIGZpbGw9IiM5OTkiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5PbGQ8L3RleHQ+PC9zdmc+" />
            ) : (
              <div style={{ width: '100%', height: 90, background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4 }}>
                <Text type="secondary">No crop</Text>
              </div>
            )}
            <Text type="secondary" style={{ display: 'block', textAlign: 'center', fontSize: 11 }}>Old</Text>
          </Col>
          <Col span={8}>
            {item.newCrop ? (
              <Image src={item.newCrop} alt="New crop" width="100%" style={{ borderRadius: 4 }} fallback="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYwIiBoZWlnaHQ9IjkwIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxNjAiIGhlaWdodD0iOTAiIGZpbGw9IiNmMGYwZjAiLz48dGV4dCB4PSI4MCIgeT0iNDUiIGZpbGw9IiM5OTkiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5OZXc8L3RleHQ+PC9zdmc+" />
            ) : (
              <div style={{ width: '100%', height: 90, background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4 }}>
                <Text type="secondary">No crop</Text>
              </div>
            )}
            <Text type="secondary" style={{ display: 'block', textAlign: 'center', fontSize: 11 }}>New</Text>
          </Col>
          <Col span={8}>
            <Text strong>{item.clusterName}</Text>
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>{item.description}</Text>
            <br />
            <Text type="secondary" style={{ fontSize: 11 }}>{new Date(item.detectedAt).toLocaleString()}</Text>
          </Col>
        </Row>
      </Card>
    );
  };

  const getCategoryData = (key: string) => {
    if (!delta) return [];
    switch (key) {
      case 'newComponents': return delta.categories.newComponents;
      case 'missingComponents': return delta.categories.missingComponents;
      case 'tokenChanges': return delta.categories.tokenChanges;
      case 'driftScoreChanges': return delta.categories.driftScoreChanges;
      default: return [];
    }
  };

  return (
    <div>
      <PageHeader
        title="Delta / Changelog"
        subtitle={delta ? 'Run ' + delta.runId.slice(0, 8) + '... vs ' + delta.previousRunId.slice(0, 8) + '...' : undefined}
        extra={
          <RunSelector selectedRunId={selectedRunId} onChange={setSelectedRunId} />
        }
      />

      <LoadingSkeleton loading={loading}>
        {!delta ? (
          <Empty description="No delta data available. At least 2 runs are required." />
        ) : (
          <>
            <Alert
              type="info"
              showIcon
              message={'Compared at: ' + new Date(delta.comparedAt).toLocaleString()}
              style={{ marginBottom: 16 }}
            />

            <Tabs
              items={categoryItems.map((cat) => ({
                key: cat.key,
                label: cat.label,
                children: getCategoryData(cat.key).length === 0 ? (
                  <Empty description={No } />
                ) : (
                  <div>
                    {getCategoryData(cat.key).map((item: any, i: number) => (
                      <div key={i}>{renderSideBySide(item, cat.key)}</div>
                    ))}
                  </div>
                ),
              }))}
            />

            <Card title="Human-Readable Changelog" style={{ marginTop: 16 }}>
              <List
                dataSource={delta.changelog}
                renderItem={(entry) => (
                  <List.Item>
                    <List.Item.Meta
                      title={
                        <Space>
                          <Tag color={entry.type === 'added' ? 'green' : entry.type === 'removed' ? 'red' : 'orange'}>
                            {entry.type}
                          </Tag>
                          <Tag>{entry.category}</Tag>
                          {entry.description}
                        </Space>
                      }
                      description={
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {new Date(entry.detectedAt).toLocaleString()} — {entry.route} ({entry.role})
                        </Text>
                      }
                    />
                  </List.Item>
                )}
              />
            </Card>
          </>
        )}
      </LoadingSkeleton>
    </div>
  );
};

export default DeltaChangelogPage;
