export type DiagramKind =
  | 'class'
  | 'usecase'
  | 'sequence'
  | 'communication'
  | 'component'
  | 'deployment'
  | 'activity'
  | 'state'
  | 'object';

export type TargetLanguage =
  | 'cpp'
  | 'java'
  | 'python'
  | 'typescript'
  | 'php'
  | 'sql'
  | 'rust'
  | 'go'
  | 'idl';

export type Visibility = 'public' | 'protected' | 'private' | 'package';

export type ElementKind =
  | 'class'
  | 'interface'
  | 'abstract_class'
  | 'enum'
  | 'struct'
  | 'record'
  | 'actor'
  | 'usecase'
  | 'component'
  | 'artifact'
  | 'node'
  | 'state'
  | 'pseudostate'
  | 'activity_action'
  | 'activity_node'
  | 'partition'
  | 'object_instance'
  | 'lifeline'
  | 'note';

export type PseudoStateKind =
  | 'initial'
  | 'final'
  | 'terminate'
  | 'choice'
  | 'fork'
  | 'join'
  | 'history'
  | 'deep_history';

export type RelationKind =
  | 'association'
  | 'directional_association'
  | 'generalization'
  | 'realization'
  | 'aggregation'
  | 'composition'
  | 'dependency'
  | 'include'
  | 'extend'
  | 'transition'
  | 'flow'
  | 'message';

export type ParamDirection = 'in' | 'out' | 'inout' | 'return';

export interface FormalParameter {
  name: string;
  extendsType?: string;
  defaultType?: string;
}

export interface UmlParameter {
  id: string;
  name: string;
  type: string;
  direction?: ParamDirection;
  defaultValue?: string;
}

export interface UmlAttribute {
  id: string;
  name: string;
  type: string;
  visibility: Visibility;
  multiplicity?: string;
  defaultValue?: string;
  isStatic?: boolean;
  isReadOnly?: boolean;
  isVolatile?: boolean;
  isDerived?: boolean;
  stereotype?: string;
  description?: string;
}

export interface UmlOperation {
  id: string;
  name: string;
  returnType: string;
  visibility: Visibility;
  parameters: UmlParameter[];
  exceptions?: string[];
  isStatic?: boolean;
  isAbstract?: boolean;
  isFinal?: boolean;
  isVirtual?: boolean;
  isConst?: boolean;
  isInline?: boolean;
  isAsync?: boolean;
  isSynchronized?: boolean;
  isGetterOrSetter?: boolean;
  stereotype?: string;
  description?: string;
  body?: Partial<Record<TargetLanguage, string>>;
}

export interface UmlElement {
  id: string;
  packageId: string;
  kind: ElementKind;
  name: string;
  stereotype?: string;
  taggedValues: Record<string, string>;
  description?: string;
  constraint?: string;
  visibility: Visibility;
  isAbstract?: boolean;
  isFinal?: boolean;
  isActive?: boolean;
  generics?: FormalParameter[];
  attributes: UmlAttribute[];
  operations: UmlOperation[];
  enumLiterals?: string[];
  pseudoStateKind?: PseudoStateKind;
  stateEntry?: string;
  stateDo?: string;
  stateExit?: string;
  languageOverrides?: Partial<
    Record<
      TargetLanguage,
      {
        external?: boolean;
        annotations?: string[];
        customDecl?: string;
      }
    >
  >;
}

export interface UmlRelation {
  id: string;
  kind: RelationKind;
  sourceId: string;
  targetId: string;
  label?: string;
  stereotype?: string;
  sourceRole?: string;
  targetRole?: string;
  sourceMultiplicity?: string;
  targetMultiplicity?: string;
  guard?: string;
  trigger?: string;
  effect?: string;
  messageKind?: 'sync' | 'async' | 'return' | 'create' | 'destroy';
  sequenceOrder?: number;
}

export interface DiagramNodePosition {
  elementId: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export interface UmlDiagram {
  id: string;
  packageId: string;
  name: string;
  kind: DiagramKind;
  description?: string;
  nodes: DiagramNodePosition[];
  relationIds: string[];
  layoutDirection?: 'DOWN' | 'RIGHT' | 'UP' | 'LEFT';
}

export interface UmlPackage {
  id: string;
  parentId: string | null;
  name: string;
  stereotype?: string;
  namespace?: string;
  description?: string;
}

export interface UmlStereotypeDef {
  name: string;
  appliesTo: ElementKind[];
  color?: string;
  taggedValueKeys: string[];
  description?: string;
}

export interface UmlProfile {
  id: string;
  name: string;
  description?: string;
  stereotypes: UmlStereotypeDef[];
}

export interface GenerationSettings {
  indentSize: number;
  useTabs: boolean;
  preserveBodies: boolean;
  generateComments: boolean;
  cppHeaderGuardStyle: 'pragma' | 'ifndef';
  cppNamespaceFromPackage: boolean;
  javaPackagePrefix: string;
  pythonTypeHints: boolean;
  sqlDialect: 'postgresql' | 'mysql' | 'sqlite';
}

export interface BoumlProject {
  schemaVersion: '2.0';
  id: string;
  name: string;
  description: string;
  defaultLanguage: TargetLanguage;
  packages: UmlPackage[];
  elements: Record<string, UmlElement>;
  relations: Record<string, UmlRelation>;
  diagrams: Record<string, UmlDiagram>;
  profiles: UmlProfile[];
  preservedBodies: Record<string, Partial<Record<TargetLanguage, string>>>;
  generationSettings: GenerationSettings;
}

export interface ValidationIssue {
  id: string;
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  elementId?: string;
  relationId?: string;
  diagramId?: string;
  suggestion?: string;
}

export const DIAGRAM_LABELS: Record<DiagramKind, string> = {
  class: 'Diagramme de Classes',
  usecase: 'Cas d\'Utilisation',
  sequence: 'Diagramme de Séquence',
  communication: 'Diagramme de Communication',
  component: 'Diagramme de Composants',
  deployment: 'Diagramme de Déploiement',
  activity: 'Diagramme d\'Activités',
  state: 'Diagramme d\'États',
  object: 'Diagramme d\'Objets',
};

export const LANGUAGE_LABELS: Record<TargetLanguage, string> = {
  cpp: 'C++ (.h / .cpp)',
  java: 'Java',
  python: 'Python',
  typescript: 'TypeScript',
  php: 'PHP',
  sql: 'SQL (DDL)',
  rust: 'Rust',
  go: 'Go',
  idl: 'CORBA IDL',
};

export const COMMON_TYPES = [
  'void',
  'string',
  'int',
  'long',
  'float',
  'double',
  'bool',
  'Date',
  'DateTime',
  'UUID',
  'byte[]',
  'List<string>',
  'Map<string, any>',
  'Optional<string>',
];

export const COMMON_MULTIPLICITIES = [
  '',
  '1',
  '0..1',
  '0..*',
  '1..*',
  '*',
  '2',
  '0..n',
];

export const VISIBILITY_SYMBOLS: Record<Visibility, string> = {
  public: '+',
  protected: '#',
  private: '-',
  package: '~',
};

export function createId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const ts = Date.now().toString(36).slice(-4);
  return `${prefix}_${ts}${rand}`;
}
