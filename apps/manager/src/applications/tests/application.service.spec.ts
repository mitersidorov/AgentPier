import { BadRequestException } from '@nestjs/common';
import { ApplicationService } from '../services/application.service';

describe('ApplicationService.manage', () => {
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

  it('updates an application by recordId within its project', async () => {
    const application = { id: 'app-1', kind: 'app', projectId: project.id, data: { name: 'Old', path: '/old' } };
    records.get.mockResolvedValueOnce(project).mockResolvedValueOnce(application);
    records.update.mockResolvedValue({ ...application, data: { name: 'New', path: '/new' } });

    await expect(
      service.manage({
        action: 'update',
        projectId: project.id,
        recordId: application.id,
        data: { name: 'New', path: '/new' },
      } as any),
    ).resolves.toMatchObject({ data: { name: 'New', path: '/new' } });
    expect(records.update).toHaveBeenCalledWith(application.id, { name: 'New', path: '/new' });
  });

  it('updates a repository remote URL and rejects records from another project', async () => {
    const repository = { id: 'repo-1', kind: 'repository', projectId: project.id, data: { remoteUrl: 'old' } };
    records.get.mockResolvedValueOnce(project).mockResolvedValueOnce(repository);
    records.update.mockResolvedValue({ ...repository, data: { remoteUrl: 'https://example.test/repo' } });
    await expect(
      service.manage({
        action: 'update',
        projectId: project.id,
        recordId: repository.id,
        kind: 'repository',
        data: { remoteUrl: 'https://example.test/repo' },
      } as any),
    ).resolves.toMatchObject({ data: { remoteUrl: 'https://example.test/repo' } });

    records.get.mockResolvedValueOnce(project).mockResolvedValueOnce({ ...repository, projectId: 'other-project' });
    await expect(
      service.manage({
        action: 'update',
        projectId: project.id,
        recordId: repository.id,
        data: { name: 'Wrong project' },
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
