jest.mock('../../backup/services/backup.service', () => ({ BackupService: class BackupService {} }));
import { McpController } from '../controllers/mcp.controller';
import { AgentProfileService } from '../../agents/services/agent-profile.service';

describe('MCP profile validation', () => {
  const records = {
    list: jest.fn().mockResolvedValue([]),
    updateProfileDefaultModel: jest.fn().mockResolvedValue({ saved: true }),
  };
  const codex = {
    listModels: jest
      .fn()
      .mockResolvedValue([
        { id: 'model', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] },
      ]),
  };
  const profiles = new AgentProfileService(records as any, codex as any);
  const controller = new McpController(
    records as any,
    profiles,
    codex as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const call = async (args: object) => {
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn((value) => value) };
    return controller.handle(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'update_agent_profile', arguments: args } } as any,
      response as any,
    );
  };

  it.each([
    { role: 'backend-nestjs', defaultReasoningEffort: 3 },
    { role: 'backend-nestjs', defaultReasoningEffort: 'ultra' },
    { role: 'backend-nestjs', model: 'unknown' },
    { role: 'backend-nestjs' },
    { role: 'backend-nestjs', model: 'model', effort: 'high' },
  ])('rejects invalid or unavailable configuration: %j', async (args) => {
    const result = await call(args);
    expect(result.result.isError).toBe(true);
  });

  it('accepts an available effort and advertises it in the schema', async () => {
    const result = await call({ role: 'backend-nestjs', defaultReasoningEffort: 'medium' });
    expect(result.result.isError).toBeUndefined();
    expect(records.updateProfileDefaultModel).toHaveBeenLastCalledWith('backend-nestjs', 'model', 'medium');
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn((value) => value) };
    const listing = await controller.handle({ id: 2, method: 'tools/list' } as any, response as any);
    expect(
      listing.result.tools.find((tool: any) => tool.name === 'update_agent_profile').inputSchema.properties,
    ).toHaveProperty('defaultReasoningEffort');
  });
});
