import React, { useState, useCallback } from 'react';
import { Card, Row, Col, Checkbox, Space, Typography, message, Tag, Button, Badge } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { useParams } from 'react-router-dom';
import { useClusters } from '../hooks';
import { PageHeader, RunSelector, CropThumbnail, StepIndicator, ReviewActionBar, LoadingSkeleton, EmptyState } from '../components';
import type { ReviewStep } from '../components';

const { Text } = Typography;

const ClusterReviewPage: React.FC = () => {
  const { runId: paramId } = useParams<{ runId: string }>();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(paramId || null);
  const [checkedClusters, setCheckedClusters] = useState<Set<string>>(new Set());
  const [inspectedClusters, setInspectedClusters] = useState<Set<string>>(new Set());
  const [reviewStep] = useState<ReviewStep>('human-sample');

  const { clusters, loading, updateCluster, batchReview, refetch } = useClusters(selectedRunId);

  const toggleCheck = useCallback((clusterId: string) => {
    setCheckedClusters((prev) => {
      const next = new Set(prev);
      if (next.has(clusterId)) next.delete(clusterId);
      else next.add(clusterId);
      return next;
    });
  }, []);

  const handleInspect = useCallback((clusterId: string) => {
    setInspectedClusters((prev) => new Set(prev).add(clusterId));
  }, []);

  const handleAction = useCallback(async (clusterId: string, action: 'approve' | 'reject' | 'defer', note?: string) => {
    try {
      await updateCluster.mutateAsync({ clusterId, data: { action, note } });
message.success('Cluster ' + action + 'd successfully');
      refetch();
    } catch (err: any) {
      message.error(err?.error || 'Failed to ' + action + ' cluster');
    }
  }, [updateCluster, refetch]);

  const handleBatchAction = useCallback(async (action: 'approve' | 'reject') => {
    const clusterIds = Array.from(checkedClusters);
    try {
      await batchReview.mutateAsync({ runId: selectedRunId!, data: { clusterIds, action } });
message.success(clusterIds.length + ' clusters ' + action + 'd');
      setCheckedClusters(new Set());
      refetch();
    } catch (err: any) {
      message.error(err?.error || 'Batch ' + action + ' failed');
    }
  }, [checkedClusters, batchReview, selectedRunId, refetch]);

  const allInspected = clusters.every((c) => inspectedClusters.has(c.clusterId));

  return (
    <div>
      <PageHeader
        title="Cluster Review"
        subtitle={selectedRunId ? 'Run: ' + selectedRunId.slice(0, 8) + '...' : undefined}
        extra={
          <RunSelector
            selectedRunId={selectedRunId}
            onChange={setSelectedRunId}
          />
        }
      />

      <StepIndicator currentStep={reviewStep} />

      <LoadingSkeleton loading={loading}>
        {clusters.length === 0 ? (
          <EmptyState message="No clusters available for review." />
        ) : (
          <>
            <Row gutter={[16, 16]}>
              {clusters.map((cluster) => (
                <Col key={cluster.clusterId} xs={24} sm={12} lg={8}>
                  <Card
                    size="small"
                    title={
                      <Space>
                        <Checkbox
                          checked={checkedClusters.has(cluster.clusterId)}
                          onChange={() => toggleCheck(cluster.clusterId)}
                        />
                        <Text strong style={{ fontSize: 13 }}>{cluster.name}</Text>
                        <Badge count={cluster.usageCount} style={{ backgroundColor: '#1677ff' }} />
                      </Space>
                    }
                    extra={
                      <Tag color={
                        cluster.driftClassification === 'antd-aligned' ? 'green' :
                        cluster.driftClassification === 'drifted' ? 'orange' : 'red'
                      }>
                        {cluster.driftClassification || 'N/A'}
                      </Tag>
                    }
                  >
                    <Space direction="vertical" style={{ width: '100%' }} size={4}>
                      <CropThumbnail
                        cropUrl={cluster.representativeCrop ?? undefined}
                        alt={cluster.name}
                        size={100}
                        style={{ width: '100%', height: 100, objectFit: 'cover', borderRadius: 4 }}
                      />
                      {cluster.confidenceDistribution && (
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          Confidence: min {cluster.confidenceDistribution.min.toFixed(2)}
                          {' / '}max {cluster.confidenceDistribution.max.toFixed(2)}
                          {' / '}avg {cluster.confidenceDistribution.avg.toFixed(2)}
                        </Text>
                      )}
                      {cluster.driftScore != null && (
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          Drift Score: {cluster.driftScore.toFixed(2)}
                        </Text>
                      )}

                      <Button
                        size="small"
                        type="link"
                        onClick={() => handleInspect(cluster.clusterId)}
                      >
                        {inspectedClusters.has(cluster.clusterId) ? '✓ Inspected' : 'Click to Inspect'}
                      </Button>

                      <div style={{ marginTop: 4 }}>
                        <ReviewActionBar
                          onApprove={(note) => handleAction(cluster.clusterId, 'approve', note)}
                          onReject={(note) => handleAction(cluster.clusterId, 'reject', note)}
                          onDefer={(note) => handleAction(cluster.clusterId, 'defer', note)}
                          loading={updateCluster.isPending}
                        />
                      </div>
                    </Space>
                  </Card>
                </Col>
              ))}
            </Row>

            {checkedClusters.size > 0 && (
              <Card
                style={{
                  position: 'sticky',
                  bottom: 0,
                  marginTop: 16,
                  boxShadow: '0 -4px 12px rgba(0,0,0,0.1)',
                }}
              >
                <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                  <Text>{checkedClusters.size} of {clusters.length} clusters selected</Text>
                  <Space>
                    <Button
                      type="primary"
                      icon={<CheckCircleOutlined />}
                      onClick={() => handleBatchAction('approve')}
                      disabled={!allInspected}
                      loading={batchReview.isPending}
                    >
                      Approve Selected
                    </Button>
                    <Button
                      danger
                      icon={<CloseCircleOutlined />}
                      onClick={() => handleBatchAction('reject')}
                      loading={batchReview.isPending}
                    >
                      Reject Selected
                    </Button>
                  </Space>
                </Space>
                {!allInspected && (
                  <Text type="warning" style={{ display: 'block', marginTop: 4 }}>
                    Inspect at least one item per cluster before batch approval
                  </Text>
                )}
              </Card>
            )}
          </>
        )}
      </LoadingSkeleton>
    </div>
  );
};

export default ClusterReviewPage;
