/**
 * Strict JSON Schema for Google AI Studio (gemini-4-hydrogen) Structured Outputs.
 * Guarantees deterministic, schema-validated UML 2.5 models from any specification document.
 */
export const SPEC_TO_UML_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    projectName: { type: 'STRING' },
    summary: { type: 'STRING' },
    packages: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          description: { type: 'STRING' },
        },
        required: ['name'],
      },
    },
    elements: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          kind: {
            type: 'STRING',
            enum: [
              'class',
              'interface',
              'abstract_class',
              'enum',
              'struct',
              'actor',
              'usecase',
              'component',
              'state',
              'lifeline',
            ],
          },
          packageName: { type: 'STRING' },
          stereotype: { type: 'STRING' },
          description: { type: 'STRING' },
          enumLiterals: { type: 'ARRAY', items: { type: 'STRING' } },
          attributes: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                name: { type: 'STRING' },
                type: { type: 'STRING' },
                visibility: {
                  type: 'STRING',
                  enum: ['public', 'protected', 'private', 'package'],
                },
                isStatic: { type: 'BOOLEAN' },
                isReadOnly: { type: 'BOOLEAN' },
              },
              required: ['name', 'type', 'visibility'],
            },
          },
          operations: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                name: { type: 'STRING' },
                returnType: { type: 'STRING' },
                visibility: {
                  type: 'STRING',
                  enum: ['public', 'protected', 'private', 'package'],
                },
                isStatic: { type: 'BOOLEAN' },
                isAbstract: { type: 'BOOLEAN' },
                parameters: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      name: { type: 'STRING' },
                      type: { type: 'STRING' },
                    },
                    required: ['name', 'type'],
                  },
                },
              },
              required: ['name', 'returnType', 'visibility'],
            },
          },
        },
        required: ['name', 'kind'],
      },
    },
    relations: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          sourceName: { type: 'STRING' },
          targetName: { type: 'STRING' },
          kind: {
            type: 'STRING',
            enum: [
              'association',
              'directional_association',
              'generalization',
              'realization',
              'aggregation',
              'composition',
              'dependency',
              'include',
              'extend',
              'transition',
              'message',
            ],
          },
          label: { type: 'STRING' },
          sourceMultiplicity: { type: 'STRING' },
          targetMultiplicity: { type: 'STRING' },
          targetRole: { type: 'STRING' },
          sequenceOrder: { type: 'INTEGER' },
        },
        required: ['sourceName', 'targetName', 'kind'],
      },
    },
  },
  required: ['projectName', 'elements', 'relations'],
};

export interface AiGeneratedUmlPayload {
  projectName: string;
  summary?: string;
  packages?: Array<{ name: string; description?: string }>;
  elements: Array<{
    name: string;
    kind: string;
    packageName?: string;
    stereotype?: string;
    description?: string;
    enumLiterals?: string[];
    attributes?: Array<{
      name: string;
      type: string;
      visibility: 'public' | 'protected' | 'private' | 'package';
      isStatic?: boolean;
      isReadOnly?: boolean;
    }>;
    operations?: Array<{
      name: string;
      returnType: string;
      visibility: 'public' | 'protected' | 'private' | 'package';
      isStatic?: boolean;
      isAbstract?: boolean;
      parameters?: Array<{ name: string; type: string }>;
    }>;
  }>;
  relations: Array<{
    sourceName: string;
    targetName: string;
    kind: string;
    label?: string;
    sourceMultiplicity?: string;
    targetMultiplicity?: string;
    targetRole?: string;
    sequenceOrder?: number;
  }>;
}
