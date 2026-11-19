(function (root) {
  function linkedRepositories(app, repositories) {
    const explicitRepositoryId = app.data && app.data.repositoryId;
    if (explicitRepositoryId) {
      return repositories.filter((repository) => repository.id === explicitRepositoryId);
    }

    return repositories.filter(
      (repository) =>
        repository.data.applicationId === app.id ||
        repository.data.applicationName === (app.name || app.data.name) ||
        (repository.data.path && repository.data.path === app.data.path),
    );
  }

  function confirmedInstructions(project, instructions) {
    return instructions.filter(
      (instruction) => instruction.projectId === project.id && instruction.data && instruction.data.status === 'confirmed',
    );
  }

  function setInstructionText(element, instruction) {
    element.textContent = instruction.data.content || instruction.data.instruction || JSON.stringify(instruction.data, null, 2);
  }

  function activeSessionsForAgent(sessions, role, canonicalProfile) {
    return sessions.filter(
      (session) =>
        canonicalProfile(session.data.profile) === role &&
        ['running', 'starting', 'waiting_for_user'].includes(session.data.status),
    );
  }

  root.AgentPierDashboard = { linkedRepositories, confirmedInstructions, setInstructionText, activeSessionsForAgent };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.AgentPierDashboard;
  }
})(typeof window === 'undefined' ? globalThis : window);
