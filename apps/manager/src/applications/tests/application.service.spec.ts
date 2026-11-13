import { BadRequestException } from '@nestjs/common';
import { ApplicationService } from '../services/application.service';

describe('ApplicationService.manage registration', () => {
  const project = { id: 'project-1', kind: 'project', projectId: null, data: {} };
  const records = {
    get: jest.fn(),
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const service = new ApplicationService(records as any);

  beforeEach(() => {
    jest.resetAllMocks();
    records.get.mockResolvedValue(project);
    records.create.mockImplementation(async (kind, data, projectId) => ({ kind, data, projectId }));
  });

  it('registers an app when an optional repository-only field is undefined', async () => {
    const data = { name: 'Manager', path: '/checkout', remoteUrl: undefined };
    await expect(
      service.manage({ action: 'register', projectId: project.id, kind: 'app', data } as any),
    ).resolves.toMatchObject({
      kind: 'app',
      data: { name: 'Manager', path: '/checkout' },
    });
  });

  it('registers a repository when optional app-only fields are undefined', async () => {
    const data = {
      name: 'AgentPier',
      path: '/checkout',
      remoteUrl: 'https://github.com/mitersidorov/agentpier',
      purpose: undefined,
      repositoryId: undefined,
    };
    await expect(
      service.manage({ action: 'register', projectId: project.id, kind: 'repository', data } as any),
    ).resolves.toMatchObject({ kind: 'repository', data: { remoteUrl: 'https://github.com/mitersidorov/agentpier' } });
  });

  it('rejects app-only fields when they have an actual value on a repository', async () => {
    await expect(
      service.manage({
        action: 'register',
        projectId: project.id,
        kind: 'repository',
        data: { name: 'AgentPier', path: '/checkout', purpose: 'application' },
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
