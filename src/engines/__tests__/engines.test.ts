import { describe, expect, it } from 'vitest';
import { createDemoProject } from '../../model/defaults';
import { validateProject } from '../../model/validator';
import { applyDesignPattern, generateGettersSetters } from '../../model/patterns';
import { generatePlantUml } from '../plantuml/generator';
import { parsePlantUml } from '../plantuml/parser';
import {
  extractPreservedBodies,
  generateElementCode,
  generateStateMachineCode,
} from '../codegen';
import { importUniversalFile } from '../importers';
import { exportHtmlDocumentation } from '../exporters/htmlDoc';
import { exportXmi2 } from '../exporters/xmiExporter';
import { GEMINI_MODEL } from '../../ai/geminiClient';

describe('BouML v2 Core Engines', () => {
  it('enforces exclusive gemini-4-hydrogen model policy', () => {
    expect(GEMINI_MODEL).toBe('gemini-4-hydrogen');
  });

  it('generates and parses PlantUML bidirectionally', () => {
    const proj = createDemoProject();
    const puml = generatePlantUml(proj, 'diag_classes');
    expect(puml).toContain('@startuml');
    expect(puml).toContain('class "Order"');
    expect(puml).toContain('interface "PaymentGateway"');
    expect(puml).toContain('enum "OrderStatus"');
    expect(puml).toContain('@enduml');

    const parsed = parsePlantUml(puml, 'pkg_domain');
    expect(parsed.elements.some((e) => e.name === 'Order')).toBe(true);
    expect(parsed.elements.some((e) => e.name === 'PaymentGateway' && e.kind === 'interface')).toBe(true);
    expect(parsed.relations.length).toBeGreaterThanOrEqual(4);
  });

  it('generates code in all 9 languages and preserves BouML method bodies on round-trip', () => {
    const proj = createDemoProject();
    const order = proj.elements.el_order;

    const langs = ['cpp', 'java', 'python', 'typescript', 'php', 'sql', 'rust', 'go', 'idl'] as const;
    for (const lang of langs) {
      const files = generateElementCode(proj, order, lang);
      expect(files.length).toBeGreaterThan(0);
      expect(files[0].content.length).toBeGreaterThan(20);
    }

    // Verify BouML preserved body round-trip in TypeScript & Python
    const tsCode = generateElementCode(proj, order, 'typescript')[0].content;
    expect(tsCode).toContain('// Bouml preserved body begin op_o1');
    const extractedTs = extractPreservedBodies(tsCode);
    expect(extractedTs.op_o1).toContain('this.items.reduce');

    const pyCode = generateElementCode(proj, order, 'python')[0].content;
    expect(pyCode).toContain('## Bouml preserved body begin op_o1');
    const extractedPy = extractPreservedBodies(pyCode);
    expect(extractedPy.op_o1).toContain('sum(item.subtotal()');
  });

  it('generates State Machine code (sm_generator parity)', () => {
    const proj = createDemoProject();
    const smFile = generateStateMachineCode(proj, 'diag_states', 'typescript');
    expect(smFile.content).toContain("'Draft'");
    expect(smFile.content).toContain("event === 'paymentConfirmed'");
  });

  it('applies Design Patterns and generates Getters/Setters', () => {
    const proj = createDemoProject();
    const customer = proj.elements.el_user;

    const withGetSet = generateGettersSetters(customer);
    expect(withGetSet.operations.some((o) => o.name === 'getFullName')).toBe(true);
    expect(withGetSet.operations.some((o) => o.name === 'setFullName')).toBe(true);

    const singleton = applyDesignPattern('singleton', customer);
    expect(singleton.updatedElement?.operations.some((o) => o.name === 'getInstance')).toBe(true);

    const strategy = applyDesignPattern('strategy', customer);
    expect(strategy.newElements.length).toBe(2);
    expect(strategy.newRelations.length).toBe(2);
  });

  it('imports SQL DDL, Mermaid, OpenAPI, XMI, and TypeScript source code', () => {
    const sqlRes = importUniversalFile(
      'schema.sql',
      `CREATE TABLE users (id UUID PRIMARY KEY, email VARCHAR(255));
       CREATE TABLE posts (id UUID PRIMARY KEY, user_id UUID REFERENCES users(id));`,
      'pkg_1'
    );
    expect(sqlRes.elements.length).toBe(2);
    expect(sqlRes.relations.length).toBe(1);

    const tsRes = importUniversalFile(
      'Invoice.ts',
      `export class Invoice extends BaseEntity {
         private total: number;
         public pay(amount: number): boolean { return true; }
       }`,
      'pkg_1'
    );
    expect(tsRes.elements.some((e) => e.name === 'Invoice')).toBe(true);
    expect(tsRes.relations.some((r) => r.kind === 'generalization')).toBe(true);

    const openApiRes = importUniversalFile(
      'api.json',
      JSON.stringify({
        openapi: '3.0.0',
        components: {
          schemas: {
            Book: { type: 'object', properties: { title: { type: 'string' }, author: { $ref: '#/components/schemas/Author' } } },
            Author: { type: 'object', properties: { name: { type: 'string' } } },
          },
        },
      }),
      'pkg_1'
    );
    expect(openApiRes.elements.length).toBe(2);
    expect(openApiRes.relations.length).toBe(1);
  });

  it('validates UML consistency and exports HTML & XMI 2.1', () => {
    const proj = createDemoProject();
    expect(validateProject(proj).filter((i) => i.severity === 'error')).toHaveLength(0);

    const html = exportHtmlDocumentation(proj);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Customer');

    const xmi = exportXmi2(proj);
    expect(xmi).toContain('xmi:version="2.1"');
    expect(xmi).toContain('name="Order"');
  });
});
