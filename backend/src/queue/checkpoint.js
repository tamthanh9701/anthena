'use strict';

/**
 * Checkpoint manager for per-route resume support.
 * Persisted in the runs.processedRoutes JSON field.
 */

function addProcessedRoute(processedRoutes, route, role, status, error = null, retryCount = 0) {
  const routes = Array.isArray(processedRoutes) ? [...processedRoutes] : [];
  
  // Check if this route+role combo already exists
  const existingIndex = routes.findIndex(r => r.route === route && r.role === role);
  
  const entry = { route, role, status, retryCount, error, processedAt: new Date().toISOString() };
  
  if (existingIndex >= 0) {
    routes[existingIndex] = { ...routes[existingIndex], ...entry };
  } else {
    routes.push(entry);
  }
  
  return routes;
}

function getRemainingRoutes(allRoutes, allRoles, processedRoutes) {
  const processed = Array.isArray(processedRoutes) ? processedRoutes : [];
  const remaining = [];
  
  for (const role of allRoles) {
    const roleRoutes = allRoutes;
    for (const route of roleRoutes) {
      const done = processed.find(r => r.route === route && r.role === role && r.status === 'completed');
      if (!done) {
        remaining.push({ route, role });
      }
    }
  }
  
  return remaining;
}

function getCheckpointSummary(processedRoutes) {
  const routes = Array.isArray(processedRoutes) ? processedRoutes : [];
  const completed = routes.filter(r => r.status === 'completed').length;
  const failed = routes.filter(r => r.status === 'failed').length;
  const total = routes.length;
  
  return { completed, failed, total, processedRoutes: routes };
}

module.exports = { addProcessedRoute, getRemainingRoutes, getCheckpointSummary };