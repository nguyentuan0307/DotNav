import { GitOperationState } from './gitPanelModels';

export function operationArguments(operation: GitOperationState | string | undefined, action: 'continue' | 'abort' | 'skip'): string[] {
  const name = String(operation ?? '').toUpperCase();
  const command = name.includes('REBAS') ? 'rebase'
    : name.includes('CHERRY') ? 'cherry-pick'
      : name.includes('REVERT') ? 'revert' : name.includes('MERG') ? 'merge' : undefined;
  if (!command) throw new Error('No supported Git operation is active. Refresh the panel and try again.');
  if (action === 'skip' && command !== 'rebase' && command !== 'cherry-pick') {
    throw new Error(`Skip is not available while ${name}.`);
  }
  return [command, `--${action}`];
}

export function canSkipOperation(operation: GitOperationState | string | undefined): boolean {
  const name = String(operation ?? '').toUpperCase();
  return name.includes('REBAS') || name.includes('CHERRY');
}

export function isActionAllowedDuringOperation(action: string): boolean {
  return ['continue', 'abort', 'skip', 'commitEmptyContinue', 'fetch'].includes(action);
}
