import React, { useState, useRef } from 'react';
import { Table, Tag, Card, Descriptions, Button, Typography, Space, Alert } from 'antd';
import { DownloadOutlined, PrinterOutlined } from '@ant-design/icons';
import { useParams } from 'react-router-dom';
import { useSignalReport } from '../hooks';
import { PageHeader, KillCriterionBanner, LoadingSkeleton, EmptyState, RunSelector } from '../components';

const { Text } = Typography;

const SignalReliabilityReportPage: React.FC = () => {
  const { runId: paramId } = useParams<{ runId: string }>();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(paramId || null);
  const { data: report, loading, error } = useSignalReport(selectedRunId);
  const reportRef = useRef<HTMLDivElement>(null);

  const handleExport = () => {
    if (!reportRef.current) return;
    const printContent = reportRef.current.innerHTML;
    const win = window.open('', '_blank');
    if (win) {
      win.document.write('<html><head><title>Signal Reliability Report</title><style>body{font-family:system-ui;padding:40px;}table{width:100%;border-collapse:collapse;}td,th{padding:8px;border:1px solid #ddd;}.yes{color:green;}.no{color:red;}</style></head><body>' + printContent + '</body></html>');
      win.document.close();
      win.print();
    }
  };

  const signalColumns = [
    {
      title: 'Signal Name',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => (
        <Tag color={s === 'YES' ? 'success' : 'error'} style={{ fontWeight: 600, fontSize: 13 }}>
          {s}
        </Tag>
      ),
    },
    {
      title: 'Blocker Tag',
      dataIndex: 'blockerType',
      key: 'blockerType',
      render: (t: string | null) => {
        if (!t) return '-';
        return <Tag color={t === 'blocker' ? 'red' : 'orange'}>{t}</Tag>;
      },
    },
    {
      title: 'Details',
      dataIndex: 'reason',
      key: 'reason',
      render: (r: string | null) => r || 'No issues detected',
    },
  ];

  return (
    <div>
      <PageHeader
        title="Signal Reliability Report"
        subtitle="Phase 0 extraction feasibility assessment"
        extra={
          <Space>
            <RunSelector selectedRunId={selectedRunId} onChange={setSelectedRunId} />
            <Button icon={<DownloadOutlined />} onClick={handleExport} disabled={!report}>
              Export Report
            </Button>
            <Button icon={<PrinterOutlined />} onClick={handleExport} disabled={!report}>
              Print
            </Button>
          </Space>
        }
      />

      <LoadingSkeleton loading={loading}>
        {!report ? (
          <EmptyState message="No signal report available for this run" />
        ) : (
          <div ref={reportRef}>
            <KillCriterionBanner killCriteria={report.killCriteria} />

            <Card title="Report Metadata" style={{ marginBottom: 16 }}>
              <Descriptions column={2} size="small" bordered>
                <Descriptions.Item label="Operator Name">{report.operatorName}</Descriptions.Item>
                <Descriptions.Item label="Operator Role">{report.operatorRole}</Descriptions.Item>
                <Descriptions.Item label="Environment"><Tag>{report.environment}</Tag></Descriptions.Item>
                <Descriptions.Item label="Pilot Route">
                  <Text copyable={{ text: report.pilotRoute }} style={{ fontSize: 13 }}>
                    {report.pilotRoute}
                  </Text>
                </Descriptions.Item>
                <Descriptions.Item label="Run ID">
                  <Text code>{report.runId}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="Generated">
                  {new Date(report.generatedAt).toLocaleString()}
                </Descriptions.Item>
              </Descriptions>
            </Card>

            <Card title="Signal Checks" style={{ marginBottom: 16 }}>
              <Table
                dataSource={report.signals}
                columns={signalColumns}
                rowKey="name"
                pagination={false}
                size="middle"
              />
            </Card>

            <Card title="Phase 0 Metrics">
              <Descriptions column={2} size="small" bordered>
                <Descriptions.Item label="Crawl Duration">{report.metrics.crawlDuration.toFixed(1)}s</Descriptions.Item>
                <Descriptions.Item label="Extraction Duration">{report.metrics.extractionDuration.toFixed(1)}s</Descriptions.Item>
              </Descriptions>
            </Card>
          </div>
        )}
      </LoadingSkeleton>
    </div>
  );
};

export default SignalReliabilityReportPage;
