import React, { useState } from 'react';
import { Layout, Menu, Badge, Button, Dropdown, Space, Typography, theme } from 'antd';
import {
  FileTextOutlined,
  PlayCircleOutlined,
  DashboardOutlined,
  CameraOutlined,
  RocketOutlined,
  ClusterOutlined,
  CheckCircleOutlined,
  DiffOutlined,
  SettingOutlined,
  AlertOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useContract, useRuns } from '../hooks';
import type { CreateRunRequest } from '../types';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const sidebarItems = [
  { key: '/pilot-contract', icon: <FileTextOutlined />, label: 'Pilot Contract' },
  { key: '/runs', icon: <PlayCircleOutlined />, label: 'Run Manager' },
  { key: '/run-summary', icon: <DashboardOutlined />, label: 'Run Summary' },
  { key: '/config', icon: <SettingOutlined />, label: 'Config' },
  { type: 'divider' as const },
  { key: '/priority-findings', icon: <RocketOutlined />, label: 'Findings' },
  { key: '/cluster-review', icon: <ClusterOutlined />, label: 'Cluster Review' },
  { key: '/approve-queue', icon: <CheckCircleOutlined />, label: 'Approve Queue' },
  { key: '/snapshot-viewer', icon: <CameraOutlined />, label: 'Snapshot' },
  { key: '/delta', icon: <DiffOutlined />, label: 'Delta' },
  { key: '/signal-report', icon: <AlertOutlined />, label: 'Signal Report' },
];

const AppLayout: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { isSigned } = useContract();
  const { createRun } = useRuns();
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  const selectedKey = '/' + location.pathname.split('/').filter(Boolean)[0] || '/run-summary';

  const handleMenuClick = (info: { key: string }) => {
    navigate(info.key);
  };

  const handleNewRun = async (mode: CreateRunRequest['mode']) => {
    try {
      await createRun.mutateAsync({ mode });
    } catch (err) {
      console.error('Failed to create run:', err);
    }
  };

  const newRunItems = [
    { key: 'all', label: 'Re-crawl all routes', icon: <ReloadOutlined />, onClick: () => handleNewRun('all') },
    { key: 'route', label: 'Re-crawl specific route', icon: <PlayCircleOutlined />, onClick: () => handleNewRun('route') },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        breakpoint="lg"
        style={{ overflow: 'auto', height: '100vh', position: 'fixed', left: 0, top: 0, bottom: 0 }}
      >
        <div style={{ height: 32, margin: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {!collapsed && <Text strong style={{ color: '#fff', fontSize: 16 }}>RDSP</Text>}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={sidebarItems}
          onClick={handleMenuClick}
        />
      </Sider>
      <Layout style={{ marginLeft: collapsed ? 80 : 200, transition: 'margin-left 0.2s' }}>
        <Header
          style={{
            padding: '0 24px',
            background: colorBgContainer,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #f0f0f0',
            position: 'sticky',
            top: 0,
            zIndex: 100,
          }}
        >
          <Space>
            {React.createElement(collapsed ? MenuUnfoldOutlined : MenuFoldOutlined, {
              style: { fontSize: 18, cursor: 'pointer' },
              onClick: () => setCollapsed(!collapsed),
            })}
            <Badge status={isSigned ? 'success' : 'warning'} text={isSigned ? 'Contract Signed' : 'Contract Required'} />
          </Space>
          <Space>
            {isSigned && (
              <Dropdown menu={{ items: newRunItems }} trigger={['click']}>
                <Button type="primary" icon={<PlusOutlined />} loading={createRun.isPending}>
                  New Run
                </Button>
              </Dropdown>
            )}
          </Space>
        </Header>
        <Content style={{ margin: 24, minHeight: 280 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};

export default AppLayout;