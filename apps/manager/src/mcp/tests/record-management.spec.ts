jest.mock('../../backup/services/backup.service', () => ({ BackupService: class BackupService {} }));

import { McpController } from '../controllers/mcp.controller';

describe('MCP record management tools', () => {
  const projects = { update: jest.fn().mockResolvedValue({ id: 'project-id', updated: true }) };
  const applications = { manage: jest.fn().mockResolvedValue({ id: 'record-id', updated: true }) };
  const controller = new McpController(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    projects as any,
    applications as any,
    {} as any,
    {} as any,
  );

  const call = async (name: string, args: object) => {
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn((value) => value) };
    return controller.handle(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } as any,
      response as any,
    );
  };

  beforeEach(() => jest.clearAllMocks());

  it('advertises update tools and routes valid project edits', async () => {
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn((value) => value) };
    const listing = await controller.handle({ id: 2, method: 'tools/list' } as any, response as any);
    const names = listing.result.tools.map((tool: any) => tool.name);
    expect(names).toContain('update_project');
    expect(names).toContain('manage_applications');

    const result = await call('update_project', {
      projectId: '00000000-0000-4000-8000-000000000001',
      data: { description: 'Updated project' },
    });
    expect(result.result.isError).toBeUndefined();
    expect(projects.update).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001', {
      description: 'Updated project',
    });
  });

  it('routes application and repository updates with their project scope', async () => {
    const result = await call('manage_applications', {
      action: 'update',
      projectId: '00000000-0000-4000-8000-000000000001',
      recordId: '00000000-0000-4000-8000-000000000002',
      kind: 'repository',
      data: { remoteUrl: 'https://example.test/repo' },
    });
    expect(result.result.isError).toBeUndefined();
    expect(applications.manage).toHaveBeenCalledWith({
      action: 'update',
      projectId: '00000000-0000-4000-8000-000000000001',
      recordId: '00000000-0000-4000-8000-000000000002',
      kind: 'repository',
      data: { remoteUrl: 'https://example.test/repo' },
    });
  });
});
