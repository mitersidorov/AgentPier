(function (root) {
  function createDashboardLoadState() {
    return { hasSnapshot: false, phase: 'loading' };
  }

  function markDashboardLoadSuccess(state) {
    return { hasSnapshot: true, phase: 'ready' };
  }

  function markDashboardLoadFailure(state) {
    return { hasSnapshot: state.hasSnapshot, phase: state.hasSnapshot ? 'stale' : 'unavailable' };
  }

  function getDashboardFailurePresentation(state, projectCount, agentCount) {
    if (state.phase === 'stale') {
      return { phase: 'stale', projectCount: `${projectCount} · stale`, agentCount: `${agentCount} · stale` };
    }
    return { phase: 'unavailable', projectCount: '—', agentCount: '—' };
  }

  const api = {
    createDashboardLoadState,
    markDashboardLoadSuccess,
    markDashboardLoadFailure,
    getDashboardFailurePresentation,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DashboardLoadState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
