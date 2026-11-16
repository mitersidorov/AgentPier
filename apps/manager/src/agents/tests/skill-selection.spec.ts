import { selectSkills, skillEvidence } from '../services/skill-selection';

const catalog = ['minimal-test-strategy', 'manage-typeorm-migration', 'backend-review-checklist'].map((name) => ({
  path: `/agents/backend-nestjs/skills/${name}/SKILL.md`,
  content: name,
}));

describe('selectSkills', () => {
  it('leaves skill applicability to the orchestrator when it does not select a subset', () => {
    expect(selectSkills(catalog).map((skill) => skill.content)).toEqual([
      'minimal-test-strategy',
      'manage-typeorm-migration',
      'backend-review-checklist',
    ]);
  });

  it('uses exact skill names selected by the LLM and ignores task wording', () => {
    expect(selectSkills(catalog, ['manage-typeorm-migration']).map((skill) => skill.content)).toEqual([
      'manage-typeorm-migration',
    ]);
  });

  it('reports a selected skill that is not declared by the chosen profile', () => {
    expect(() => selectSkills(catalog, ['frontend-general-guidelines'])).toThrow(/not declared by the profile/);
  });

  it('hashes only the skills actually supplied to a session', () => {
    expect(skillEvidence(catalog.slice(0, 1))).toEqual([
      { path: catalog[0].path, contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
    ]);
  });
});
