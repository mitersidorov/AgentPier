const test = require('node:test');
const assert = require('node:assert/strict');
const { linkedRepositories, confirmedInstructions, setInstructionText } = require('../public/dashboard-relations.js');
const {
  createDashboardLoadState,
  markDashboardLoadSuccess,
  markDashboardLoadFailure,
  getDashboardFailurePresentation,
} = require('../public/dashboard-load-state.js');

test('shows unavailable with unknown counts when the initial refresh fails', () => {
  const state = markDashboardLoadFailure(createDashboardLoadState());
  assert.deepEqual(getDashboardFailurePresentation(state, 0, 0), {
    phase: 'unavailable',
    projectCount: '—',
    agentCount: '—',
  });
});

test('shows stale counts after a snapshot failure without discarding the snapshot', () => {
  const snapshot = { projects: [{ id: 'project-1' }], agents: [{ role: 'frontend-angular' }] };
  const state = markDashboardLoadFailure(markDashboardLoadSuccess(createDashboardLoadState()));

  assert.equal(state.phase, 'stale');
  assert.equal(snapshot.projects.length, 1);
  assert.equal(snapshot.agents.length, 1);
  assert.deepEqual(getDashboardFailurePresentation(state, snapshot.projects.length, snapshot.agents.length), {
    phase: 'stale',
    projectCount: '1 · stale',
    agentCount: '1 · stale',
  });
});

test('recovers to ready after a failed refresh and a subsequent successful refresh', () => {
  const failed = markDashboardLoadFailure(createDashboardLoadState());
  const recovered = markDashboardLoadSuccess(failed);
  assert.deepEqual(recovered, { hasSnapshot: true, phase: 'ready' });
});

test('links an application to its explicitly selected repository id', () => {
  const application = { id: 'app-1', name: 'Manager', data: { repositoryId: 'repo-2', path: '/same' } };
  const repositories = [
    { id: 'repo-1', data: { applicationName: 'Manager', path: '/same' } },
    { id: 'repo-2', data: { name: 'AgentPier', path: '/checkout' } },
  ];

  assert.deepEqual(linkedRepositories(application, repositories), [repositories[1]]);
});

test('returns every confirmed instruction for the selected project only', () => {
  const project = { id: 'project-1' };
  const confirmed = [
    { id: 'one', projectId: 'project-1', data: { status: 'confirmed' } },
    { id: 'two', projectId: 'project-1', data: { status: 'confirmed' } },
  ];
  const instructions = [...confirmed,
    { id: 'draft', projectId: 'project-1', data: { status: 'draft' } },
    { id: 'other-project', projectId: 'project-2', data: { status: 'confirmed' } },
  ];

  assert.deepEqual(confirmedInstructions(project, instructions), confirmed);
});

test('displays instruction content as text rather than interpreting markup', () => {
  const content = '<img src=x onerror=alert(1)>';
  const element = { textContent: '', data: null };
  const instruction = { data: { content } };
  setInstructionText(element, instruction);

  assert.equal(element.textContent, content);
  assert.equal(Object.hasOwn(element, 'innerHTML'), false);
});

test('uses legacy application fields when an explicit repository id is absent', () => {
  const application = { id: 'app-1', name: 'Manager', data: { path: '/same' } };
  const repository = { id: 'repo-1', data: { applicationId: 'app-1' } };

  assert.deepEqual(linkedRepositories(application, [repository]), [repository]);
});
