import { createHash } from 'node:crypto';
import { basename, dirname } from 'node:path';

type Skill = { path: string; content: string };

// Select from the profile's versioned skill catalog, never from unrelated profiles.
export function selectSkills(skills: Skill[], phase: 'analysis' | 'execution', task: string, application = '') {
  task = task.toLowerCase();
  const text = `${task} ${application}`.toLowerCase();
  const angular =
    /\bangular\b/.test(application.toLowerCase()) && !/static|html\/css|not angular/.test(application.toLowerCase());
  // Unicode escapes preserve localized keyword matching in English-only source.
  const rules: Record<string, boolean> = {
    'backend-review-checklist':
      phase === 'analysis' ||
      /review|audit|\u0440\u0435\u0432\u044c\u044e|\u043f\u0440\u043e\u0432\u0435\u0440/.test(task),
    'minimal-test-strategy': phase === 'execution',
    'integration-pattern':
      /\b(http|api|integration|provider|websocket)\b|\u0438\u043d\u0442\u0435\u0433\u0440\u0430\u0446/.test(text),
    'manage-typeorm-migration': /migration|schema|\u043c\u0438\u0433\u0440\u0430\u0446|\u0441\u0445\u0435\u043c/.test(
      text,
    ),
    'nestjs-domain-scaffold':
      phase === 'execution' &&
      /module|domain|scaffold|\u043c\u043e\u0434\u0443\u043b|\u0434\u043e\u043c\u0435\u043d/.test(task),
    'verify-docker-runtime': /docker|compose|runtime|database|mysql|\u0431\u0430\u0437[\u0430\u044b\u0443]/.test(text),
    'frontend-general-guidelines': phase === 'execution',
    'frontend-review-checklist':
      phase === 'analysis' ||
      /review|audit|\u0440\u0435\u0432\u044c\u044e|\u043f\u0440\u043e\u0432\u0435\u0440/.test(task),
    'implement-ui-from-reference':
      phase === 'execution' &&
      /figma|reference|screenshot|\u043c\u0430\u043a\u0435\u0442|\u0440\u0435\u0444\u0435\u0440\u0435\u043d\u0441/.test(
        text,
      ),
    'verify-frontend-runtime': phase === 'execution',
    'angular-frontend-guidelines': angular,
    'angular-component-pattern': angular && phase === 'execution',
    'implement-angular-feature': angular && phase === 'execution',
    'ssr-isr-cache-pattern': angular && /\b(ssr|isr|hydration|cache)\b/.test(text),
  };
  return skills.filter((skill) => {
    const name = basename(dirname(skill.path));
    // Custom skills opt in by their exact name in the task or application contract.
    return rules[name] ?? text.includes(name);
  });
}

export function skillEvidence(skills: Skill[]) {
  return skills.map((skill) => ({
    path: skill.path,
    contentHash: createHash('sha256').update(skill.content).digest('hex'),
  }));
}
