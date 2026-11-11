import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ManagerService } from '../manager/manager.service';

export type AgentRole = string;

@Injectable()
export class AgentProfileService {
  constructor(private readonly manager: ManagerService) {}

  async list() {
    const root = join(process.cwd(), 'agents');
    const entries = await readdir(root, { withFileTypes: true });
    const roles = entries
      .filter((entry) => entry.isDirectory() && /^[a-z0-9][a-z0-9-]{0,40}$/.test(entry.name))
      .map((entry) => entry.name);
    return Promise.all(roles.map((role) => this.load(role)));
  }

  async load(role: string) {
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(role)) throw new BadRequestException(`Invalid universal profile: ${role}`);
    const profilePath = join(process.cwd(), 'agents', role, 'AGENTS.md');
    const profile = await readFile(profilePath, 'utf8');
    const declaredSkills = profile
      .match(/<!--\s*skills:\s*([^>]+)-->/i)?.[1]
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const skillFiles = await this.collectSkills(declaredSkills);
    const skills = await Promise.all(skillFiles.map(async (path) => ({ path, content: await readFile(path, 'utf8') })));
    const material = [profile, ...skills.map((skill) => `${skill.path}\n${skill.content}`)];
    return {
      role,
      profilePath,
      profile,
      skills,
      version: createHash('sha256').update(material.join('\n')).digest('hex'),
    };
  }

  private async collectSkills(selectedSkills?: string[]) {
    const root = join(process.cwd(), 'skills');
    const entries = await readdir(root, { withFileTypes: true });
    const selected = selectedSkills ? new Set(selectedSkills) : undefined;
    const files: string[] = [];
    for (const entry of entries) {
      if (entry.isFile() && (!selected || selected.has(entry.name.replace(/\.md$/, '')) || selected.has(entry.name)))
        files.push(join(root, entry.name));
      if (entry.isDirectory() && (!selected || selected.has(entry.name))) {
        files.push(join(root, entry.name, 'SKILL.md'));
      }
    }
    return files;
  }
}
