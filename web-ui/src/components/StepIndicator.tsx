import React from 'react';
import { Steps } from 'antd';
import { CheckCircleFilled, LoadingOutlined, EllipsisOutlined } from '@ant-design/icons';

export type ReviewStep = 'auto-stage' | 'human-sample' | 'approve-batch' | 'sync';

interface StepIndicatorProps {
  currentStep: ReviewStep;
  steps?: { key: ReviewStep; label: string }[];
}

const defaultSteps: { key: ReviewStep; label: string }[] = [
  { key: 'auto-stage', label: 'Auto-Stage' },
  { key: 'human-sample', label: 'Human Sample' },
  { key: 'approve-batch', label: 'Approve Batch' },
  { key: 'sync', label: 'Sync' },
];

const stepIndex: Record<ReviewStep, number> = {
  'auto-stage': 0,
  'human-sample': 1,
  'approve-batch': 2,
  sync: 3,
};

const StepIndicator: React.FC<StepIndicatorProps> = ({ currentStep, steps = defaultSteps }) => {
  const current = stepIndex[currentStep] ?? 0;

  return (
    <div style={{ marginBottom: 24 }}>
      <Steps
        current={current}
        items={steps.map((s, i) => ({
          title: s.label,
          status: i < current ? 'finish' : i === current ? 'process' : 'wait',
          icon: i < current ? <CheckCircleFilled /> : i === current ? <LoadingOutlined /> : <EllipsisOutlined />,
        }))}
      />
    </div>
  );
};

export default StepIndicator;