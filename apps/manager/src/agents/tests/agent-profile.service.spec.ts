import { AgentProfileService } from '../services/agent-profile.service';

describe('AgentProfileService effort defaults', () => {
  const records = { list: jest.fn().mockResolvedValue([]), updateProfileDefaultModel: jest.fn() };
  const codex = {
    listModels: jest.fn().mockResolvedValue([
      {
        id: 'model',
        isDefault: true,
        supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'high' }],
      },
    ]),
  };
  const service = new AgentProfileService(records as any, codex as any);

  it('uses medium for existing unconfigured profiles and the live default model', async () => {
    const profile = await service.load('backend-nestjs');
    expect(profile.defaultReasoningEffort).toBe('medium');
    await expect(service.resolveRuntime(profile)).resolves.toEqual({ model: 'model', effort: 'medium' });
  });
  it('rejects an effort absent from the selected model catalog without persisting', async () => {
    await expect(service.updateDefaultModel('backend-nestjs', 'model', 'ultra')).rejects.toThrow(/not available/);
    expect(records.updateProfileDefaultModel).not.toHaveBeenCalled();
  });
  it('supports effort-only updates and preserves model-only compatibility', async () => {
    await service.updateDefaultModel('backend-nestjs', undefined, 'high');
    expect(records.updateProfileDefaultModel).toHaveBeenLastCalledWith('backend-nestjs', 'model', 'high');
    await service.updateDefaultModel('backend-nestjs', 'model');
    expect(records.updateProfileDefaultModel).toHaveBeenLastCalledWith('backend-nestjs', 'model', 'medium');
    await expect(service.updateDefaultModel('backend-nestjs')).rejects.toThrow(/Provide model/);
  });
});
