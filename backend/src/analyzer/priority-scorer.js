'use strict';

/**
 * Priority scorer: priorityScore = usageCount × driftScore.
 * Refined formula with weights.
 */

function calculatePriorityScore(usageCount, driftScore, weights = {}) {
  if (usageCount == null || usageCount < 0) usageCount = 0;
  if (driftScore == null) driftScore = 0;
  
  // Phase 0 base formula: usageCount × driftScore
  let score = usageCount * driftScore;
  
  // Apply refined weights if provided (BR-002)
  const visualSeverityWeight = weights.visualSeverityWeight ?? 1.0;
  const brandTokenWeight = weights.brandTokenWeight ?? 1.0;
  const formCriticalityWeight = weights.formCriticalityWeight ?? 1.0;
  const roleExposureWeight = weights.roleExposureWeight ?? 1.0;
  const knownExceptionWeight = weights.knownExceptionWeight ?? 0;
  
  score = score * visualSeverityWeight * brandTokenWeight * formCriticalityWeight * roleExposureWeight + knownExceptionWeight;
  
  return Math.max(0, Math.round(score * 100) / 100);
}

function calculateClusterPriority(cluster) {
  const usageCount = cluster.usageCount || 0;
  const driftScore = cluster.driftScore || 0;
  
  return calculatePriorityScore(usageCount, driftScore);
}

module.exports = { calculatePriorityScore, calculateClusterPriority };