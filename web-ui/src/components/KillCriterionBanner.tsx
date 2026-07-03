import React from 'react';
import { Alert } from 'antd';
import type { KillCriterion } from '../types';

interface KillCriterionBannerProps {
  killCriteria: KillCriterion[];
}

const KillCriterionBanner: React.FC<KillCriterionBannerProps> = ({ killCriteria }) => {
  const triggered = killCriteria.filter((kc) => kc.triggered);

  if (triggered.length === 0) return null;

  return (
    <div style={{ marginBottom: 16 }}>
      {triggered.map((kc) => (
        <Alert
          key={kc.id}
          type="error"
          showIcon
          message={`⚠️ Kill Criterion ${kc.id} triggered`}
          description={kc.description}
          style={{ marginBottom: 8 }}
          banner
        />
      ))}
    </div>
  );
};

export default KillCriterionBanner;