export type EfActionGroup = 'Migrations' | 'Database' | 'Scripts' | 'Advanced' | 'Danger zone';
export type EfActionIcon =
  | 'add' | 'back' | 'check' | 'code' | 'database' | 'delete'
  | 'info' | 'list' | 'package' | 'spark';

export type EfActionId =
  | 'dotnav.ef.addMigration'
  | 'dotnav.ef.removeLastMigration'
  | 'dotnav.ef.listMigrations'
  | 'dotnav.ef.updateDatabase'
  | 'dotnav.ef.pendingModelChanges'
  | 'dotnav.ef.dbContextInfo'
  | 'dotnav.ef.generateScript'
  | 'dotnav.ef.migrationsBundle'
  | 'dotnav.ef.optimizeDbContext'
  | 'dotnav.ef.dropDatabase';

export interface EfActionDefinition {
  readonly id: EfActionId;
  readonly group: EfActionGroup;
  readonly label: string;
  readonly icon: EfActionIcon;
  readonly description: string;
  readonly danger?: boolean;
}

export type EfActionHandlers<TSource> = Record<EfActionId, (source?: TSource) => Promise<void>>;

export interface BoundEfAction<TSource> extends EfActionDefinition {
  execute(source?: TSource): Promise<void>;
}

export const efActionDefinitions: readonly EfActionDefinition[] = [
  {
    id: 'dotnav.ef.addMigration',
    group: 'Migrations',
    label: 'Add Migration',
    icon: 'add',
    description: 'Capture the current model changes in a new migration.'
  },
  {
    id: 'dotnav.ef.removeLastMigration',
    group: 'Migrations',
    label: 'Remove Last',
    icon: 'back',
    description: 'Remove the most recent migration from the project.'
  },
  {
    id: 'dotnav.ef.listMigrations',
    group: 'Migrations',
    label: 'Browse Migrations',
    icon: 'list',
    description: 'Inspect migration history for the selected DbContext.'
  },
  {
    id: 'dotnav.ef.updateDatabase',
    group: 'Database',
    label: 'Update Database',
    icon: 'database',
    description: 'Bring the target database to a selected migration.'
  },
  {
    id: 'dotnav.ef.pendingModelChanges',
    group: 'Database',
    label: 'Check Model',
    icon: 'check',
    description: 'Verify whether the model needs a new migration.'
  },
  {
    id: 'dotnav.ef.dbContextInfo',
    group: 'Database',
    label: 'DbContext Info',
    icon: 'info',
    description: 'Inspect provider and database details for this DbContext.'
  },
  {
    id: 'dotnav.ef.generateScript',
    group: 'Scripts',
    label: 'Generate SQL',
    icon: 'code',
    description: 'Generate a reviewable SQL migration script.'
  },
  {
    id: 'dotnav.ef.migrationsBundle',
    group: 'Advanced',
    label: 'Migration Bundle',
    icon: 'package',
    description: 'Create a deployable migration executable.'
  },
  {
    id: 'dotnav.ef.optimizeDbContext',
    group: 'Advanced',
    label: 'Optimize DbContext',
    icon: 'spark',
    description: 'Generate a compiled model for faster startup.'
  },
  {
    id: 'dotnav.ef.dropDatabase',
    group: 'Danger zone',
    label: 'Drop Database',
    icon: 'delete',
    description: 'Permanently delete the selected database.',
    danger: true
  }
] as const;

export function efActionDefinition(actionId: string | undefined): EfActionDefinition | undefined {
  return efActionDefinitions.find(action => action.id === actionId);
}

export function bindEfActions<TSource>(
  handlers: EfActionHandlers<TSource>
): readonly BoundEfAction<TSource>[] {
  return efActionDefinitions.map(action => ({ ...action, execute: handlers[action.id] }));
}

export function efActionGroups(): ReadonlyMap<EfActionGroup, readonly EfActionDefinition[]> {
  const groups = new Map<EfActionGroup, EfActionDefinition[]>();
  for (const action of efActionDefinitions) {
    const entries = groups.get(action.group) ?? [];
    entries.push(action);
    groups.set(action.group, entries);
  }
  return groups;
}
