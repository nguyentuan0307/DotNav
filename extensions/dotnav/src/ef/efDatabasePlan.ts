export interface EfDatabasePlan {
  readonly label: string;
  readonly danger: boolean;
  readonly valid: boolean;
  readonly direction: 'apply' | 'rollback' | 'none';
  readonly count: number;
}

export function planDatabaseUpdate(
  orderedNames: readonly string[],
  appliedNames: ReadonlySet<string>,
  target: string
): EfDatabasePlan {
  if (orderedNames.length === 0) {
    return { label: 'Database Is Up to Date', danger: false, valid: false, direction: 'none', count: 0 };
  }

  const currentIndex = orderedNames.reduce(
    (last, name, index) => appliedNames.has(name) ? index : last,
    -1
  );
  const targetIndex = target === '0'
    ? -1
    : target
      ? orderedNames.indexOf(target)
      : orderedNames.length - 1;
  if (target !== '0' && target.length > 0 && targetIndex === -1) {
    return { label: 'Select a Valid Migration', danger: false, valid: false, direction: 'none', count: 0 };
  }
  if (targetIndex === currentIndex) {
    return { label: 'Database Is Up to Date', danger: false, valid: false, direction: 'none', count: 0 };
  }
  if (targetIndex < currentIndex) {
    const count = currentIndex - targetIndex;
    return {
      label: targetIndex < 0
        ? 'Revert All Migrations'
        : `Roll Back ${count} Migration${count === 1 ? '' : 's'}`,
      danger: true,
      valid: true,
      direction: 'rollback',
      count
    };
  }

  const count = targetIndex - currentIndex;
  return {
    label: `Apply ${count} Migration${count === 1 ? '' : 's'}`,
    danger: false,
    valid: true,
    direction: 'apply',
    count
  };
}
