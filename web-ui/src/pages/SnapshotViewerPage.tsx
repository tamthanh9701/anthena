import React, { useState } from 'react';
import { Image, Tree, Descriptions, Card, Row, Col, Tag, Space, Collapse, Button, Typography, message, Radio, Input, Divider } from 'antd';
import { useParams } from 'react-router-dom';
import * as api from '../api/endpoints';
import { useSnapshot } from '../hooks';
import { PageHeader, ConfidenceBadge, LoadingSkeleton, EmptyState, ErrorState } from '../components';
import type { NodeSummary } from '../types';

const { Text, Title } = Typography;
const { TextArea } = Input;

const SnapshotViewerPage: React.FC = () => {
  const { snapshotId } = useParams<{ snapshotId: string }>();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [feedbackType, setFeedbackType] = useState<'thumbs' | 'text'>('thumbs');
  const [feedbackText, setFeedbackText] = useState('');
  const [thumbsValue, setThumbsValue] = useState<'up' | 'down' | null>(null);

  const { data: snapshot, loading, error, refetch } = useSnapshot(snapshotId || null);

  const selectedNode = snapshot?.nodes?.find((n: NodeSummary) => n.id === selectedNodeId) ?? null;

  const buildTreeData = (nodes: NodeSummary[]) => {
    return nodes.map((node) => ({
      key: node.id,
      title: (
        <Space size={4}>
          <Tag style={{ fontSize: 10, lineHeight: '16px' }}>{node.domTag}</Tag>
          <Text style={{ fontSize: 12 }}>{node.identity?.name || node.nodeIdentifier || node.domTag}</Text>
          <ConfidenceBadge confidence={node.confidence} />
        </Space>
      ),
    }));
  };

  const handleNodeSelect = (selectedKeys: React.Key[]) => {
    setSelectedNodeId(selectedKeys[0] as string);
  };

  const handleSubmitFeedback = async () => {
    if (!snapshotId || !selectedNodeId) return;
    try {
      await api.postSnapshotFeedback(snapshotId, {
        feedbackType: feedbackType,
        feedbackValue: feedbackType === 'thumbs' ? { value: thumbsValue } : { text: feedbackText },
        operatorId: 'designer-1',
        targetId: selectedNodeId,
      });
      message.success('Feedback recorded');
      setThumbsValue(null);
      setFeedbackText('');
    } catch (err: any) {
      message.error(err?.error || 'Failed to record feedback');
    }
  };

  if (error) {
    return <ErrorState message="Failed to load snapshot" onRetry={refetch} />;
  }

  return (
    <div>
      <PageHeader
        title="Snapshot Viewer"
        subtitle={snapshot ? snapshot.url + ' (' + snapshot.role + ')' : undefined}
      />

      <LoadingSkeleton loading={loading}>
        {!snapshot ? (
          <EmptyState message="Select a snapshot to view" />
        ) : (
          <Row gutter={16} style={{ height: 'calc(100vh - 200px)' }}>
            {/* Left: Screenshot */}
            <Col span={16}>
              <Card
                title="Full Page Screenshot"
                size="small"
                style={{ height: '100%', overflow: 'auto' }}
              >
                <Image
                  src={snapshot.screenshotUrl}
                  alt={'Screenshot of ' + snapshot.url}
                  style={{ width: '100%' }}
                  fallback="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAwIiBoZWlnaHQ9IjYwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iODAwIiBoZWlnaHQ9IjYwMCIgZmlsbD0iI2YwZjBmMCIvPjx0ZXh0IHg9IjQwMCIgeT0iMzAwIiBmaWxsPSIjOTk5IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+Tm8gU2NyZWVuc2hvdDwvdGV4dD48L3N2Zz4="
                  preview={{ mask: 'Click to zoom' }}
                />
              </Card>
            </Col>

            {/* Right: Component Tree */}
            <Col span={8}>
              <Card
                title={'Component Tree (' + snapshot.nodeCount + ' nodes)'}
                size="small"
                style={{ height: '100%', overflow: 'auto' }}
              >
                <Tree
                  treeData={buildTreeData(snapshot.nodes || [])}
                  onSelect={handleNodeSelect}
                  selectedKeys={selectedNodeId ? [selectedNodeId] : []}
                  defaultExpandAll={false}
                  height={400}
                />
              </Card>
            </Col>
          </Row>
        )}

        {/* Detail Panel */}
        {selectedNode && (
          <Card title={'Node Detail: ' + (selectedNode.identity?.name || selectedNode.domTag)} style={{ marginTop: 16 }}>
            <Row gutter={24}>
              <Col span={12}>
                <Descriptions column={2} size="small" bordered>
                  <Descriptions.Item label="DOM Tag">{selectedNode.domTag}</Descriptions.Item>
                  <Descriptions.Item label="Node ID">
                    <Text code style={{ fontSize: 11 }}>{selectedNode.id.slice(0, 12)}...</Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="Identity Name">{selectedNode.identity?.name ?? '-'}</Descriptions.Item>
                  <Descriptions.Item label="Identity Source">{selectedNode.identity?.source ?? '-'}</Descriptions.Item>
                  <Descriptions.Item label="Identity Confidence">
                    <ConfidenceBadge confidence={selectedNode.identity?.confidence ?? 0} />
                  </Descriptions.Item>
                  <Descriptions.Item label="Classification Type">
                    <Tag>{selectedNode.classification?.type ?? '-'}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="Classification Source">{selectedNode.classification?.source ?? '-'}</Descriptions.Item>
                  <Descriptions.Item label="Classification Confidence">
                    <ConfidenceBadge confidence={selectedNode.classification?.confidence ?? 0} />
                  </Descriptions.Item>
                  <Descriptions.Item label="Rect (x, y, w, h)">
                    [{selectedNode.rectX}, {selectedNode.rectY}, {selectedNode.rectW}, {selectedNode.rectH}]
                  </Descriptions.Item>
                  <Descriptions.Item label="Drift Score">
                    {selectedNode.driftScore != null ? selectedNode.driftScore.toFixed(2) : '-'}
                  </Descriptions.Item>
                </Descriptions>

                <Collapse items={[
                  {
                    key: 'classes',
                    label: 'Class List',
                    children: <Space wrap>{selectedNode.classList?.map((c: string) => <Tag key={c}>{c}</Tag>)}</Space>,
                  },
                  {
                    key: 'evidence',
                    label: 'Evidence Sources',
                    children: (
                      <Space wrap>
                        {selectedNode.identity?.evidence?.map((e: string) => <Tag key={e} color="blue">{e}</Tag>)}
                      </Space>
                    ),
                  },
                ]} style={{ marginTop: 16 }} />
              </Col>

              <Col span={12}>
                {selectedNode.cropUrl && (
                  <Image
                    src={selectedNode.cropUrl}
                    alt={'Crop of ' + (selectedNode.identity?.name || selectedNode.domTag)}
                    width="100%"
                    style={{ maxHeight: 200, objectFit: 'contain', borderRadius: 4 }}
                  />
                )}

                <Divider>Feedback</Divider>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Radio.Group value={feedbackType} onChange={(e) => setFeedbackType(e.target.value)}>
                    <Radio.Button value="thumbs">Thumbs</Radio.Button>
                    <Radio.Button value="text">Text</Radio.Button>
                  </Radio.Group>

                  {feedbackType === 'thumbs' ? (
                    <Space>
                      <Button
                        type={thumbsValue === 'up' ? 'primary' : 'default'}
                        icon={<span>👍</span>}
                        onClick={() => setThumbsValue('up')}
                      >
                        Correct
                      </Button>
                      <Button
                        type={thumbsValue === 'down' ? 'primary' : 'default'}
                        danger
                        icon={<span>👎</span>}
                        onClick={() => setThumbsValue('down')}
                      >
                        Wrong
                      </Button>
                    </Space>
                  ) : (
                    <TextArea
                      rows={3}
                      value={feedbackText}
                      onChange={(e) => setFeedbackText(e.target.value)}
                      placeholder="Enter your feedback..."
                    />
                  )}

                  <Button
                    type="primary"
                    onClick={handleSubmitFeedback}
                    disabled={feedbackType === 'thumbs' ? !thumbsValue : !feedbackText}
                  >
                    Submit Feedback
                  </Button>
                </Space>
              </Col>
            </Row>
          </Card>
        )}
      </LoadingSkeleton>
    </div>
  );
};

export default SnapshotViewerPage;
