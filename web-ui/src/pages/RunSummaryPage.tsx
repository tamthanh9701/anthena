import React, { useState } from 'react';
import { Card, Row, Col, Statistic, Table, List, Button, Tag, Typography, Descriptions } from 'antd';
import { Link, useParams } from 'react-router-dom';
import { useRunSummary } from '../hooks';
import { PageHeader, RunSelector, StatusTag, LoadingSkeleton, EmptyState } from '../components';

const { Text } = Typography;

const RunSummaryPage: React.FC = () => {
  const { runId: paramId } = useParams<{ runId: string }>();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(paramId || null);
  const { data: summary, isLoading: loading } = useRunSummary(selectedRunId);

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return Math.round(seconds) + 's';
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return m + 'm ' + s + 's';
  };

  const routeColumns = [
    { title: 'URL', dataIndex: 'url', key: 'url', ellipsis: true, render: (u: string) => {
      const short = u.split('/').pop() || u;
      return <Text copyable={{ text: u }}>{short}</Text>;
    }},
    { title: 'Role', dataIndex: 'role', key: 'role', render: (r: string) => <Tag>{r}</Tag> },
    { title: 'Status', dataIndex: 'status', key: 'status', render: (s: string) => <StatusTag status={s as any} /> },
    { title: 'Nodes', dataIndex: 'nodeCount', key: 'nodeCount', sorter: (a: any, b: any) => a.nodeCount - b.nodeCount },
    { title: 'Clusters', dataIndex: 'clusterCount', key: 'clusterCount' },
    { title: 'Drift', dataIndex: 'driftScore', key: 'driftScore', render: (v: number | null) => v != null ? v.toFixed(2) : '-' },
  ];

  return (
    <div>
      <PageHeader
        title="Run Summary"
        subtitle={selectedRunId ? 'Run: ' + selectedRunId.slice(0, 8) + '...' : undefined}
        extra={
          <RunSelector
            selectedRunId={selectedRunId}
            onChange={setSelectedRunId}
            status="completed"
          />
        }
      />

      <LoadingSkeleton loading={loading}>
        {!summary ? (
          <EmptyState message="Select a completed run to view summary" />
        ) : (
          <>
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col span={6}>
                <Card><Statistic title="Routes Crawled" value={summary.metrics.routesCrawled} suffix={'/ ' + summary.routes.length} /></Card>
              </Col>
              <Col span={6}>
                <Card><Statistic title="Total Nodes" value={summary.metrics.totalNodes} /></Card>
              </Col>
              <Col span={6}>
                <Card><Statistic title="Total Clusters" value={summary.metrics.totalClusters} /></Card>
              </Col>
              <Col span={6}>
                <Card><Statistic title="Top Drift Score" value={summary.metrics.topDriftScore ?? 0} precision={2} /></Card>
              </Col>
            </Row>

            <Card title="Timing" style={{ marginBottom: 16 }}>
              <Descriptions column={3} size="small">
                <Descriptions.Item label="Crawl Duration">{formatDuration(summary.metrics.crawlDuration)}</Descriptions.Item>
                <Descriptions.Item label="Extraction Duration">{formatDuration(summary.metrics.extractionDuration)}</Descriptions.Item>
                <Descriptions.Item label="Analysis Duration">{formatDuration(summary.metrics.analysisDuration)}</Descriptions.Item>
              </Descriptions>
            </Card>

            {summary.topFindings.length > 0 && (
              <Card
                title="Top 3 Priority Findings"
                style={{ marginBottom: 16 }}
                extra={<Link to={'/priority-findings/' + selectedRunId}>View All Findings &rarr;</Link>}
              >
                <List
                  dataSource={summary.topFindings}
                  renderItem={(item: any) => (
                    <List.Item>
                      <List.Item.Meta
                        title={item.clusterName}
                        description={'Priority Score: ' + item.priorityScore.toFixed(1)}
                      />
                    </List.Item>
                  )}
                />
              </Card>
            )}

            <Card title="Per-Route Breakdown" style={{ marginBottom: 16 }}>
              <Table
                dataSource={summary.routes}
                columns={routeColumns}
                rowKey={(r: any) => r.url + r.role}
                size="small"
                pagination={false}
              />
            </Card>

            {summary.reportFiles.length > 0 && (
              <Card title="Phase 3 Report Files">
                <Row gutter={16}>
                  {summary.reportFiles.map((file: string) => (
                    <Col key={file}>
                      <Button type="link" href={file} target="_blank">{(file.split('/').pop())}</Button>
                    </Col>
                  ))}
                </Row>
              </Card>
            )}
          </>
        )}
      </LoadingSkeleton>
    </div>
  );
};

export default RunSummaryPage;