import React from 'react';
import { Typography, Space, Button } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  extra?: React.ReactNode;
}

const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, onBack, extra }) => {
  return (
    <div style={{ marginBottom: 24 }}>
      <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
        <Space>
          {onBack && (
            <Button icon={<ArrowLeftOutlined />} type="text" onClick={onBack} />
          )}
          <div>
            <Title level={3} style={{ margin: 0 }}>{title}</Title>
            {subtitle && <Text type="secondary">{subtitle}</Text>}
          </div>
        </Space>
        {extra && <Space>{extra}</Space>}
      </Space>
    </div>
  );
};

export default PageHeader;