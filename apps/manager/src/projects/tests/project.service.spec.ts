import { BadRequestException } from '@nestjs/common';
import { ProjectService } from '../services/project.service';

describe('ProjectService.update', () => {
  const project = { id: 'project-1', kind: 'project', data: { name: 'Old project' } };
  const records = { get: jest.fn(), update: jest.fn() };
  const service = new ProjectService(records as any);

  beforeEach(() => {
    jest.resetAllMocks();
    records.get.mockResolvedValue(project);
    records.update.mockResolvedValue({ ...project, data: { name: 'New project' } });
  });

  it('updates project metadata through its project record', async () => {
    await expect(service.update(project.id, { name: 'New project' })).resolves.toMatchObject({
      data: { name: 'New project' },
    });
    expect(records.update).toHaveBeenCalledWith(project.id, { name: 'New project' });
  });

  it('rejects updates when the record is not a project', async () => {
    records.get.mockResolvedValue({ id: 'app-1', kind: 'app' });
    await expect(service.update('app-1', { name: 'Wrong kind' })).rejects.toBeInstanceOf(BadRequestException);
    expect(records.update).not.toHaveBeenCalled();
  });
});
