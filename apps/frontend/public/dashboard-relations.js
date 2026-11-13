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

  root.AgentPierDashboard = { linkedRepositories, confirmedInstructions, setInstructionText };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.AgentPierDashboard;
  }
})(typeof window === 'undefined' ? globalThis : window);
