import { createId, UmlElement, UmlOperation, UmlRelation } from './schema';

export type DesignPatternKind =
  | 'singleton'
  | 'factory'
  | 'strategy'
  | 'observer'
  | 'builder';

export interface PatternResult {
  updatedElement?: UmlElement;
  newElements: UmlElement[];
  newRelations: UmlRelation[];
}

export function applyDesignPattern(
  pattern: DesignPatternKind,
  target: UmlElement
): PatternResult {
  switch (pattern) {
    case 'singleton': {
      const updated: UmlElement = {
        ...target,
        stereotype: target.stereotype || 'singleton',
        attributes: [
          ...target.attributes,
          {
            id: createId('att'),
            name: 'instance',
            type: target.name,
            visibility: 'private',
            isStatic: true,
          },
        ],
        operations: [
          {
            id: createId('op'),
            name: target.name,
            returnType: '',
            visibility: 'private',
            parameters: [],
            description: 'Constructeur privé (Singleton)',
          },
          ...target.operations,
          {
            id: createId('op'),
            name: 'getInstance',
            returnType: target.name,
            visibility: 'public',
            isStatic: true,
            parameters: [],
            body: {
              typescript: `if (!${target.name}.instance) {\n  ${target.name}.instance = new ${target.name}();\n}\nreturn ${target.name}.instance;`,
              java: `if (instance == null) {\n  instance = new ${target.name}();\n}\nreturn instance;`,
              cpp: `static ${target.name} instance;\nreturn instance;`,
              python: `if cls._instance is None:\n    cls._instance = cls()\nreturn cls._instance`,
            },
          },
        ],
      };
      return { updatedElement: updated, newElements: [], newRelations: [] };
    }

    case 'factory': {
      const factoryEl: UmlElement = {
        id: createId('el'),
        packageId: target.packageId,
        kind: 'class',
        name: `${target.name}Factory`,
        stereotype: 'Factory',
        taggedValues: {},
        visibility: 'public',
        attributes: [],
        operations: [
          {
            id: createId('op'),
            name: `create${target.name}`,
            returnType: target.name,
            visibility: 'public',
            isStatic: true,
            parameters: [{ id: createId('p'), name: 'kind', type: 'string' }],
          },
        ],
      };
      const rel: UmlRelation = {
        id: createId('rel'),
        kind: 'dependency',
        sourceId: factoryEl.id,
        targetId: target.id,
        stereotype: 'create',
        label: 'creates',
      };
      return { newElements: [factoryEl], newRelations: [rel] };
    }

    case 'strategy': {
      const stratIface: UmlElement = {
        id: createId('el'),
        packageId: target.packageId,
        kind: 'interface',
        name: `${target.name}Strategy`,
        stereotype: 'Strategy',
        taggedValues: {},
        visibility: 'public',
        isAbstract: true,
        attributes: [],
        operations: [
          {
            id: createId('op'),
            name: 'execute',
            returnType: 'void',
            visibility: 'public',
            isAbstract: true,
            parameters: [],
          },
        ],
      };
      const concreteStrat: UmlElement = {
        id: createId('el'),
        packageId: target.packageId,
        kind: 'class',
        name: `Default${target.name}Strategy`,
        taggedValues: {},
        visibility: 'public',
        attributes: [],
        operations: [
          {
            id: createId('op'),
            name: 'execute',
            returnType: 'void',
            visibility: 'public',
            parameters: [],
          },
        ],
      };
      const updated: UmlElement = {
        ...target,
        attributes: [
          ...target.attributes,
          {
            id: createId('att'),
            name: 'strategy',
            type: stratIface.name,
            visibility: 'private',
          },
        ],
        operations: [
          ...target.operations,
          {
            id: createId('op'),
            name: 'setStrategy',
            returnType: 'void',
            visibility: 'public',
            parameters: [{ id: createId('p'), name: 'strategy', type: stratIface.name }],
          },
        ],
      };
      return {
        updatedElement: updated,
        newElements: [stratIface, concreteStrat],
        newRelations: [
          {
            id: createId('rel'),
            kind: 'aggregation',
            sourceId: target.id,
            targetId: stratIface.id,
            sourceMultiplicity: '1',
            targetMultiplicity: '1',
            targetRole: 'strategy',
          },
          {
            id: createId('rel'),
            kind: 'realization',
            sourceId: concreteStrat.id,
            targetId: stratIface.id,
          },
        ],
      };
    }

    case 'observer': {
      const obsIface: UmlElement = {
        id: createId('el'),
        packageId: target.packageId,
        kind: 'interface',
        name: `${target.name}Observer`,
        stereotype: 'Observer',
        taggedValues: {},
        visibility: 'public',
        isAbstract: true,
        attributes: [],
        operations: [
          {
            id: createId('op'),
            name: 'onUpdate',
            returnType: 'void',
            visibility: 'public',
            isAbstract: true,
            parameters: [{ id: createId('p'), name: 'subject', type: target.name }],
          },
        ],
      };
      const updated: UmlElement = {
        ...target,
        operations: [
          ...target.operations,
          {
            id: createId('op'),
            name: 'subscribe',
            returnType: 'void',
            visibility: 'public',
            parameters: [{ id: createId('p'), name: 'observer', type: obsIface.name }],
          },
          {
            id: createId('op'),
            name: 'unsubscribe',
            returnType: 'void',
            visibility: 'public',
            parameters: [{ id: createId('p'), name: 'observer', type: obsIface.name }],
          },
          {
            id: createId('op'),
            name: 'notifyObservers',
            returnType: 'void',
            visibility: 'protected',
            parameters: [],
          },
        ],
      };
      return {
        updatedElement: updated,
        newElements: [obsIface],
        newRelations: [
          {
            id: createId('rel'),
            kind: 'directional_association',
            sourceId: target.id,
            targetId: obsIface.id,
            sourceMultiplicity: '1',
            targetMultiplicity: '0..*',
            targetRole: 'observers',
            label: 'notifies',
          },
        ],
      };
    }

    case 'builder': {
      const builderOps: UmlOperation[] = target.attributes.map((att) => ({
        id: createId('op'),
        name: `with${att.name.charAt(0).toUpperCase()}${att.name.slice(1)}`,
        returnType: `${target.name}Builder`,
        visibility: 'public',
        parameters: [{ id: createId('p'), name: att.name, type: att.type }],
      }));
      builderOps.push({
        id: createId('op'),
        name: 'build',
        returnType: target.name,
        visibility: 'public',
        parameters: [],
      });
      const builderEl: UmlElement = {
        id: createId('el'),
        packageId: target.packageId,
        kind: 'class',
        name: `${target.name}Builder`,
        stereotype: 'Builder',
        taggedValues: {},
        visibility: 'public',
        attributes: target.attributes.map((a) => ({ ...a, id: createId('att'), isReadOnly: false })),
        operations: builderOps,
      };
      return {
        newElements: [builderEl],
        newRelations: [
          {
            id: createId('rel'),
            kind: 'dependency',
            sourceId: builderEl.id,
            targetId: target.id,
            label: 'builds',
          },
        ],
      };
    }
  }
}

export function generateGettersSetters(target: UmlElement): UmlElement {
  const existingNames = new Set(target.operations.map((o) => o.name));
  const additions: UmlOperation[] = [];

  for (const att of target.attributes) {
    const cap = att.name.charAt(0).toUpperCase() + att.name.slice(1);
    const getterName = att.type === 'bool' ? `is${cap}` : `get${cap}`;
    const setterName = `set${cap}`;

    if (!existingNames.has(getterName)) {
      additions.push({
        id: createId('op'),
        name: getterName,
        returnType: att.type,
        visibility: 'public',
        parameters: [],
        isConst: true,
        isGetterOrSetter: true,
        body: {
          typescript: `return this.${att.name};`,
          java: `return this.${att.name};`,
          cpp: `return this->${att.name};`,
          python: `return self._${att.name}`,
          php: `return $this->${att.name};`,
        },
      });
    }

    if (!att.isReadOnly && !existingNames.has(setterName)) {
      additions.push({
        id: createId('op'),
        name: setterName,
        returnType: 'void',
        visibility: 'public',
        parameters: [{ id: createId('p'), name: 'value', type: att.type }],
        isGetterOrSetter: true,
        body: {
          typescript: `this.${att.name} = value;`,
          java: `this.${att.name} = value;`,
          cpp: `this->${att.name} = value;`,
          python: `self._${att.name} = value`,
          php: `$this->${att.name} = $value;`,
        },
      });
    }
  }

  return {
    ...target,
    operations: [...target.operations, ...additions],
  };
}
