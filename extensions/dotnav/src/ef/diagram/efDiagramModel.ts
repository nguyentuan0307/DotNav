export type PropertyKeyType = 'primary' | 'foreign' | 'none';

export interface EntityProperty {
  readonly name: string;
  readonly type: string;
  readonly isPrimaryKey: boolean;
  readonly isForeignKey: boolean;
  readonly isNullable: boolean;
  readonly isNavigation: boolean;
  readonly foreignKeyTargetEntity?: string;
  readonly foreignKeyTargetProperty?: string;
  readonly navigationTargetEntity?: string;
  readonly isCollectionNavigation?: boolean;
}

export interface EntityModel {
  readonly id: string;
  readonly name: string;
  readonly tableName?: string;
  readonly schemaName?: string;
  readonly filePath: string;
  readonly line: number;
  readonly projectName: string;
  readonly properties: readonly EntityProperty[];
  readonly dbContextNames?: readonly string[];
}

export type RelationshipCardinality = 'one-to-many' | 'one-to-one' | 'many-to-many';

export interface EntityRelationship {
  readonly id: string;
  readonly fromEntity: string;
  readonly fromProperty?: string;
  readonly toEntity: string;
  readonly toProperty?: string;
  readonly cardinality: RelationshipCardinality;
  readonly foreignKeyName?: string;
  readonly deleteBehavior?: string;
  readonly isRequired?: boolean;
  readonly navigationName?: string;
  readonly inverseNavigationName?: string;
  readonly principalKey?: string;
}

export interface DiagramEntityState {
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly color?: string;
  readonly hiddenColumns?: readonly string[];
  readonly isMinimized?: boolean;
}

export interface DiagramFile {
  readonly version: number;
  readonly name: string;
  readonly dbContext?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly entities: Record<string, DiagramEntityState | { x: number; y: number }>;
}

export interface DiagramWebviewInitialState {
  readonly availableDbContexts: readonly string[];
  readonly activeDbContext: string;
  readonly entitiesByContext: Record<string, readonly EntityModel[]>;
  readonly relationshipsByContext: Record<string, readonly EntityRelationship[]>;
  readonly allEntities: readonly EntityModel[];
  readonly relationships: readonly EntityRelationship[];
  readonly activeDiagramName: string;
  readonly activePositions: Record<string, DiagramEntityState | { x: number; y: number }>;
  readonly savedDiagramNames: readonly string[];
}
