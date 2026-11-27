import {
  BoumlProject,
  TargetLanguage,
  UmlElement,
  UmlRelation,
} from '../../model/schema';
import { wrapPreservedBody } from './preservedBody';
import { mapType } from './typeMapper';

export interface GeneratedFile {
  filename: string;
  language: TargetLanguage;
  content: string;
}

function getParents(project: BoumlProject, el: UmlElement): {
  extendsNames: string[];
  implementsNames: string[];
} {
  const extendsNames: string[] = [];
  const implementsNames: string[] = [];
  for (const rel of Object.values(project.relations)) {
    if (rel.sourceId !== el.id) continue;
    const tgt = project.elements[rel.targetId];
    if (!tgt) continue;
    if (rel.kind === 'generalization') extendsNames.push(tgt.name);
    if (rel.kind === 'realization') implementsNames.push(tgt.name);
  }
  return { extendsNames, implementsNames };
}

function getAssociationFields(
  project: BoumlProject,
  el: UmlElement
): Array<{ name: string; type: string; isCollection: boolean }> {
  const fields: Array<{ name: string; type: string; isCollection: boolean }> = [];
  for (const rel of Object.values(project.relations)) {
    if (
      rel.sourceId === el.id &&
      (rel.kind === 'directional_association' ||
        rel.kind === 'composition' ||
        rel.kind === 'aggregation' ||
        rel.kind === 'association')
    ) {
      const tgt = project.elements[rel.targetId];
      if (!tgt) continue;
      const mult = rel.targetMultiplicity ?? '1';
      const isCollection = mult.includes('*') || mult.includes('n');
      const roleName =
        rel.targetRole ||
        `${tgt.name.charAt(0).toLowerCase()}${tgt.name.slice(1)}${isCollection ? 's' : ''}`;
      fields.push({
        name: roleName,
        type: isCollection ? `List<${tgt.name}>` : tgt.name,
        isCollection,
      });
    }
  }
  return fields;
}

function resolveBody(
  project: BoumlProject,
  opId: string,
  inlineBody: Partial<Record<TargetLanguage, string>> | undefined,
  lang: TargetLanguage
): string | undefined {
  return project.preservedBodies[opId]?.[lang] ?? inlineBody?.[lang];
}

export function generateCpp(project: BoumlProject, el: UmlElement): GeneratedFile[] {
  const preserve = project.generationSettings.preserveBodies;
  const { extendsNames, implementsNames } = getParents(project, el);
  const bases = [...extendsNames, ...implementsNames];
  const pkg = project.packages.find((p) => p.id === el.packageId);
  const ns = project.generationSettings.cppNamespaceFromPackage && pkg?.namespace ? pkg.namespace.replace(/\./g, '::') : '';

  if (el.kind === 'enum') {
    const header = [
      '#pragma once',
      '',
      ns ? `namespace ${ns} {` : '',
      `enum class ${el.name} {`,
      ...(el.enumLiterals ?? ['UNKNOWN']).map((l) => `  ${l},`),
      '};',
      ns ? `} // namespace ${ns}` : '',
    ]
      .filter((l, i, arr) => l !== '' || arr[i - 1] !== '')
      .join('\n');
    return [{ filename: `${el.name}.h`, language: 'cpp', content: header }];
  }

  const generics =
    el.generics && el.generics.length > 0
      ? `template <${el.generics.map((g) => `typename ${g.name}`).join(', ')}>\n`
      : '';
  const inheritClause = bases.length > 0 ? ` : ${bases.map((b) => `public ${b}`).join(', ')}` : '';
  const assocFields = getAssociationFields(project, el);

  const headerLines: string[] = [
    project.generationSettings.cppHeaderGuardStyle === 'pragma'
      ? '#pragma once'
      : `#ifndef ${el.name.toUpperCase()}_H\n#define ${el.name.toUpperCase()}_H`,
    '#include <string>',
    '#include <vector>',
    '#include <memory>',
    '#include <optional>',
    '',
  ];

  if (ns) headerLines.push(`namespace ${ns} {`, '');
  if (el.description && project.generationSettings.generateComments) {
    headerLines.push(`/// ${el.description}`);
  }
  headerLines.push(`${generics}${el.kind === 'struct' ? 'struct' : 'class'} ${el.name}${inheritClause} {`);

  const byVis: Record<string, string[]> = { public: [], protected: [], private: [] };

  for (const att of el.attributes) {
    const v = att.visibility === 'package' ? 'public' : att.visibility;
    const prefix = [att.isStatic ? 'static' : '', att.isReadOnly ? 'const' : ''].filter(Boolean).join(' ');
    const def = att.defaultValue ? ` = ${att.defaultValue}` : '';
    byVis[v].push(`  ${prefix ? prefix + ' ' : ''}${mapType(att.type, 'cpp')} ${att.name}${def};`);
  }

  for (const af of assocFields) {
    byVis.private.push(`  ${mapType(af.type, 'cpp')} ${af.name};`);
  }

  if (el.kind === 'interface' || el.isAbstract) {
    byVis.public.push(`  virtual ~${el.name}() = default;`);
  }

  for (const op of el.operations) {
    const v = op.visibility === 'package' ? 'public' : op.visibility;
    const params = op.parameters.map((p) => `${mapType(p.type, 'cpp')} ${p.name}`).join(', ');
    const isCtor = op.name === el.name;
    const virt = op.isVirtual || op.isAbstract || el.kind === 'interface' ? 'virtual ' : '';
    const stat = op.isStatic ? 'static ' : '';
    const ret = isCtor ? '' : `${mapType(op.returnType, 'cpp')} `;
    const cnst = op.isConst ? ' const' : '';
    const pure = op.isAbstract || el.kind === 'interface' ? ' = 0' : '';
    byVis[v].push(`  ${stat}${virt}${ret}${op.name}(${params})${cnst}${pure};`);
  }

  for (const vis of ['public', 'protected', 'private']) {
    if (byVis[vis].length > 0) {
      headerLines.push(`${vis}:`);
      headerLines.push(...byVis[vis]);
    }
  }

  headerLines.push('};');
  if (ns) headerLines.push('', `} // namespace ${ns}`);
  if (project.generationSettings.cppHeaderGuardStyle === 'ifndef') {
    headerLines.push(`#endif // ${el.name.toUpperCase()}_H`);
  }

  const files: GeneratedFile[] = [
    { filename: `${el.name}.h`, language: 'cpp', content: headerLines.join('\n') },
  ];

  // Generate .cpp implementation if concrete operations exist
  const concreteOps = el.operations.filter((o) => !o.isAbstract && el.kind !== 'interface');
  if (concreteOps.length > 0) {
    const cppLines: string[] = [`#include "${el.name}.h"`, ''];
    if (ns) cppLines.push(`namespace ${ns} {`, '');
    for (const op of concreteOps) {
      const params = op.parameters.map((p) => `${mapType(p.type, 'cpp')} ${p.name}`).join(', ');
      const isCtor = op.name === el.name;
      const ret = isCtor ? '' : `${mapType(op.returnType, 'cpp')} `;
      const cnst = op.isConst ? ' const' : '';
      cppLines.push(`${ret}${el.name}::${op.name}(${params})${cnst} {`);
      cppLines.push(wrapPreservedBody('cpp', op.id, resolveBody(project, op.id, op.body, 'cpp'), '  ', preserve));
      cppLines.push('}', '');
    }
    if (ns) cppLines.push(`} // namespace ${ns}`);
    files.push({ filename: `${el.name}.cpp`, language: 'cpp', content: cppLines.join('\n') });
  }

  return files;
}

export function generateJava(project: BoumlProject, el: UmlElement): GeneratedFile[] {
  const preserve = project.generationSettings.preserveBodies;
  const { extendsNames, implementsNames } = getParents(project, el);
  const pkg = project.packages.find((p) => p.id === el.packageId);
  const pkgName = pkg?.namespace || project.generationSettings.javaPackagePrefix;

  const lines: string[] = [`package ${pkgName};`, '', 'import java.util.*;', 'import java.time.*;', ''];
  if (el.description && project.generationSettings.generateComments) {
    lines.push(`/** ${el.description} */`);
  }
  if (el.kind === 'enum') {
    lines.push(`public enum ${el.name} {`);
    lines.push(`  ${(el.enumLiterals ?? ['UNKNOWN']).join(',\n  ')}`);
    lines.push('}');
    return [{ filename: `${el.name}.java`, language: 'java', content: lines.join('\n') }];
  }

  const kw = el.kind === 'interface' ? 'interface' : el.isAbstract || el.kind === 'abstract_class' ? 'abstract class' : 'class';
  const gen = el.generics?.length ? `<${el.generics.map((g) => g.name).join(', ')}>` : '';
  const ext = extendsNames.length ? ` extends ${extendsNames[0]}` : '';
  const impl = implementsNames.length ? ` implements ${implementsNames.join(', ')}` : '';
  lines.push(`public ${kw} ${el.name}${gen}${ext}${impl} {`);

  for (const att of el.attributes) {
    const vis = att.visibility === 'package' ? '' : `${att.visibility} `;
    const stat = att.isStatic ? 'static ' : '';
    const ro = att.isReadOnly ? 'final ' : '';
    const def = att.defaultValue ? ` = ${att.defaultValue}` : '';
    lines.push(`  ${vis}${stat}${ro}${mapType(att.type, 'java')} ${att.name}${def};`);
  }

  for (const af of getAssociationFields(project, el)) {
    lines.push(`  private ${mapType(af.type, 'java')} ${af.name};`);
  }

  if (el.attributes.length > 0) lines.push('');

  for (const op of el.operations) {
    const vis = el.kind === 'interface' ? '' : op.visibility === 'package' ? '' : `${op.visibility} `;
    const mods = [
      op.isStatic ? 'static' : '',
      op.isAbstract && el.kind !== 'interface' ? 'abstract' : '',
      op.isFinal ? 'final' : '',
      op.isSynchronized ? 'synchronized' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const params = op.parameters.map((p) => `${mapType(p.type, 'java')} ${p.name}`).join(', ');
    const isCtor = op.name === el.name;
    const ret = isCtor ? '' : `${mapType(op.returnType, 'java')} `;
    if (op.isAbstract || el.kind === 'interface') {
      lines.push(`  ${vis}${mods ? mods + ' ' : ''}${ret}${op.name}(${params});`);
    } else {
      lines.push(`  ${vis}${mods ? mods + ' ' : ''}${ret}${op.name}(${params}) {`);
      lines.push(wrapPreservedBody('java', op.id, resolveBody(project, op.id, op.body, 'java'), '    ', preserve));
      lines.push('  }', '');
    }
  }

  lines.push('}');
  return [{ filename: `${el.name}.java`, language: 'java', content: lines.join('\n') }];
}

export function generateTypeScript(project: BoumlProject, el: UmlElement): GeneratedFile[] {
  const preserve = project.generationSettings.preserveBodies;
  const { extendsNames, implementsNames } = getParents(project, el);
  const lines: string[] = [];

  if (el.description && project.generationSettings.generateComments) {
    lines.push(`/** ${el.description} */`);
  }

  if (el.kind === 'enum') {
    lines.push(`export enum ${el.name} {`);
    for (const lit of el.enumLiterals ?? ['UNKNOWN']) {
      lines.push(`  ${lit} = '${lit}',`);
    }
    lines.push('}');
    return [{ filename: `${el.name}.ts`, language: 'typescript', content: lines.join('\n') }];
  }

  const kw = el.kind === 'interface' ? 'interface' : el.isAbstract || el.kind === 'abstract_class' ? 'abstract class' : 'class';
  const gen = el.generics?.length ? `<${el.generics.map((g) => g.name).join(', ')}>` : '';
  const ext = extendsNames.length ? ` extends ${extendsNames.join(', ')}` : '';
  const impl = implementsNames.length && el.kind !== 'interface' ? ` implements ${implementsNames.join(', ')}` : '';
  lines.push(`export ${kw} ${el.name}${gen}${ext}${impl} {`);

  for (const att of el.attributes) {
    const vis = el.kind === 'interface' ? '' : `${att.visibility === 'package' ? 'public' : att.visibility} `;
    const stat = att.isStatic ? 'static ' : '';
    const ro = att.isReadOnly ? 'readonly ' : '';
    const def = att.defaultValue && el.kind !== 'interface' ? ` = ${att.defaultValue}` : '';
    lines.push(`  ${vis}${stat}${ro}${att.name}: ${mapType(att.type, 'typescript')}${def};`);
  }

  for (const af of getAssociationFields(project, el)) {
    if (el.kind !== 'interface') {
      lines.push(`  private ${af.name}: ${mapType(af.type, 'typescript')} = ${af.isCollection ? '[]' : 'undefined as any'};`);
    }
  }

  if (el.attributes.length > 0 && el.operations.length > 0) lines.push('');

  for (const op of el.operations) {
    const vis = el.kind === 'interface' ? '' : `${op.visibility === 'package' ? 'public' : op.visibility} `;
    const mods = [
      op.isStatic ? 'static' : '',
      op.isAbstract && el.kind !== 'interface' ? 'abstract' : '',
      op.isAsync ? 'async' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const params = op.parameters.map((p) => `${p.name}: ${mapType(p.type, 'typescript')}`).join(', ');
    const isCtor = op.name === el.name;
    const opName = isCtor ? 'constructor' : op.name;
    const ret = isCtor ? '' : `: ${op.isAsync ? `Promise<${mapType(op.returnType, 'typescript')}>` : mapType(op.returnType, 'typescript')}`;

    if (el.kind === 'interface' || op.isAbstract) {
      lines.push(`  ${vis}${mods ? mods + ' ' : ''}${opName}(${params})${ret};`);
    } else {
      lines.push(`  ${vis}${mods ? mods + ' ' : ''}${opName}(${params})${ret} {`);
      lines.push(wrapPreservedBody('typescript', op.id, resolveBody(project, op.id, op.body, 'typescript'), '    ', preserve));
      lines.push('  }', '');
    }
  }

  lines.push('}');
  return [{ filename: `${el.name}.ts`, language: 'typescript', content: lines.join('\n') }];
}

export function generatePython(project: BoumlProject, el: UmlElement): GeneratedFile[] {
  const preserve = project.generationSettings.preserveBodies;
  const { extendsNames, implementsNames } = getParents(project, el);
  const bases = [...extendsNames, ...implementsNames];
  const lines: string[] = ['from __future__ import annotations'];

  if (el.kind === 'enum') {
    lines.push('from enum import Enum', '', `class ${el.name}(Enum):`);
    for (const lit of el.enumLiterals ?? ['UNKNOWN']) {
      lines.push(`    ${lit} = "${lit}"`);
    }
    return [{ filename: `${el.name.toLowerCase()}.py`, language: 'python', content: lines.join('\n') }];
  }

  if (el.kind === 'interface' || el.isAbstract) {
    lines.push('from abc import ABC, abstractmethod');
    if (!bases.includes('ABC')) bases.unshift('ABC');
  }
  lines.push('from typing import Any, Optional', 'from uuid import UUID', 'from datetime import date, datetime', '');

  const baseClause = bases.length > 0 ? `(${bases.join(', ')})` : '';
  lines.push(`class ${el.name}${baseClause}:`);
  if (el.description && project.generationSettings.generateComments) {
    lines.push(`    """${el.description}"""`);
  }

  const assocFields = getAssociationFields(project, el);
  if (el.attributes.length > 0 || assocFields.length > 0) {
    const initParams = el.attributes
      .filter((a) => !a.isStatic)
      .map((a) => `${a.name}: ${mapType(a.type, 'python')}${a.defaultValue ? ` = ${a.defaultValue}` : ''}`)
      .join(', ');
    lines.push(`    def __init__(self${initParams ? ', ' + initParams : ''}) -> None:`);
    for (const att of el.attributes.filter((a) => !a.isStatic)) {
      const prefix = att.visibility === 'private' ? '_' : '';
      lines.push(`        self.${prefix}${att.name}: ${mapType(att.type, 'python')} = ${att.name}`);
    }
    for (const af of assocFields) {
      lines.push(`        self._${af.name}: ${mapType(af.type, 'python')} = ${af.isCollection ? '[]' : 'None'}`);
    }
    lines.push('');
  }

  if (el.operations.length === 0 && el.attributes.length === 0) {
    lines.push('    pass');
  }

  for (const op of el.operations) {
    if (op.isStatic) lines.push('    @classmethod');
    if (op.isAbstract || el.kind === 'interface') lines.push('    @abstractmethod');
    const firstArg = op.isStatic ? 'cls' : 'self';
    const params = [
      firstArg,
      ...op.parameters.map((p) => `${p.name}: ${mapType(p.type, 'python')}`),
    ].join(', ');
    const asyncKw = op.isAsync ? 'async ' : '';
    lines.push(`    ${asyncKw}def ${op.name}(${params}) -> ${mapType(op.returnType, 'python')}:`);
    lines.push(wrapPreservedBody('python', op.id, resolveBody(project, op.id, op.body, 'python'), '        ', preserve));
    lines.push('');
  }

  return [{ filename: `${el.name.toLowerCase()}.py`, language: 'python', content: lines.join('\n') }];
}

export function generatePhp(project: BoumlProject, el: UmlElement): GeneratedFile[] {
  const preserve = project.generationSettings.preserveBodies;
  const { extendsNames, implementsNames } = getParents(project, el);
  const pkg = project.packages.find((p) => p.id === el.packageId);
  const ns = pkg?.namespace ? pkg.namespace.replace(/\./g, '\\') : 'App';
  const lines: string[] = ['<?php', 'declare(strict_types=1);', '', `namespace ${ns};`, ''];

  if (el.kind === 'enum') {
    lines.push(`enum ${el.name}: string {`);
    for (const lit of el.enumLiterals ?? ['UNKNOWN']) {
      lines.push(`    case ${lit} = '${lit}';`);
    }
    lines.push('}');
    return [{ filename: `${el.name}.php`, language: 'php', content: lines.join('\n') }];
  }

  const kw = el.kind === 'interface' ? 'interface' : el.isAbstract ? 'abstract class' : 'class';
  const ext = extendsNames.length ? ` extends ${extendsNames[0]}` : '';
  const impl = implementsNames.length ? ` implements ${implementsNames.join(', ')}` : '';
  lines.push(`${kw} ${el.name}${ext}${impl} {`);

  for (const att of el.attributes) {
    const vis = att.visibility === 'package' ? 'public' : att.visibility;
    const stat = att.isStatic ? 'static ' : '';
    const ro = att.isReadOnly ? 'readonly ' : '';
    lines.push(`    ${vis} ${stat}${ro}${mapType(att.type, 'php')} $${att.name};`);
  }
  lines.push('');
  for (const op of el.operations) {
    const vis = op.visibility === 'package' ? 'public' : op.visibility;
    const stat = op.isStatic ? 'static ' : '';
    const abs = op.isAbstract && el.kind !== 'interface' ? 'abstract ' : '';
    const params = op.parameters.map((p) => `${mapType(p.type, 'php')} $${p.name}`).join(', ');
    const ret = op.name === el.name ? '' : `: ${mapType(op.returnType, 'php')}`;
    const fnName = op.name === el.name ? '__construct' : op.name;
    if (el.kind === 'interface' || op.isAbstract) {
      lines.push(`    ${abs}${vis} ${stat}function ${fnName}(${params})${ret};`);
    } else {
      lines.push(`    ${vis} ${stat}function ${fnName}(${params})${ret} {`);
      lines.push(wrapPreservedBody('php', op.id, resolveBody(project, op.id, op.body, 'php'), '        ', preserve));
      lines.push('    }', '');
    }
  }
  lines.push('}');
  return [{ filename: `${el.name}.php`, language: 'php', content: lines.join('\n') }];
}

export function generateSql(project: BoumlProject, el: UmlElement): GeneratedFile[] {
  const tableName = (el.taggedValues.table || el.name).toLowerCase();
  if (el.kind === 'enum') {
    const vals = (el.enumLiterals ?? ['UNKNOWN']).map((v) => `'${v}'`).join(', ');
    return [
      {
        filename: `${tableName}.sql`,
        language: 'sql',
        content: `CREATE TYPE ${tableName} AS ENUM (${vals});`,
      },
    ];
  }

  const cols: string[] = [];
  let hasId = false;
  for (const att of el.attributes) {
    const isPk = att.name.toLowerCase() === 'id';
    if (isPk) hasId = true;
    cols.push(`  ${att.name} ${mapType(att.type, 'sql')}${isPk ? ' PRIMARY KEY' : ' NOT NULL'}`);
  }
  if (!hasId) {
    cols.unshift('  id UUID PRIMARY KEY');
  }

  // Foreign keys from incoming compositions / associations
  for (const rel of Object.values(project.relations)) {
    if (rel.targetId === el.id && (rel.kind === 'composition' || rel.kind === 'directional_association')) {
      const parent = project.elements[rel.sourceId];
      if (parent && parent.kind === 'class') {
        const parentTable = (parent.taggedValues.table || parent.name).toLowerCase();
        cols.push(`  ${parentTable}_id UUID REFERENCES ${parentTable}(id) ON DELETE CASCADE`);
      }
    }
  }

  const content = [
    `-- Table générée par BouML v2 pour ${el.name}`,
    `CREATE TABLE ${tableName} (`,
    cols.join(',\n'),
    ');',
  ].join('\n');

  return [{ filename: `${tableName}.sql`, language: 'sql', content }];
}

export function generateRust(project: BoumlProject, el: UmlElement): GeneratedFile[] {
  const preserve = project.generationSettings.preserveBodies;
  const lines: string[] = [];

  if (el.kind === 'enum') {
    lines.push('#[derive(Debug, Clone, PartialEq, Eq)]', `pub enum ${el.name} {`);
    for (const lit of el.enumLiterals ?? ['Unknown']) {
      lines.push(`    ${lit},`);
    }
    lines.push('}');
    return [{ filename: `${el.name.toLowerCase()}.rs`, language: 'rust', content: lines.join('\n') }];
  }

  if (el.kind === 'interface') {
    lines.push(`pub trait ${el.name} {`);
    for (const op of el.operations) {
      const params = [
        op.isStatic ? '' : op.isConst ? '&self' : '&mut self',
        ...op.parameters.map((p) => `${p.name}: ${mapType(p.type, 'rust')}`),
      ]
        .filter(Boolean)
        .join(', ');
      const ret = op.returnType && op.returnType !== 'void' ? ` -> ${mapType(op.returnType, 'rust')}` : '';
      lines.push(`    fn ${op.name}(${params})${ret};`);
    }
    lines.push('}');
    return [{ filename: `${el.name.toLowerCase()}.rs`, language: 'rust', content: lines.join('\n') }];
  }

  lines.push('#[derive(Debug, Clone)]', `pub struct ${el.name} {`);
  for (const att of el.attributes) {
    const pub = att.visibility === 'public' ? 'pub ' : '';
    lines.push(`    ${pub}${att.name}: ${mapType(att.type, 'rust')},`);
  }
  lines.push('}', '');

  if (el.operations.length > 0) {
    lines.push(`impl ${el.name} {`);
    for (const op of el.operations) {
      const pub = op.visibility === 'public' ? 'pub ' : '';
      const asyncKw = op.isAsync ? 'async ' : '';
      const params = [
        op.isStatic ? '' : op.isConst ? '&self' : '&mut self',
        ...op.parameters.map((p) => `${p.name}: ${mapType(p.type, 'rust')}`),
      ]
        .filter(Boolean)
        .join(', ');
      const ret = op.returnType && op.returnType !== 'void' ? ` -> ${mapType(op.returnType, 'rust')}` : '';
      lines.push(`    ${pub}${asyncKw}fn ${op.name}(${params})${ret} {`);
      lines.push(wrapPreservedBody('rust', op.id, resolveBody(project, op.id, op.body, 'rust'), '        ', preserve));
      lines.push('    }', '');
    }
    lines.push('}');
  }

  return [{ filename: `${el.name.toLowerCase()}.rs`, language: 'rust', content: lines.join('\n') }];
}

export function generateGo(project: BoumlProject, el: UmlElement): GeneratedFile[] {
  const preserve = project.generationSettings.preserveBodies;
  const pkg = project.packages.find((p) => p.id === el.packageId);
  const pkgName = (pkg?.name || 'domain').toLowerCase().replace(/[^a-z0-9]/g, '');
  const lines: string[] = [`package ${pkgName}`, ''];

  if (el.kind === 'interface') {
    lines.push(`type ${el.name} interface {`);
    for (const op of el.operations) {
      const name = op.name.charAt(0).toUpperCase() + op.name.slice(1);
      const params = op.parameters.map((p) => `${p.name} ${mapType(p.type, 'go')}`).join(', ');
      const ret = mapType(op.returnType, 'go');
      lines.push(`\t${name}(${params})${ret ? ' ' + ret : ''}`);
    }
    lines.push('}');
    return [{ filename: `${el.name.toLowerCase()}.go`, language: 'go', content: lines.join('\n') }];
  }

  lines.push(`type ${el.name} struct {`);
  for (const att of el.attributes) {
    const fieldName =
      att.visibility === 'public'
        ? att.name.charAt(0).toUpperCase() + att.name.slice(1)
        : att.name;
    lines.push(`\t${fieldName} ${mapType(att.type, 'go')}`);
  }
  lines.push('}', '');

  for (const op of el.operations) {
    const fnName =
      op.visibility === 'public'
        ? op.name.charAt(0).toUpperCase() + op.name.slice(1)
        : op.name;
    const params = op.parameters.map((p) => `${p.name} ${mapType(p.type, 'go')}`).join(', ');
    const ret = mapType(op.returnType, 'go');
    lines.push(`func (self *${el.name}) ${fnName}(${params})${ret ? ' ' + ret : ''} {`);
    lines.push(wrapPreservedBody('go', op.id, resolveBody(project, op.id, op.body, 'go'), '\t', preserve));
    lines.push('}', '');
  }

  return [{ filename: `${el.name.toLowerCase()}.go`, language: 'go', content: lines.join('\n') }];
}

export function generateIdl(project: BoumlProject, el: UmlElement): GeneratedFile[] {
  const pkg = project.packages.find((p) => p.id === el.packageId);
  const modName = pkg?.name || 'Module';
  const lines: string[] = [`module ${modName} {`];

  if (el.kind === 'enum') {
    lines.push(`  enum ${el.name} { ${(el.enumLiterals ?? ['UNKNOWN']).join(', ')} };`);
  } else if (el.kind === 'struct') {
    lines.push(`  struct ${el.name} {`);
    for (const att of el.attributes) {
      lines.push(`    ${mapType(att.type, 'idl')} ${att.name};`);
    }
    lines.push('  };');
  } else {
    lines.push(`  interface ${el.name} {`);
    for (const att of el.attributes) {
      lines.push(`    ${att.isReadOnly ? 'readonly ' : ''}attribute ${mapType(att.type, 'idl')} ${att.name};`);
    }
    for (const op of el.operations) {
      const params = op.parameters
        .map((p) => `${p.direction || 'in'} ${mapType(p.type, 'idl')} ${p.name}`)
        .join(', ');
      lines.push(`    ${mapType(op.returnType, 'idl')} ${op.name}(${params});`);
    }
    lines.push('  };');
  }

  lines.push('};');
  return [{ filename: `${el.name}.idl`, language: 'idl', content: lines.join('\n') }];
}

/**
 * Generates State Machine code (BouML sm_generator plug-out parity)
 */
export function generateStateMachineCode(
  project: BoumlProject,
  diagramId: string,
  lang: TargetLanguage
): GeneratedFile {
  const diagram = project.diagrams[diagramId];
  const states = (diagram?.nodes ?? [])
    .map((n) => project.elements[n.elementId])
    .filter((e): e is UmlElement => Boolean(e && e.kind === 'state'));
  const transitions: UmlRelation[] = (diagram?.relationIds ?? [])
    .map((id) => project.relations[id])
    .filter((r): r is UmlRelation => Boolean(r && r.kind === 'transition'));

  const name = (diagram?.name || 'StateMachine').replace(/[^A-Za-z0-9]/g, '');

  if (lang === 'python') {
    const lines = [
      'from enum import Enum',
      '',
      `class ${name}State(Enum):`,
      ...(states.length ? states.map((s) => `    ${s.name.toUpperCase()} = "${s.name}"`) : ['    IDLE = "Idle"']),
      '',
      `class ${name}Machine:`,
      `    def __init__(self) -> None:`,
      `        self.state = ${name}State.${(states[0]?.name || 'IDLE').toUpperCase()}`,
      '',
      '    def dispatch(self, event: str) -> None:',
    ];
    for (const tr of transitions) {
      const src = project.elements[tr.sourceId];
      const tgt = project.elements[tr.targetId];
      if (!src || !tgt || src.kind !== 'state' || tgt.kind !== 'state') continue;
      lines.push(
        `        if self.state == ${name}State.${src.name.toUpperCase()} and event == "${tr.trigger || 'next'}":`,
        `            self.state = ${name}State.${tgt.name.toUpperCase()}`
      );
    }
    return { filename: `${name.toLowerCase()}_sm.py`, language: 'python', content: lines.join('\n') };
  }

  // Default TypeScript state machine
  const stateUnion = states.length ? states.map((s) => `'${s.name}'`).join(' | ') : "'Idle'";
  const lines = [
    `export type ${name}State = ${stateUnion};`,
    '',
    `export class ${name}Machine {`,
    `  public state: ${name}State = '${states[0]?.name || 'Idle'}';`,
    '',
    '  public dispatch(event: string): void {',
    '    switch (this.state) {',
  ];
  for (const st of states) {
    const outgoing = transitions.filter((t) => t.sourceId === st.id);
    lines.push(`      case '${st.name}':`);
    for (const tr of outgoing) {
      const tgt = project.elements[tr.targetId];
      if (!tgt || tgt.kind !== 'state') continue;
      lines.push(`        if (event === '${tr.trigger || 'next'}') { this.state = '${tgt.name}'; return; }`);
    }
    lines.push('        break;');
  }
  lines.push('    }', '  }', '}');
  return { filename: `${name}Machine.ts`, language: 'typescript', content: lines.join('\n') };
}
