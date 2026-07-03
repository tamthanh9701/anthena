import React, { useState, useEffect } from 'react';
import {
  Card, Form, Input, InputNumber, Select, Button, Checkbox,
  message, Descriptions, Tag, Space, Alert, Typography, Divider,
} from 'antd';
import { SaveOutlined, CheckCircleOutlined, LockOutlined } from '@ant-design/icons';
import { useContract } from '../hooks';
import type { PilotContractInput } from '../types';

const { Text } = Typography;

const defaultInsightItems = [
  'Identify components that diverge from Ant Design defaults',
  'Map detected components back to design tokens',
  'Highlight reused vs single-use component patterns',
  'Flag components with low confidence classification',
];

const defaultPhase0DoDItems = [
  'Signal reliability report generated for at least 1 route',
  'Extraction signals categorized as YES/NO with blocker tags',
  'At least 1 snapshot reviewed by designer',
  'Crawl and extraction durations within acceptable bounds',
];

const defaultPilotDoDItems = [
  'All routes crawled successfully',
  'Token inventory generated',
  'Component inventory generated',
  'Drift report reviewed by designer',
  'Priority findings accepted or adjusted',
];

const isAbsoluteUrl = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

const PilotContractPage: React.FC = () => {
  const { contract, isSigned, status, saveDraft, cosign } = useContract();
  const [form] = Form.useForm();
  const [cosigning, setCosigning] = useState(false);

  useEffect(() => {
    if (contract) {
      form.setFieldsValue({
        operatorName: contract.operatorName,
        operatorRole: contract.operatorRole,
        environment: contract.environment,
        routeList: contract.routeList,
        reviewBudgetMinutes: contract.reviewBudgetMinutes,
        maxCandidates: contract.maxCandidates,
        reviewMode: contract.reviewMode,
        definitionOfInsight: contract.definitionOfInsight,
        phase0DoD: contract.phase0DoD,
        pilotDoD: contract.pilotDoD,
        topN: contract.topN,
      });
    }
  }, [contract, form]);

  const handleSaveDraft = async () => {
    try {
      const values = await form.validateFields();
      await saveDraft.mutateAsync(values as PilotContractInput);
      message.success('Draft saved successfully');
    } catch (err: any) {
      if (err?.errorFields) return; // validation errors shown by form
      message.error(err?.error || 'Failed to save draft');
    }
  };

  const handleCoSign = async () => {
    try {
      const values = await form.validateFields();
      setCosigning(true);
      await cosign.mutateAsync({
        operatorName: values.operatorName,
        operatorRole: values.operatorRole,
      });
      message.success('Contract co-signed successfully!');
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(err?.error || 'Failed to co-sign contract');
    } finally {
      setCosigning(false);
    }
  };

  if (isSigned && contract) {
    return (
      <div>
        <Alert
          type="success"
          showIcon
          icon={<CheckCircleOutlined />}
          message="Pilot Contract is Co-Signed"
          description={'Signed by ' + contract.cosignedBy + ' at ' + new Date(contract.cosignedAt!).toLocaleString()}
          style={{ marginBottom: 24 }}
        />
        <Card title="Operator Info">
          <Descriptions column={2}>
            <Descriptions.Item label="Operator Name">{contract.operatorName}</Descriptions.Item>
            <Descriptions.Item label="Operator Role">{contract.operatorRole}</Descriptions.Item>
            <Descriptions.Item label="Environment"><Tag>{contract.environment}</Tag></Descriptions.Item>
            <Descriptions.Item label="Version">v{contract.version}</Descriptions.Item>
          </Descriptions>
        </Card>
        <Card title="Route List" style={{ marginTop: 16 }}>
          {contract.routeList.map((url, i) => (
            <div key={i}><Text code>{url}</Text></div>
          ))}
        </Card>
        <Card title="Review Budget" style={{ marginTop: 16 }}>
          <Descriptions column={3}>
            <Descriptions.Item label="Minutes per Run">{contract.reviewBudgetMinutes}</Descriptions.Item>
            <Descriptions.Item label="Max Candidates">{contract.maxCandidates}</Descriptions.Item>
            <Descriptions.Item label="Review Mode"><Tag>{contract.reviewMode}</Tag></Descriptions.Item>
            <Descriptions.Item label="Top N Findings">{contract.topN}</Descriptions.Item>
          </Descriptions>
        </Card>
        <Card title="Definition of Insight" style={{ marginTop: 16 }}>
          {contract.definitionOfInsight.map((item, i) => (
            <div key={i}><Text>• {item}</Text></div>
          ))}
        </Card>
        <Card title="Phase 0 DoD" style={{ marginTop: 16 }}>
          {contract.phase0DoD.map((item, i) => (
            <div key={i}><Text>• {item}</Text></div>
          ))}
        </Card>
        <Card title="Pilot DoD" style={{ marginTop: 16 }}>
          {contract.pilotDoD.map((item, i) => (
            <div key={i}><Text>• {item}</Text></div>
          ))}
        </Card>
      </div>
    );
  }

  return (
    <div>
      <Typography.Title level={3}>Pilot Contract</Typography.Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
        Co-sign required before Phase 1 operations. Fill all required fields.
      </Text>

      <Form form={form} layout="vertical" initialValues={{ routeList: [''], topN: 30, reviewMode: 'component-cluster' }}>
        {/* Operator Info */}
        <Card title="Operator Info" style={{ marginBottom: 16 }}>
          <Space style={{ width: '100%' }} size="large">
            <Form.Item name="operatorName" label="Operator Name" rules={[{ required: true, message: 'Required' }]} style={{ flex: 1 }}>
              <Input placeholder="e.g., Jane Doe" />
            </Form.Item>
            <Form.Item name="operatorRole" label="Operator Role" rules={[{ required: true, message: 'Required' }]} style={{ flex: 1 }}>
              <Input placeholder="e.g., Design Lead" />
            </Form.Item>
            <Form.Item name="environment" label="Environment" rules={[{ required: true, message: 'Required' }]} style={{ flex: 1 }}>
              <Select options={[{ value: 'dev', label: 'dev' }, { value: 'staging', label: 'staging' }]} />
            </Form.Item>
          </Space>
        </Card>

        {/* Route List */}
        <Card title="Route List (5–10 absolute URLs)" style={{ marginBottom: 16 }}>
          <Form.List
            name="routeList"
            rules={[
              { validator: async (_, urls) => {
                const valid = urls?.filter(Boolean) || [];
                if (valid.length < 5) throw new Error('At least 5 routes required');
                if (valid.length > 10) throw new Error('At most 10 routes allowed');
                for (const url of valid) {
                  if (!isAbsoluteUrl(url)) throw new Error('"' + url + '" is not an absolute URL');
                }
              }}
            ]}
          >
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name, ...rest }) => (
                  <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                    <Form.Item {...rest} name={name} rules={[
                      { required: true, message: 'Required' },
                      { pattern: /^https?:\/\/.+/, message: 'Must be absolute URL' },
                    ]} style={{ width: 400, marginBottom: 0 }}>
                      <Input placeholder="https://staging.example.com/..." />
                    </Form.Item>
                    {fields.length > 1 && <Button type="text" danger onClick={() => remove(name)}>Remove</Button>}
                  </Space>
                ))}
                {fields.length < 10 && (
                  <Button type="dashed" onClick={() => add('')} style={{ width: '100%' }}>
                    + Add Route
                  </Button>
                )}
              </>
            )}
          </Form.List>
        </Card>

        {/* Review Budget */}
        <Card title="Review Budget" style={{ marginBottom: 16 }}>
          <Space size="large" style={{ width: '100%' }}>
            <Form.Item name="reviewBudgetMinutes" label="Minutes per Run" rules={[{ required: true, message: 'Required' }]}>
              <InputNumber min={1} max={480} style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="maxCandidates" label="Max Candidates" rules={[{ required: true, message: 'Required' }]}>
              <InputNumber min={1} max={200} style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="reviewMode" label="Review Mode" rules={[{ required: true, message: 'Required' }]}>
              <Select style={{ width: 200 }}
                options={[
                  { value: 'screen', label: 'Screen' },
                  { value: 'component-cluster', label: 'Component Cluster' },
                  { value: 'token-group', label: 'Token Group' },
                  { value: 'drift-severity', label: 'Drift Severity' },
                ]}
              />
            </Form.Item>
            <Form.Item name="topN" label="Top N Findings">
              <InputNumber min={1} max={200} defaultValue={30} style={{ width: 100 }} />
            </Form.Item>
          </Space>
        </Card>

        {/* Checklists */}
        <Card title="Definition of Insight" style={{ marginBottom: 16 }}>
          <Form.Item name="definitionOfInsight" rules={[{
            validator: (_, value) => !value?.length ? Promise.reject('At least 1 item') : Promise.resolve(),
          }]}>
            <Checkbox.Group>
              <Space direction="vertical">
                {defaultInsightItems.map((item) => (
                  <Checkbox key={item} value={item}>{item}</Checkbox>
                ))}
              </Space>
            </Checkbox.Group>
          </Form.Item>
        </Card>

        <Card title="Phase 0 DoD" style={{ marginBottom: 16 }}>
          <Form.Item name="phase0DoD" rules={[{
            validator: (_, value) => !value?.length ? Promise.reject('At least 1 item') : Promise.resolve(),
          }]}>
            <Checkbox.Group>
              <Space direction="vertical">
                {defaultPhase0DoDItems.map((item) => (
                  <Checkbox key={item} value={item}>{item}</Checkbox>
                ))}
              </Space>
            </Checkbox.Group>
          </Form.Item>
        </Card>

        <Card title="Pilot DoD" style={{ marginBottom: 16 }}>
          <Form.Item name="pilotDoD" rules={[{
            validator: (_, value) => !value?.length ? Promise.reject('At least 1 item') : Promise.resolve(),
          }]}>
            <Checkbox.Group>
              <Space direction="vertical">
                {defaultPilotDoDItems.map((item) => (
                  <Checkbox key={item} value={item}>{item}</Checkbox>
                ))}
              </Space>
            </Checkbox.Group>
          </Form.Item>
        </Card>

        <Divider />

        <Space size="large">
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSaveDraft} loading={saveDraft.isPending}>
            Save Draft
          </Button>
          <Button
            type="primary"
            size="large"
            icon={<CheckCircleOutlined />}
            onClick={handleCoSign}
            loading={cosigning}
          >
            Co-Sign Contract
          </Button>
        </Space>
      </Form>
    </div>
  );
};

export default PilotContractPage;
