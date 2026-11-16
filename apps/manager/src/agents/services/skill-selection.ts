import { createHash } from 'node:crypto';
import { basename, dirname } from 'node:path';

type Skill = { path: string; content: string };

// Select from the profile's versioned skill catalog, never from unrelated profiles.
export function selectSkills(skills: Skill[], requested?: string[]) {
  if (!requested?.length) return skills;
  const byName = new Map(skills.map((skill) => [basename(dirname(skill.path)), skill]));
  const missing = requested.filter((name) => !byName.has(name));
  if (missing.length) throw new Error(`Selected skills are not declared by the profile: ${missing.join(', ')}`);
  return requested.map((name) => byName.get(name)!);
}

export function skillEvidence(skills: Skill[]) {
  return skills.map((skill) => ({
    path: skill.path,
    contentHash: createHash('sha256').update(skill.content).digest('hex'),
  }));
}
