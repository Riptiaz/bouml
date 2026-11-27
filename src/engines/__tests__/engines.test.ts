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
import {
  DEFAULT_AI_MODEL,
  callGeminiWithFallback,
  resolveModelChain,
} from '../../ai/geminiClient';
import { computeElkLayout, SEQUENCE_LIFELINE_Y } from '../layout/elkLayout';

describe('BouML v2 Core Engines', () => {
  it('defaults to Auto mode with 3-tier fallback (4-hydrogen -> 3.8-flash -> 3.5-flash-lite) and quickEdit fast path', async () => {
    expect(DEFAULT_AI_MODEL).toBe('auto');
    expect(resolveModelChain('auto', false)).toEqual([
      'gemini-4-hydrogen',
      'gemini-3.8-flash',
      'gemini-3.5-flash-lite',
    ]);
    expect(resolveModelChain('auto', true)).toEqual(['gemini-3.5-flash-lite']);
    expect(resolveModelChain('gemini-3.8-flash', false)).toEqual(['gemini-3.8-flash']);

    const calledModels: string[] = [];
    const res = await callGeminiWithFallback({
      apiKey: 'test-key',
      preferredModel: 'auto',
      systemInstruction: 'sys',
      prompt: 'hi',
      caller: async (o) => {
        calledModels.push(o.model);
        if (o.model === 'gemini-4-hydrogen') {
          throw new Error('429 Too Many Requests');
        }
        if (o.model === 'gemini-3.8-flash') {
          throw new Error('429 Too Many Requests');
        }
        return 'OK_LITE_FALLBACK';
      },
    });
    expect(calledModels).toEqual([
      'gemini-4-hydrogen',
      'gemini-3.8-flash',
      'gemini-3.5-flash-lite',
    ]);
    expect(res.usedFallback).toBe(true);
    expect(res.modelUsed).toBe('gemini-3.5-flash-lite');
    expect(res.text).toBe('OK_LITE_FALLBACK');
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

  it('parses AI compact PlantUML for Boisson with all attributes, constructor, const methods, and C++ codegen', () => {
    const boissonPuml = `@startuml
title Boisson
class Boisson <<Entity>> {
  -nom : string {readOnly}
  -prix : int
  -quantite : int
  +Boisson(nom : string, prix : int, quantite : int)
  +getNom() : string {const}
  +getPrix() : int {const}
  +getQuantite() : int {const}
  +setPrix(nouveauPrix : int) : bool
  +setQuantite(nouvelleQuantite : int) : bool
  +estDisponible() : bool {const}
  +vendre() : bool
  +reapprovisionner(ajout : int) : bool
  +afficher() : void {const}
}
@enduml`;

    const parsed = parsePlantUml(boissonPuml, 'pkg_1');
    expect(parsed.title).toBe('Boisson');
    expect(parsed.elements).toHaveLength(1);

    const boisson = parsed.elements[0];
    expect(boisson.name).toBe('Boisson');
    expect(boisson.stereotype).toBe('Entity');
    expect(boisson.attributes).toHaveLength(3);
    expect(boisson.attributes[0]).toMatchObject({ name: 'nom', type: 'string', visibility: 'private', isReadOnly: true });
    expect(boisson.operations).toHaveLength(10);

    const ctor = boisson.operations.find((o) => o.name === 'Boisson');
    expect(ctor?.returnType).toBe('');
    expect(ctor?.parameters).toHaveLength(3);

    const getNom = boisson.operations.find((o) => o.name === 'getNom');
    expect(getNom?.isConst).toBe(true);
    expect(getNom?.returnType).toBe('string');

    const afficher = boisson.operations.find((o) => o.name === 'afficher');
    expect(afficher?.isConst).toBe(true);

    // Verify C++ header generation matches exact const & constructor signature
    const proj = createDemoProject();
    proj.elements[boisson.id] = boisson;
    const cppFiles = generateElementCode(proj, boisson, 'cpp');
    expect(cppFiles[0].content).toContain('const std::string nom;');
    expect(cppFiles[0].content).toContain('Boisson(std::string nom, int prix, int quantite);');
    expect(cppFiles[0].content).toContain('std::string getNom() const;');
    expect(cppFiles[0].content).toContain('void afficher() const;');
  });

  it('parses compact Copilot method body blocks (===OP:...===)', async () => {
    const { parseMethodBodyBlocks } = await import('../../ai/geminiClient');
    const raw = `===OP:op_1===
if (this->quantite <= 0) return false;
this->quantite--;
return true;
===END===
===OP:getNom===
return this->nom;
===END===`;
    const parsed = parseMethodBodyBlocks(raw);
    expect(parsed.op_1).toContain('this->quantite--');
    expect(parsed.getNom).toBe('return this->nom;');
  });

  it('round-trips sequence combined fragments (alt/else, opt, loop) and lays out lifelines horizontally', async () => {
    const seqPuml = `@startuml
title Séquence Achat
actor "Client" as Client
participant "Commande" as Commande
participant "Stock" as Stock
Client -> Commande : commander()
alt stock > 0
  Commande -> Stock : reserver()
  loop pour chaque article
    Stock -> Stock : decrementer()
  end
else rupture
  Commande --> Client : erreurRupture()
end
opt clientVIP
  Commande -> Client : appliquerRemise()
end
@enduml`;

    const parsed = parsePlantUml(seqPuml, 'pkg_1');
    expect(parsed.diagramKind).toBe('sequence');
    expect(parsed.fragments.length).toBe(3);
    expect(parsed.fragments.map((f) => f.kind)).toEqual(['alt', 'loop', 'opt']);
    expect(parsed.fragments[0].elseCondition).toBe('rupture');

    const proj = createDemoProject();
    for (const el of parsed.elements) proj.elements[el.id] = el;
    for (const r of parsed.relations) proj.relations[r.id] = r;
    proj.diagrams.diag_seq_test = {
      id: 'diag_seq_test',
      packageId: 'pkg_1',
      name: 'Séquence Achat',
      kind: 'sequence',
      nodes: parsed.elements.map((e) => ({ elementId: e.id, x: 0, y: 0 })),
      relationIds: parsed.relations.map((r) => r.id),
      fragments: parsed.fragments,
    };

    const exported = generatePlantUml(proj, 'diag_seq_test');
    expect(exported).toContain('alt stock > 0');
    expect(exported).toContain('else rupture');
    expect(exported).toContain('loop pour chaque article');
    expect(exported).toContain('opt clientVIP');
    expect(exported).toContain('end');

    const laidOut = await computeElkLayout(proj, 'diag_seq_test');
    expect(laidOut).toHaveLength(3);
    // All lifelines aligned horizontally on the exact same top Y row
    expect(laidOut.every((n) => n.y === SEQUENCE_LIFELINE_Y)).toBe(true);
    // Distinct strictly increasing X coordinates
    expect(laidOut[0].x).toBeLessThan(laidOut[1].x);
    expect(laidOut[1].x).toBeLessThan(laidOut[2].x);
  });

  it('fixes {static}, {abstract}, <<extend>>, subsystem rectangles, and composite state containers', async () => {
    const ucPuml = `@startuml
actor "Client" as Client
rectangle "Paiement" {
  usecase "Payer" as Payer
  usecase "AppliquerPromo" as Promo
}
Client --> Payer
Promo ..> Payer : <<extend>>
@enduml`;

    const parsedUc = parsePlantUml(ucPuml, 'pkg_1');
    expect(parsedUc.subsystems).toContain('Paiement');
    const extendRel = parsedUc.relations.find((r) => r.kind === 'extend');
    expect(extendRel).toBeDefined();

    const proj = createDemoProject();
    for (const el of parsedUc.elements) proj.elements[el.id] = el;
    for (const r of parsedUc.relations) proj.relations[r.id] = r;
    proj.diagrams.diag_uc_sub = {
      id: 'diag_uc_sub',
      packageId: 'pkg_1',
      name: 'UC',
      kind: 'usecase',
      nodes: parsedUc.elements.map((e) => ({ elementId: e.id, x: 0, y: 0 })),
      relationIds: parsedUc.relations.map((r) => r.id),
      subsystems: parsedUc.subsystems,
    };
    const ucOut = generatePlantUml(proj, 'diag_uc_sub');
    expect(ucOut).toContain('rectangle "Paiement" {');
    expect(ucOut).toContain('AppliquerPromo ..> Payer : <<extend>>');

    // Composite state container without isolated class node
    const statePuml = `@startuml
state "Train" {
  [*] --> EnGare
  EnGare --> EnMarche : depart
  EnMarche --> [*] : terminus
}
@enduml`;
    const parsedSt = parsePlantUml(statePuml, 'pkg_1');
    expect(parsedSt.elements.some((e) => e.name === 'Train')).toBe(false);
    expect(parsedSt.elements.every((e) => e.stateGroup === 'Train')).toBe(true);

    for (const el of parsedSt.elements) proj.elements[el.id] = el;
    for (const r of parsedSt.relations) proj.relations[r.id] = r;
    proj.diagrams.diag_st_comp = {
      id: 'diag_st_comp',
      packageId: 'pkg_1',
      name: 'Train States',
      kind: 'state',
      nodes: parsedSt.elements.map((e) => ({ elementId: e.id, x: 0, y: 0 })),
      relationIds: parsedSt.relations.map((r) => r.id),
    };
    const stOut = generatePlantUml(proj, 'diag_st_comp');
    expect(stOut).toContain('state "Train" {');
    expect(stOut).not.toContain('state "Train" as Train');

    // Normalize {statique} and {, } bug
    const dirtyClassPuml = `@startuml
class Service {
  {statique} -count : int
  {, } {abstract} +run() : void
}
@enduml`;
    const parsedCls = parsePlantUml(dirtyClassPuml, 'pkg_1');
    expect(parsedCls.elements[0].attributes[0].isStatic).toBe(true);
    expect(parsedCls.elements[0].operations[0].isAbstract).toBe(true);

    const clsEl = parsedCls.elements[0];
    proj.elements[clsEl.id] = clsEl;
    proj.diagrams.diag_cls_clean = {
      id: 'diag_cls_clean',
      packageId: 'pkg_1',
      name: 'Clean',
      kind: 'class',
      nodes: [{ elementId: clsEl.id, x: 0, y: 0 }],
      relationIds: [],
    };
    const clsOut = generatePlantUml(proj, 'diag_cls_clean');
    expect(clsOut).toContain('{static}');
    expect(clsOut).not.toContain('{statique}');
    expect(clsOut).toContain('{abstract}');
    expect(clsOut).not.toContain('{, }');

    // Verify State layout succeeds cleanly
    const stLaidOut = await computeElkLayout(proj, 'diag_st_comp', 'RIGHT');
    expect(stLaidOut.length).toBe(parsedSt.elements.length);
  });

  it('auto-fixes orphan duplicates and validation issues automatically', async () => {
    const { fixAllValidationIssues } = await import('../../model/autoFix');
    const proj = createDemoProject();
    // Inject an unused orphan duplicate of Customer (simulating an AI edit duplicate)
    proj.elements.el_user_orphan_dup = {
      ...proj.elements.el_user,
      id: 'el_user_orphan_dup',
    };
    const beforeIssues = validateProject(proj);
    expect(beforeIssues.some((i) => i.code === 'UML-001')).toBe(true);

    const fixed = fixAllValidationIssues(proj);
    expect(fixed.project.elements.el_user_orphan_dup).toBeUndefined();
    expect(fixed.project.elements.el_user).toBeDefined();
    expect(validateProject(fixed.project).filter((i) => i.code === 'UML-001')).toHaveLength(0);
  });
});
