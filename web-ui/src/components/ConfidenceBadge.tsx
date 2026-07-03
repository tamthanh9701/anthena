import React from 'react';
import { Tag } from 'antd';

interface ConfidenceBadgeProps {
  confidence: number;
}

const ConfidenceBadge: React.FC<ConfidenceBadgeProps> = ({ confidence }) => {
  let color: string;
  if (confidence >= 0.8) color = 'green';
  else if (confidence >= 0.6) color = 'blue';
  else if (confidence >= 0.4) color = 'orange';
  else color = 'red';

  return <Tag color={color}>{Math.round(confidence * 100)}%</Tag>;
};

export default ConfidenceBadge;