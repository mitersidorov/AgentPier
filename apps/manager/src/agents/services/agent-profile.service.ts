import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ManagerService } from '../../manager/services/manager.service';
import { CodexAppServerService } from '../../integrations/codex/services/codex-app-server.service';

@Injectable()
export class AgentProfileService {
  constructor(
    private readonly manager: ManagerService,
    private readonly codex: CodexAppServerService,
  ) {}

  async list() {
    const root = join(process.cwd(), 'agents');
    const entries = await readdir(root, { withFileTypes: true });
    const roles = entries
      .filter((entry) => entry.isDirectory() && /^[a-z0-9][a-z0-9-]{0,40}$/.test(entry.name))
      .map((entry) => entry.name);
    const [profiles, persisted] = await Promise.all([
      Promise.all(roles.sort().map((role) => this.load(role))),
      this.manager.list('agent-profile'),
    ]);
    const configured = new Map(persisted.map((item) => [item.data.role, item.data.defaultModel]));
    return profiles.map((profile) => ({ ...profile, defaultModel: configured.get(profile.role) || null }));
  }

  async updateDefaultModel(role: string, model?: string, defaultReasoningEffort?: string) {
    const profile = await this.load(role);
    if (!model && !defaultReasoningEffort) throw new BadRequestException('Provide model or defaultReasoningEffort');
    const runtime = await this.resolveRuntime({
      defaultModel: model || profile.defaultModel,
      defaultReasoningEffort: defaultReasoningEffort || profile.defaultReasoningEffort,
    });
    return this.manager.updateProfileDefaultModel(profile.role, runtime.model, runtime.effort);
  }

  async resolveRuntime(profile: { defaultModel: string | null; defaultReasoningEffort: string }) {
    const models = await this.codex.listModels();
    const model = profile.defaultModel
      ? models.find((item) => item.id === profile.defaultModel)
      : models.find((item) => item.isDefault);
    if (!model) throw new BadRequestException('Select a model returned by list_models');
    const effort = profile.defaultReasoningEffort || 'medium';
    if (!model.supportedReasoningEfforts.some((option) => option.reasoningEffort === effort))
      throw new BadRequestException(`Reasoning effort ${effort} is not available for ${model.id}; use list_models`);
    return { model: model.id, effort };
  }

  async load(role: string) {
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(role)) throw new BadRequestException(`Invalid agent profile: ${role}`);
    const profilePath = join(process.cwd(), 'agents', role, 'AGENTS.md');
    const profile = await readFile(profilePath, 'utf8');
    const declaredSkills = profile
      .match(/<!--\s*skills:\s*([^>]+)-->/i)?.[1]
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    await this.collectSkills(role, declaredSkills);
    const skillFiles = await this.collectSkills(role);
    const skills = await Promise.all(skillFiles.map(async (path) => ({ path, content: await readFile(path, 'utf8') })));
    const material = [profile, ...skills.map((skill) => `${skill.path}\n${skill.content}`)];
    const configured = (await this.manager.list('agent-profile')).find((item) => item.data.role === role)?.data;
    return {
      role,
      name: this.displayName(role),
      profilePath,
      profile,
      skills,
      version: createHash('sha256').update(material.join('\n')).digest('hex'),
      defaultModel: typeof configured?.defaultModel === 'string' ? configured.defaultModel : null,
      defaultReasoningEffort:
        typeof configured?.defaultReasoningEffort === 'string' ? configured.defaultReasoningEffort : 'medium',
    };
  }

  private displayName(role: string) {
    if (role === 'backend-nestjs') return 'Backend NestJS';
    if (role === 'frontend-angular') return 'Frontend Angular';
    return role.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  private async collectSkills(role: string, selectedSkills?: string[]) {
    const root = join(process.cwd(), 'agents', role, 'skills');
    const entries: Dirent[] = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [] as Dirent[];
      throw error;
    });
    const selected = selectedSkills ? new Set(selectedSkills) : undefined;
    const files: string[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory() || !/^[a-z0-9][a-z0-9-]{0,80}$/.test(entry.name)) continue;
      if (!selected || selected.has(entry.name)) files.push(join(root, entry.name, 'SKILL.md'));
    }
    const missing = [...(selected || [])].filter(
      (name) => !entries.some((entry) => entry.isDirectory() && entry.name === name),
    );
    if (missing.length) throw new BadRequestException(`Profile ${role} declares missing skills: ${missing.join(', ')}`);
    return files;
  }
}
