jest.mock('../../backup/services/backup.service', () => ({ BackupService: class BackupService {} }));

import { McpController } from '../controllers/mcp.controller';

describe('MCP tool annotations', () => {
  const expected = {
    manager_status: [true, false, true, true],
    list_projects: [true, false, true, false],
    register_project: [false, false, false, false],
    update_project: [false, true, true, false],
    delete_project: [false, true, false, false],
    manage_applications: [false, true, false, false],
    list_agents: [true, false, true, false],
    list_models: [true, false, true, true],
    update_agent_profile: [false, true, true, true],
    get_project_context: [true, false, true, false],
    update_project_context: [false, true, false, false],
    analyze_task: [false, false, false, false],
    get_analysis_results: [true, false, true, false],
    dispatch_orchestration_analysis: [false, false, false, true],
    save_plan: [false, true, false, false],
    approve_plan: [false, true, false, false],
    execute_task: [false, true, false, false],
    complete_task_from_evidence: [false, true, false, false],
    get_task_status: [false, true, false, true],
    get_agent_messages: [true, false, true, false],
    send_agent_message: [false, true, false, true],
    cancel_task: [false, true, true, true],
    get_task_results: [false, true, false, true],
    read_orchestration_task: [true, false, true, false],
    record_orchestration_decision: [false, false, false, false],
    dispatch_orchestration_assignment: [false, true, false, true],
    record_orchestration_task_status: [false, true, false, false],
    record_assignment_outcome: [false, true, false, false],
    backup_database: [false, true, false, true],
    get_backup_status: [true, false, true, false],
  } as const;

  it('advertises reviewed annotations for every MCP tool', async () => {
    const controller = new McpController(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn((value) => value) };
    const listing = await controller.handle({ id: 1, method: 'tools/list' } as any, response as any);
    const tools = listing.result.tools as Array<{ name: keyof typeof expected; annotations: Record<string, boolean> }>;

    expect(tools).toHaveLength(30);
    for (const [name, values] of Object.entries(expected)) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool).toBeDefined();
      expect(tool?.annotations).toEqual({
        readOnlyHint: values[0],
        destructiveHint: values[1],
        idempotentHint: values[2],
        openWorldHint: values[3],
      });
    }
  });
});
