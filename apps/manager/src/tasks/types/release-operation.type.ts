export type ReleaseOperation =
  | { type: 'commit'; paths: string[] }
  | { type: 'push'; remote: string; ref: string }
  | { type: 'pr'; head: string; base: string; action: 'create' | 'update' }
  | { type: 'review'; pr: string; action: 'comment' | 'approve' | 'request-changes' }
  | { type: 'merge'; pr: string; method: 'merge' | 'squash' | 'rebase' };

// Targets are approval evidence, never shell fragments or inferred permissions.
export function validReleaseOperations(value: unknown): value is ReleaseOperation[] {
  if (!Array.isArray(value) || !value.length || value.length > 20) return false;
  const text = (v: unknown): v is string =>
    typeof v === 'string' &&
    v.trim().length > 0 &&
    v.length <= 1000 &&
    ![...v].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
  return value.every((op) => {
    if (!op || typeof op !== 'object' || Array.isArray(op)) return false;
    const fields: Record<string, string[]> = {
      commit: ['type', 'paths'],
      push: ['type', 'remote', 'ref'],
      pr: ['type', 'head', 'base', 'action'],
      review: ['type', 'pr', 'action'],
      merge: ['type', 'pr', 'method'],
    };
    if (typeof op.type !== 'string' || !Object.prototype.hasOwnProperty.call(fields, op.type)) return false;
    const keys = fields[op.type];
    if (!keys || Object.keys(op).length !== keys.length || Object.keys(op).some((key) => !keys.includes(key)))
      return false;
    switch (op.type) {
      case 'commit':
        return (
          Array.isArray(op.paths) &&
          op.paths.length > 0 &&
          op.paths.every(
            (path: unknown) =>
              text(path) && !path.startsWith('/') && !path.startsWith('-') && !path.split('/').includes('..'),
          )
        );
      case 'push':
        return text(op.remote) && text(op.ref);
      case 'pr':
        return text(op.head) && text(op.base) && ['create', 'update'].includes(op.action);
      case 'review':
        return text(op.pr) && ['comment', 'approve', 'request-changes'].includes(op.action);
      case 'merge':
        return text(op.pr) && ['merge', 'squash', 'rebase'].includes(op.method);
      default:
        return false;
    }
  });
}
