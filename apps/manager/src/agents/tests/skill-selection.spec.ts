import { selectSkills, skillEvidence } from '../services/skill-selection';

const catalog = [
  'minimal-test-strategy',
  'manage-typeorm-migration',
  'backend-review-checklist',
  'frontend-general-guidelines',
  'angular-frontend-guidelines',
  'ssr-isr-cache-pattern',
  'implement-ui-from-reference',
].map((name) => ({ path: `/skills/${name}/SKILL.md`, content: name }));
const names = (skills: typeof catalog) => skills.map((skill) => skill.content);

describe('selectSkills', () => {
  it('selects analysis review without execution or unrelated migration skills', () => {
    expect(names(selectSkills(catalog, 'analysis', 'Inspect service'))).toEqual(['backend-review-checklist']);
  });
  it('activates migration guidance only for a relevant task', () => {
    expect(names(selectSkills(catalog, 'execution', 'Add schema migration'))).toContain('manage-typeorm-migration');
    expect(names(selectSkills(catalog, 'execution', 'Fix calculation'))).not.toContain('manage-typeorm-migration');
  });
  it('keeps static dashboards free of Angular/SSR and reference-only guidance', () => {
    const selected = names(
      selectSkills(catalog, 'execution', 'Fix button', 'Static dashboard, profile frontend-angular'),
    );
    expect(selected).toContain('frontend-general-guidelines');
    expect(selected).not.toContain('angular-frontend-guidelines');
    expect(selected).not.toContain('ssr-isr-cache-pattern');
    expect(selected).not.toContain('implement-ui-from-reference');
    expect(names(selectSkills(catalog, 'execution', 'Fix SSR cache', 'Angular application'))).toContain(
      'ssr-isr-cache-pattern',
    );
  });
  it('preserves localized keyword selection with ASCII-only source literals', () => {
    const cases = [
      ['backend-review-checklist', '\u0440\u0435\u0432\u044c\u044e'],
      ['backend-review-checklist', '\u043f\u0440\u043e\u0432\u0435\u0440'],
      ['frontend-review-checklist', '\u0440\u0435\u0432\u044c\u044e'],
      ['frontend-review-checklist', '\u043f\u0440\u043e\u0432\u0435\u0440'],
      ['integration-pattern', '\u0438\u043d\u0442\u0435\u0433\u0440\u0430\u0446'],
      ['manage-typeorm-migration', '\u043c\u0438\u0433\u0440\u0430\u0446'],
      ['manage-typeorm-migration', '\u0441\u0445\u0435\u043c'],
      ['nestjs-domain-scaffold', '\u043c\u043e\u0434\u0443\u043b'],
      ['nestjs-domain-scaffold', '\u0434\u043e\u043c\u0435\u043d'],
      ['verify-docker-runtime', '\u0431\u0430\u0437\u0430'],
      ['verify-docker-runtime', '\u0431\u0430\u0437\u044b'],
      ['verify-docker-runtime', '\u0431\u0430\u0437\u0443'],
      ['implement-ui-from-reference', '\u043c\u0430\u043a\u0435\u0442'],
      ['implement-ui-from-reference', '\u0440\u0435\u0444\u0435\u0440\u0435\u043d\u0441'],
    ];
    for (const [name, task] of cases) {
      const skills = [{ path: `/skills/${name}/SKILL.md`, content: name }];
      expect(names(selectSkills(skills, 'execution', task))).toContain(name);
    }
  });
  it('hashes only attached skills deterministically', () => {
    expect(skillEvidence(catalog.slice(0, 1))).toEqual([
      { path: catalog[0].path, contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
    ]);
  });
});
