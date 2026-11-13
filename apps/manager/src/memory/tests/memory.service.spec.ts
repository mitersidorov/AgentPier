import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { MemoryService } from '../services/memory.service';

describe('MemoryService project instructions', () => {
  const project = { id: 'project-1', kind: 'project' };
  let current: any;
  const records = {
    get: jest.fn(async (id: string) => (id === 'project-1' ? project : current)),
    create: jest.fn(
      async (kind: string, data: any, projectId: string) => (current = { id: 'instruction-1', kind, projectId, data }),
    ),
    update: jest.fn(async (_id: string, data: any) => (current = { ...current, data: { ...current.data, ...data } })),
  };
  let service: MemoryService;

  beforeEach(() => {
    jest.clearAllMocks();
    current = undefined;
    service = new MemoryService(records as any);
  });

  it('stores provenance, initial version and deterministic content hash for confirmed architecture instructions', async () => {
    const result = await service.update({
      projectId: 'project-1',
      kind: 'instruction',
      userConfirmed: true,
      data: { title: 'AgentPier architecture', category: 'architecture', content: 'Use NestJS and MySQL.' },
    } as any);
    expect(result.data).toMatchObject({
      status: 'confirmed',
      source: 'user_confirmed',
      version: 1,
      contentHash: createHash('sha256').update('Use NestJS and MySQL.').digest('hex'),
    });
    expect(result.data.confirmedAt).toBeTruthy();
  });

  it('keeps drafts out of confirmed state and requires explicit confirmation', async () => {
    const result = await service.update({
      projectId: 'project-1',
      kind: 'instruction',
      data: { content: 'Draft' },
    } as any);
    expect(result.data).toMatchObject({ status: 'draft', source: 'draft', version: 1 });
    await expect(
      service.update({
        projectId: 'project-1',
        kind: 'instruction',
        data: { content: 'Confirmed', status: 'confirmed' },
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('increments version and replaces the hash when confirmed content changes', async () => {
    current = {
      id: 'instruction-1',
      kind: 'instruction',
      projectId: 'project-1',
      data: {
        content: 'Old',
        status: 'confirmed',
        source: 'user_confirmed',
        version: 2,
        contentHash: 'old-hash',
      },
    };
    const result = await service.update({
      projectId: 'project-1',
      kind: 'instruction',
      recordId: 'instruction-1',
      userConfirmed: true,
      data: { content: 'New' },
    } as any);
    expect(result.data).toMatchObject({
      content: 'New',
      status: 'confirmed',
      version: 3,
      contentHash: createHash('sha256').update('New').digest('hex'),
    });
  });
});
