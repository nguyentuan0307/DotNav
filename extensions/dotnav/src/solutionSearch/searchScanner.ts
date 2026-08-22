import * as fs from 'fs';
import * as path from 'path';
import {
  CqrsFlowNode,
  CqrsFlowResult,
  SearchFilterMode,
  SearchIndexSnapshot,
  UniversalSymbol,
  UniversalSymbolKind
} from './searchModel';
import { DiskSymbolStore } from './searchDiskStore';
import { parseEndpointsFromCSharp } from '../endpoints/endpointScanner';

export const PRIMARY_HOT_KINDS = new Set<UniversalSymbolKind>([
  'endpoint',
  'cqrs_command',
  'cqrs_query',
  'cqrs_handler',
  'cqrs_event',
  'ef_entity',
  'ef_dbset',
  'ef_migration',
  'db_table',
  'di_registration',
  'background_job',
  'mapping_profile',
  'validation_rule',
  'class',
  'interface',
  'record',
  'enum',
  'enum_member',
  'project',
  'file'
]);

const CSHARP_RESERVED_KEYWORDS = new Set([
  'if', 'else', 'for', 'foreach', 'while', 'switch', 'using', 'catch', 'lock', 'fixed',
  'nameof', 'typeof', 'sizeof', 'default', 'new', 'return', 'throw', 'await', 'async',
  'get', 'set', 'init', 'add', 'remove', 'value', 'var', 'class', 'struct', 'record',
  'interface', 'enum', 'delegate', 'namespace', 'public', 'private', 'protected', 'internal'
]);

export function pluralize(word: string): string {
  if (!word) return word;
  if (word.endsWith('y') && !/[aeiou]y$/i.test(word)) {
    return word.slice(0, -1) + 'ies';
  }
  if (word.endsWith('s') || word.endsWith('x') || word.endsWith('z') || word.endsWith('ch') || word.endsWith('sh')) {
    return word + 'es';
  }
  return word + 's';
}

export function stripAccents(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

const stringPool = new Map<string, string>();
export function internString(str: string | undefined): string | undefined {
  if (!str) return str;
  const existing = stringPool.get(str);
  if (existing !== undefined) return existing;
  if (stringPool.size < 200000) {
    stringPool.set(str, str);
  }
  return str;
}

export function extractIndexTokens(symbol: UniversalSymbol): string[] {
  const tokens = new Set<string>();

  const addTerm = (term: string) => {
    if (!term) return;
    const cleaned = term.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase();
    if (!cleaned || cleaned.length < 2) return;
    tokens.add(cleaned);
    const unaccented = stripAccents(cleaned);
    tokens.add(unaccented);
    if (cleaned.length >= 4) {
      tokens.add(cleaned.slice(0, 3));
      tokens.add(unaccented.slice(0, 3));
      tokens.add(pluralize(cleaned));
      tokens.add(pluralize(unaccented));
    }
  };

  const originalBareName = symbol.name
    .split('(')[0]
    .replace(/^(DbSet|Table|Map|RuleFor|Job|AddScoped|AddTransient|AddSingleton):\s*/i, '')
    .trim();
  addTerm(originalBareName);

  // CamelCase word segments
  const segments = originalBareName.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|[-_\s/.:{}="',<>]+/).filter(Boolean);
  for (const seg of segments) {
    addTerm(seg);
  }

  // Folder and path segments (e.g. Services, CustomAppShared, DomainEvents, DataEntities)
  if (symbol.relativePath) {
    const pathWords = symbol.relativePath.split(/[\/\\._-]+/).filter(Boolean);
    for (const pw of pathWords) {
      if (pw !== 'cs' && pw !== 'json' && pw !== 'csproj' && pw !== 'resx') {
        addTerm(pw);
      }
    }
  }

  // Config value / Error message text tokens
  if (symbol.metadata?.configValue) {
    addTerm(symbol.metadata.configValue);
    const valWords = symbol.metadata.configValue.split(/[-_\s/.:{}="',;!?()<>\[\]]+/).filter(Boolean);
    for (const vw of valWords) {
      addTerm(vw);
    }
  }

  // Acronym and acronym prefixes (e.g. CIVC, URFA, CI, CIV)
  const uppercase = originalBareName.replace(/[^A-Z]/g, '').toLowerCase();
  if (uppercase.length >= 2) {
    for (let l = 2; l <= uppercase.length; l++) {
      tokens.add(uppercase.slice(0, l));
    }
  }

  // Container name and segments (both singular and plural forms)
  if (symbol.containerName) {
    addTerm(symbol.containerName);
    const bareContainer = symbol.containerName.replace(/Controller$/i, '');
    addTerm(bareContainer);
    const cSegments = symbol.containerName.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|[-_\s/.:{}]+/).filter(Boolean);
    for (const cSeg of cSegments) {
      addTerm(cSeg);
    }
  }

  // BaseType / Return Type / Handled Type metadata and segments
  const typeMeta = symbol.metadata?.baseType || symbol.metadata?.returnType || symbol.metadata?.handledType;
  if (typeMeta) {
    const baseTokens = typeMeta.split(/<|>|\s|,|\[|\]|:/).filter(Boolean);
    for (const b of baseTokens) {
      addTerm(b);
      const bSegs = b.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|[-_\s/.:]+/).filter(Boolean);
      for (const bs of bSegs) {
        addTerm(bs);
      }
    }
  }

  // Injected dependencies parameter tokens
  if (symbol.metadata?.injectedParams) {
    for (const p of symbol.metadata.injectedParams) {
      addTerm(p);
      const pSegs = p.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|[-_\s/.:<>]+/).filter(Boolean);
      for (const ps of pSegs) {
        addTerm(ps);
      }
    }
  }

  // SQL Table
  if (symbol.metadata?.sqlTable) {
    addTerm(symbol.metadata.sqlTable);
    const tSegs = symbol.metadata.sqlTable.split(/[-_\s.]+/).filter(Boolean);
    for (const ts of tSegs) {
      addTerm(ts);
    }
  }

  // Parameter summary words
  if (symbol.metadata?.parameterSummary) {
    const paramWords = symbol.metadata.parameterSummary.split(/[-_\s/.:{}="',;!?()<>\[\],]+/).filter(Boolean);
    for (const pw of paramWords) {
      if (pw.length >= 3 && !CSHARP_RESERVED_KEYWORDS.has(pw)) {
        addTerm(pw);
      }
    }
  }

  // Action name
  if (symbol.metadata?.actionName) {
    addTerm(symbol.metadata.actionName);
    const actSegments = symbol.metadata.actionName.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|[-_\s/.:]+/).filter(Boolean);
    for (const a of actSegments) {
      addTerm(a);
    }
  }

  // Endpoint route template tokens
  if (symbol.metadata?.routeTemplate) {
    const routeSegments = symbol.metadata.routeTemplate.toLowerCase().split(/[\/\\{}:]+/).filter(Boolean);
    for (const rSeg of routeSegments) {
      addTerm(rSeg);
    }
  }

  return Array.from(tokens);
}

export function isIgnoredSearchFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  if (/\/(bin|obj|node_modules|\.vs|\.git|\.idea)\//i.test(normalized)) {
    return true;
  }
  const base = path.basename(filePath);
  if (/\.(g|Designer|generated)\.cs$/i.test(base)) {
    return true;
  }
  return false;
}

export function parseSymbolsFromCSharp(
  code: string,
  filePath: string,
  projectName: string,
  relativePath: string
): UniversalSymbol[] {
  const symbols: UniversalSymbol[] = [];

  // 1. Parse ASP.NET Core Endpoints (Controllers & Minimal APIs)
  const endpoints = parseEndpointsFromCSharp(code, filePath, projectName, relativePath);
  for (const ep of endpoints) {
    symbols.push({
      id: `${ep.filePath}:${ep.line}:${ep.httpMethod}:${ep.routeTemplate}`,
      name: `${ep.httpMethod} /${ep.routeTemplate.replace(/^\/+/, '')}`,
      kind: 'endpoint',
      filePath: ep.filePath,
      relativePath: ep.relativePath,
      projectName: ep.projectName,
      line: ep.line,
      column: 1,
      containerName: ep.controllerName,
      metadata: {
        httpMethod: ep.httpMethod,
        routeTemplate: ep.routeTemplate,
        controllerName: ep.controllerName,
        actionName: ep.actionName
      }
    });
  }

  // Fast-path heuristic: If file doesn't have class/interface/record/enum/struct declarations, skip
  if (
    !code.includes('class') &&
    !code.includes('interface') &&
    !code.includes('record') &&
    !code.includes('enum') &&
    !code.includes('struct')
  ) {
    return symbols;
  }

  const lines = code.split(/\r?\n/);

  // 2. Parse EF Core DbSets
  const dbSetRegex = /public\s+(?:virtual\s+)?DbSet<([a-zA-Z0-9_]+)>\s+([a-zA-Z0-9_]+)\s*\{\s*get;\s*set;\s*\}(?:\s*=\s*[^;]+;)?/g;
  let dbSetMatch: RegExpExecArray | null;
  while ((dbSetMatch = dbSetRegex.exec(code)) !== null) {
    const entityType = dbSetMatch[1];
    const propertyName = dbSetMatch[2];
    const lineIndex = code.substring(0, dbSetMatch.index).split(/\r?\n/).length;

    symbols.push({
      id: `${filePath}:${lineIndex}:dbset:${propertyName}`,
      name: `DbSet<${entityType}> ${propertyName}`,
      kind: 'ef_dbset',
      filePath,
      relativePath,
      projectName,
      line: lineIndex,
      column: 1,
      metadata: {
        baseType: entityType
      }
    });
  }

  // 3. Parse Types & CQRS & Domain Patterns
  const typeRegex = /^\s*(?:\[[^\]]+\]\s*)*(?:public|internal|protected|private)?\s*(?:static|abstract|sealed|partial)*\s*(record\s+struct|record\s+class|class|interface|record|enum|struct)\s+([a-zA-Z0-9_]+)(?:<[^>]+>)?(?:\s*\(([^)]*)\))?(?:\s*:\s*([^{;\r\n]+))?/gm;
  let typeMatch: RegExpExecArray | null;

  while ((typeMatch = typeRegex.exec(code)) !== null) {
    const rawTypeKeyword = typeMatch[1]; // class, interface, record, enum, struct, record struct, record class
    const typeName = typeMatch[2];
    const primaryCtorParams = typeMatch[3];
    const inheritanceList = typeMatch[4] ? typeMatch[4].trim() : '';
    const lineIndex = code.substring(0, typeMatch.index).split(/\r?\n/).length;

    let kind: UniversalSymbolKind = 'class';
    if (rawTypeKeyword === 'interface') {
      kind = 'interface';
    } else if (rawTypeKeyword.startsWith('record')) {
      kind = 'record';
    } else if (rawTypeKeyword === 'enum') {
      kind = 'enum';
    } else if (rawTypeKeyword === 'struct') {
      kind = 'class';
    }

    let handledType: string | undefined = undefined;
    let emittedEvents: string[] | undefined = undefined;

    // CQRS, EF Core & Domain classifications
    if (inheritanceList) {
      const handlerMatch = inheritanceList.match(
        /(?:INotificationHandler|IRequestHandler|IDomainEventHandler|ICommandHandler|IQueryHandler|IConsumer)<([A-Za-z0-9_]+)/
      );
      if (handlerMatch) {
        handledType = handlerMatch[1];
      }

      if (/\bMigration\b/.test(inheritanceList)) {
        kind = 'ef_migration';
      } else if (
        /\b(INotificationHandler|IRequestHandler|IDomainEventHandler|ICommandHandler|IQueryHandler|IConsumer)\b/.test(
          inheritanceList
        )
      ) {
        kind = 'cqrs_handler';
      } else if (/\b(IRequest|ICommand)\b/.test(inheritanceList) && !typeName.endsWith('Query')) {
        kind = 'cqrs_command';
      } else if (/\b(IRequest|IQuery)\b/.test(inheritanceList) || typeName.endsWith('Query')) {
        kind = 'cqrs_query';
      } else if (/\b(INotification|IDomainEvent|IEvent)\b/.test(inheritanceList)) {
        kind = 'cqrs_event';
      } else if (
        /\b(IEntityTypeConfiguration|TenantEntity|BaseEntity|AuditableEntity|AggregateRoot|DbContext|AuditlogDBContext)\b/.test(
          inheritanceList
        )
      ) {
        kind = 'ef_entity';
      } else if (/\b(BackgroundService|IHostedService|IJob)\b/.test(inheritanceList)) {
        kind = 'cqrs_event';
      }
    } else {
      if (typeName.endsWith('Command') && !typeName.endsWith('CommandHandler')) {
        kind = 'cqrs_command';
      } else if (
        typeName.endsWith('CommandHandler') ||
        typeName.endsWith('DomainEventHandler') ||
        typeName.endsWith('EventHandler') ||
        typeName.endsWith('Handler')
      ) {
        kind = 'cqrs_handler';
      } else if (typeName.endsWith('DomainEvent') || (typeName.endsWith('Event') && !typeName.endsWith('Handler'))) {
        kind = 'cqrs_event';
      } else if (typeName.endsWith('Query') && !typeName.endsWith('QueryHandler')) {
        kind = 'cqrs_query';
      } else if (
        typeName.endsWith('Entity') ||
        relativePath.includes('/Entities/') ||
        relativePath.includes('/Domain/Entities/')
      ) {
        kind = 'ef_entity';
      }
    }

    if (kind === 'cqrs_handler' && !handledType) {
      if (typeName.endsWith('CommandHandler')) {
        handledType = typeName.slice(0, -7);
      } else if (typeName.endsWith('QueryHandler')) {
        handledType = typeName.slice(0, -7);
      } else if (typeName.endsWith('DomainEventHandler')) {
        handledType = typeName.slice(0, -7);
      }
    }

    // Scan for emitted events in class body
    if (kind === 'cqrs_handler' || kind === 'cqrs_command') {
      const eventInstMatch = code.matchAll(/new\s+([A-Za-z0-9_]+(?:DomainEvent|Event))\s*\(/g);
      const eventsFound: string[] = [];
      for (const m of eventInstMatch) {
        if (!eventsFound.includes(m[1])) {
          eventsFound.push(m[1]);
        }
      }
      if (eventsFound.length > 0) {
        emittedEvents = eventsFound;
      }
    }

    symbols.push({
      id: `${filePath}:${lineIndex}:${kind}:${typeName}`,
      name: typeName,
      kind,
      filePath,
      relativePath,
      projectName: internString(projectName)!,
      line: lineIndex,
      column: 1,
      metadata: {
        baseType: inheritanceList || undefined,
        handledType: internString(handledType),
        emittedEvents
      }
    });

    // Parse Record Primary Constructor Properties
    if (rawTypeKeyword.startsWith('record') && primaryCtorParams) {
      const paramList = primaryCtorParams.split(',').map(p => p.trim()).filter(Boolean);
      for (const p of paramList) {
        const parts = p.split(/\s+/);
        if (parts.length >= 2) {
          const propType = parts.slice(0, -1).join(' ');
          const propName = parts[parts.length - 1].replace(/[=;].*$/, '').trim();
          if (propName && !CSHARP_RESERVED_KEYWORDS.has(propName)) {
            symbols.push({
              id: `${filePath}:${lineIndex}:property:${typeName}.${propName}`,
              name: `${propName} : ${propType}`,
              kind: internString('property') as UniversalSymbolKind,
              filePath,
              relativePath,
              projectName: internString(projectName)!,
              line: lineIndex,
              column: 1,
              containerName: typeName,
              metadata: {
                returnType: internString(propType)
              }
            });
          }
        }
      }
    }

    // Parse Interface Method Signatures
    if (rawTypeKeyword === 'interface') {
      const ifaceBodyStart = code.indexOf('{', typeMatch.index);
      if (ifaceBodyStart !== -1) {
        let braceCount = 1;
        let ifaceBodyEnd = code.length;
        for (let i = ifaceBodyStart + 1; i < code.length; i++) {
          if (code[i] === '{') braceCount++;
          else if (code[i] === '}') {
            braceCount--;
            if (braceCount === 0) {
              ifaceBodyEnd = i;
              break;
            }
          }
        }
        const ifaceBody = code.substring(ifaceBodyStart + 1, ifaceBodyEnd);
        const ifaceMethodRegex = /^\s*(?:\[[^\]]+\]\s*)*([a-zA-Z0-9_<>?,.\[\]\(\)\s*]+?)\s+([a-zA-Z0-9_]+)\s*(?:<[^>]+>)?\s*\(([\s\S]*?)\)\s*;/gm;
        let m: RegExpExecArray | null;
        while ((m = ifaceMethodRegex.exec(ifaceBody)) !== null) {
          const retType = m[1].trim();
          const methodName = m[2].trim();
          const params = m[3].trim();
          if (!CSHARP_RESERVED_KEYWORDS.has(methodName) && !CSHARP_RESERVED_KEYWORDS.has(retType)) {
            const mOffset = ifaceBodyStart + 1 + m.index;
            const mLine = code.substring(0, mOffset).split(/\r?\n/).length;

            symbols.push({
              id: `${filePath}:${mLine}:method:${typeName}.${methodName}`,
              name: `${methodName}(${params.split(',').length > 1 ? '...' : (params.length > 25 ? '...' : params)})`,
              kind: internString('method') as UniversalSymbolKind,
              filePath,
              relativePath,
              projectName: internString(projectName)!,
              line: mLine,
              column: 1,
              containerName: typeName,
              metadata: {
                returnType: internString(retType),
                parameterSummary: params.replace(/\s+/g, ' ').trim()
              }
            });
          }
        }
      }
    }

    // 4. If Enum, parse enum values
    if (rawTypeKeyword === 'enum') {
      const enumBodyStartIndex = typeMatch.index + typeMatch[0].length;
      const openBrace = code.indexOf('{', enumBodyStartIndex);
      if (openBrace !== -1) {
        const closeBrace = code.indexOf('}', openBrace);
        if (closeBrace !== -1) {
          const enumBody = code.substring(openBrace + 1, closeBrace);
          const enumLines = enumBody.split(/\r?\n/);
          let currentEnumLine = code.substring(0, openBrace).split(/\r?\n/).length;

          for (const rawLine of enumLines) {
            currentEnumLine++;
            const trimmed = rawLine.replace(/\/\/.*$/, '').trim();
            if (!trimmed || trimmed.startsWith('[')) continue;
            const lineMembers = trimmed.split(',');
            for (const item of lineMembers) {
              const itemTrimmed = item.trim();
              if (!itemTrimmed || itemTrimmed.startsWith('[')) continue;
              const memberMatch = /^([a-zA-Z0-9_]+)/.exec(itemTrimmed);
              if (memberMatch && memberMatch[1] && memberMatch[1] !== typeName) {
                const memberName = memberMatch[1];
                symbols.push({
                  id: `${filePath}:${currentEnumLine}:enum_member:${typeName}.${memberName}`,
                  name: `${typeName}.${memberName}`,
                  kind: 'enum_member',
                  filePath,
                  relativePath,
                  projectName: internString(projectName)!,
                  line: currentEnumLine,
                  column: 1,
                  containerName: typeName
                });
              }
            }
          }
        }
      }
    }
  }

  // 5. Parse Constants and Static Readonly Fields
  const constRegex = /^\s*(?:\[[^\]]+\]\s*)*(?:public|internal|protected|private)?\s*(?:(?:static\s+readonly|const))\s+([a-zA-Z0-9_<>?,.\[\]]+)\s+([a-zA-Z0-9_]+)\s*(?:=\s*([^;]+))?;/gm;
  let constMatch: RegExpExecArray | null;
  while ((constMatch = constRegex.exec(code)) !== null) {
    const fType = constMatch[1].trim();
    const fName = constMatch[2].trim();
    const fVal = constMatch[3] ? constMatch[3].trim().replace(/^["']|["']$/g, '') : undefined;
    const lineIndex = code.substring(0, constMatch.index).split(/\r?\n/).length;

    if (!CSHARP_RESERVED_KEYWORDS.has(fName) && !CSHARP_RESERVED_KEYWORDS.has(fType)) {
      symbols.push({
        id: `${filePath}:${lineIndex}:const:${fName}`,
        name: fVal ? `${fName} = ${fVal}` : `${fName} : ${fType}`,
        kind: internString('property') as UniversalSymbolKind,
        filePath,
        relativePath,
        projectName: internString(projectName)!,
        line: lineIndex,
        column: 1,
        metadata: {
          returnType: internString(fType),
          configValue: fVal ? internString(fVal) : undefined
        }
      });
    }
  }

  // 6. Parse Methods (public, private, protected, internal, static, async, virtual)
  const methodRegex = /^\s*(?:\[[^\]]+\]\s*)*(?:(?:public|private|protected|internal|static|async|virtual|override|sealed|new|readonly|unsafe)\s+)+([a-zA-Z0-9_<>?,.\[\]\(\)\s*]+?)\s+([a-zA-Z0-9_]+)\s*(?:<[^>]+>)?\s*\(([\s\S]*?)\)\s*(?:where[^{;=>]+)?\s*(?:\{|=>|;)/gm;
  let methodMatch: RegExpExecArray | null;

  while ((methodMatch = methodRegex.exec(code)) !== null) {
    const returnType = methodMatch[1].trim();
    const methodName = methodMatch[2].trim();
    const params = methodMatch[3].trim();
    const lineIndex = code.substring(0, methodMatch.index).split(/\r?\n/).length;

    // Filter out language keywords and boilerplate
    if (CSHARP_RESERVED_KEYWORDS.has(methodName) || CSHARP_RESERVED_KEYWORDS.has(returnType)) {
      continue;
    }
    if (
      methodName === 'ToString' ||
      methodName === 'Dispose' ||
      methodName === 'GetHashCode' ||
      methodName === 'Equals' ||
      methodName.startsWith('get_') ||
      methodName.startsWith('set_')
    ) {
      continue;
    }

    symbols.push({
      id: `${filePath}:${lineIndex}:method:${methodName}`,
      name: `${methodName}(${params.split(',').length > 1 ? '...' : (params.length > 25 ? '...' : params)})`,
      kind: internString('method') as UniversalSymbolKind,
      filePath,
      relativePath,
      projectName: internString(projectName)!,
      line: lineIndex,
      column: 1,
      metadata: {
        returnType: internString(returnType),
        parameterSummary: params.replace(/\s+/g, ' ').trim()
      }
    });
  }

  // 7. Parse Constructors & Injected Dependencies
  const ctorRegex = /^\s*(?:\[[^\]]+\]\s*)*(?:public|internal|protected|private)\s+([A-Za-z0-9_]+)\s*\(([\s\S]*?)\)\s*(?::\s*(?:base|this)\s*\([^)]*\))?\s*\{/gm;
  let ctorMatch: RegExpExecArray | null;
  while ((ctorMatch = ctorRegex.exec(code)) !== null) {
    const ctorName = ctorMatch[1];
    const ctorParams = ctorMatch[2].trim();
    if (ctorParams && !CSHARP_RESERVED_KEYWORDS.has(ctorName)) {
      const lineIndex = code.substring(0, ctorMatch.index).split(/\r?\n/).length;
      const paramTypes = ctorParams
        .split(',')
        .map(p => {
          const parts = p.trim().split(/\s+/);
          return parts.length >= 2 ? parts[0].replace(/<[^>]+>/g, '') : '';
        })
        .filter(Boolean);

      symbols.push({
        id: `${filePath}:${lineIndex}:ctor:${ctorName}`,
        name: `${ctorName}(${ctorParams.length > 30 ? '...' : ctorParams})`,
        kind: internString('method') as UniversalSymbolKind,
        filePath,
        relativePath,
        projectName: internString(projectName)!,
        line: lineIndex,
        column: 1,
        containerName: ctorName,
        metadata: {
          parameterSummary: ctorParams.replace(/\s+/g, ' ').trim(),
          injectedParams: paramTypes.map(p => internString(p)!)
        }
      });
    }
  }

  // 8. Parse Properties (Auto, Required, Init, Expression-bodied)
  const propRegex = /^\s*(?:\[[^\]]+\]\s*)*(?:public|internal|protected)\s+(?:virtual|override|static|sealed|readonly|new|required)*\s*([a-zA-Z0-9_<>?,.\[\]]+)\s+([a-zA-Z0-9_]+)\s*(?:\{\s*(?:get|set|init)|=>)/gm;
  let propMatch: RegExpExecArray | null;

  while ((propMatch = propRegex.exec(code)) !== null) {
    const propType = propMatch[1].trim();
    const propName = propMatch[2].trim();
    const lineIndex = code.substring(0, propMatch.index).split(/\r?\n/).length;

    if (CSHARP_RESERVED_KEYWORDS.has(propName) || CSHARP_RESERVED_KEYWORDS.has(propType)) {
      continue;
    }
    if (propType === 'DbSet' || propType.startsWith('DbSet<')) {
      continue; // already captured as ef_dbset
    }

    symbols.push({
      id: `${filePath}:${lineIndex}:property:${propName}`,
      name: `${propName} : ${propType}`,
      kind: internString('property') as UniversalSymbolKind,
      filePath,
      relativePath,
      projectName: internString(projectName)!,
      line: lineIndex,
      column: 1,
      metadata: {
        returnType: internString(propType)
      }
    });
  }

  // 9. Parse Inline Error Messages (throw new ...Exception("..."))
  const throwRegex = /throw\s+new\s+([A-Za-z0-9_]*Exception)\s*\(\s*(?:\$|@)?"([^"\r\n]+)"/g;
  let throwMatch: RegExpExecArray | null;
  while ((throwMatch = throwRegex.exec(code)) !== null) {
    const exType = throwMatch[1];
    const message = throwMatch[2].trim();
    if (message.length >= 3) {
      const lineIndex = code.substring(0, throwMatch.index).split(/\r?\n/).length;
      symbols.push({
        id: `${filePath}:${lineIndex}:error:${message.slice(0, 40)}`,
        name: `${exType}: "${message}"`,
        kind: internString('config_key') as UniversalSymbolKind,
        filePath,
        relativePath,
        projectName: internString(projectName)!,
        line: lineIndex,
        column: 1,
        metadata: {
          configValue: internString(message),
          baseType: internString(exType)
        }
      });
    }
  }

  // 10. Parse Dependency Injection Service Registrations (services.AddScoped<...>)
  const diRegex = /\b(?:services|builder\.Services)\s*\.\s*(AddScoped|AddTransient|AddSingleton|AddHostedService)\s*<([a-zA-Z0-9_,\s<>]+)>\s*\(/g;
  let diMatch: RegExpExecArray | null;
  while ((diMatch = diRegex.exec(code)) !== null) {
    const diLifetime = diMatch[1];
    const diTypes = diMatch[2].trim();
    const lineIndex = code.substring(0, diMatch.index).split(/\r?\n/).length;
    symbols.push({
      id: `${filePath}:${lineIndex}:di:${diTypes}`,
      name: `${diLifetime}<${diTypes}>`,
      kind: internString('di_registration') as UniversalSymbolKind,
      filePath,
      relativePath,
      projectName: internString(projectName)!,
      line: lineIndex,
      column: 1,
      metadata: {
        baseType: internString(diTypes),
        docSummary: `DI: ${diLifetime}`
      }
    });
  }

  // 11. Parse Database Fluent API Table Mappings (.ToTable("..."))
  const tableRegex = /\b(?:builder|entity)\s*\.\s*ToTable\s*\(\s*["']([^"']+)["']/g;
  let tableMatch: RegExpExecArray | null;
  while ((tableMatch = tableRegex.exec(code)) !== null) {
    const tableName = tableMatch[1].trim();
    const lineIndex = code.substring(0, tableMatch.index).split(/\r?\n/).length;
    symbols.push({
      id: `${filePath}:${lineIndex}:table:${tableName}`,
      name: `Table: ${tableName}`,
      kind: internString('db_table') as UniversalSymbolKind,
      filePath,
      relativePath,
      projectName: internString(projectName)!,
      line: lineIndex,
      column: 1,
      metadata: {
        sqlTable: internString(tableName)
      }
    });
  }

  // 12. Parse Background Jobs Enqueue / Schedule
  const jobRegex = /\b(?:_backgroundJobManager|BackgroundJob|_jobClient|RecurringJob)\s*\.\s*(?:Enqueue|Schedule|AddOrUpdate)\s*<([a-zA-Z0-9_]+)>/g;
  let jobMatch: RegExpExecArray | null;
  while ((jobMatch = jobRegex.exec(code)) !== null) {
    const jobName = jobMatch[1].trim();
    const lineIndex = code.substring(0, jobMatch.index).split(/\r?\n/).length;
    symbols.push({
      id: `${filePath}:${lineIndex}:job:${jobName}`,
      name: `Job: ${jobName}`,
      kind: internString('background_job') as UniversalSymbolKind,
      filePath,
      relativePath,
      projectName: internString(projectName)!,
      line: lineIndex,
      column: 1,
      metadata: {
        baseType: internString(jobName)
      }
    });
  }

  // 13. Parse AutoMapper / Mapster Mappings
  const mapRegex = /\b(?:CreateMap|TypeAdapterConfig)\s*<([a-zA-Z0-9_,\s<>]+)>/g;
  let mapMatch: RegExpExecArray | null;
  while ((mapMatch = mapRegex.exec(code)) !== null) {
    const mapTypes = mapMatch[1].trim();
    const lineIndex = code.substring(0, mapMatch.index).split(/\r?\n/).length;
    symbols.push({
      id: `${filePath}:${lineIndex}:map:${mapTypes}`,
      name: `Map: ${mapTypes.replace(/\s+/g, ' ')}`,
      kind: internString('mapping_profile') as UniversalSymbolKind,
      filePath,
      relativePath,
      projectName: internString(projectName)!,
      line: lineIndex,
      column: 1,
      metadata: {
        baseType: internString(mapTypes)
      }
    });
  }

  // 14. Parse FluentValidation Rules
  const valRegex = /\bRuleFor\s*\(\s*[a-zA-Z0-9_]+\s*=>\s*[a-zA-Z0-9_]+\.([a-zA-Z0-9_]+)\s*\)/g;
  let valMatch: RegExpExecArray | null;
  while ((valMatch = valRegex.exec(code)) !== null) {
    const prop = valMatch[1].trim();
    const lineIndex = code.substring(0, valMatch.index).split(/\r?\n/).length;
    symbols.push({
      id: `${filePath}:${lineIndex}:validation:${prop}`,
      name: `RuleFor: ${prop}`,
      kind: internString('validation_rule') as UniversalSymbolKind,
      filePath,
      relativePath,
      projectName: internString(projectName)!,
      line: lineIndex,
      column: 1,
      metadata: {
        baseType: internString(prop)
      }
    });
  }

  return symbols;
}

export function parseSymbolsFromResx(
  content: string,
  filePath: string,
  projectName: string,
  relativePath: string
): UniversalSymbol[] {
  const symbols: UniversalSymbol[] = [];
  const regex = /<data\s+name="([^"]+)"[^>]*>[\s\S]*?<value>([\s\S]*?)<\/value>/g;
  let match: RegExpExecArray | null;
  const internedProj = internString(projectName)!;

  while ((match = regex.exec(content)) !== null) {
    const key = match[1];
    const val = match[2].trim();
    const line = content.substring(0, match.index).split(/\r?\n/).length;

    symbols.push({
      id: `${filePath}:${line}:resx:${key}`,
      name: `${key} = "${val}"`,
      kind: internString('config_key') as UniversalSymbolKind,
      filePath,
      relativePath,
      projectName: internedProj,
      line,
      column: 1,
      metadata: {
        configValue: internString(val)
      }
    });
  }
  return symbols;
}

export function parseSymbolsFromAppSettings(
  content: string,
  filePath: string,
  projectName: string,
  relativePath: string
): UniversalSymbol[] {
  const symbols: UniversalSymbol[] = [];
  try {
    const parsed = JSON.parse(content);
    const internedProj = internString(projectName)!;
    const flatten = (obj: Record<string, any>, prefix = '', lineTracker = 1) => {
      for (const [key, val] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}:${key}` : key;
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
          flatten(val, fullKey, lineTracker);
        } else {
          symbols.push({
            id: `${filePath}:${fullKey}`,
            name: fullKey,
            kind: 'config_key',
            filePath,
            relativePath,
            projectName: internedProj,
            line: lineTracker,
            column: 1,
            metadata: {
              configValue: typeof val === 'string' ? val : JSON.stringify(val)
            }
          });
        }
      }
    };
    if (parsed && typeof parsed === 'object') {
      flatten(parsed);
    }
  } catch {
    // Ignore malformed json
  }
  return symbols;
}

export function parseSymbolsFromSql(
  content: string,
  filePath: string,
  projectName: string,
  relativePath: string
): UniversalSymbol[] {
  const symbols: UniversalSymbol[] = [];
  const internedProj = internString(projectName)!;

  const sqlObjRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?(TABLE|VIEW|PROCEDURE|FUNCTION|INDEX)\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_."`]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = sqlObjRegex.exec(content)) !== null) {
    const objType = match[1].toUpperCase();
    const rawObjName = match[2].replace(/["`]/g, '');
    const line = content.substring(0, match.index).split(/\r?\n/).length;

    symbols.push({
      id: `${filePath}:${line}:sql:${rawObjName}`,
      name: `${objType} ${rawObjName}`,
      kind: internString('db_table') as UniversalSymbolKind,
      filePath,
      relativePath,
      projectName: internedProj,
      line,
      column: 1,
      metadata: {
        sqlTable: internString(rawObjName),
        docSummary: `SQL ${objType}`
      }
    });
  }

  return symbols;
}

export function parseSymbolsFromYaml(
  content: string,
  filePath: string,
  projectName: string,
  relativePath: string
): UniversalSymbol[] {
  const symbols: UniversalSymbol[] = [];
  const internedProj = internString(projectName)!;
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const keyMatch = /^(\s*)([a-zA-Z0-9_.-]+):\s*(.*)$/.exec(line);
    if (keyMatch) {
      const indent = keyMatch[1].length;
      const key = keyMatch[2];
      const val = keyMatch[3].trim();
      if (indent <= 4 && key.length >= 2 && !key.startsWith('#')) {
        symbols.push({
          id: `${filePath}:${i + 1}:yaml:${key}`,
          name: val && val.length < 40 ? `${key}: ${val}` : key,
          kind: internString('config_key') as UniversalSymbolKind,
          filePath,
          relativePath,
          projectName: internedProj,
          line: i + 1,
          column: 1,
          metadata: {
            configValue: val ? internString(val) : undefined
          }
        });
      }
    }
  }

  return symbols;
}

export function parseSymbolsFromProto(
  content: string,
  filePath: string,
  projectName: string,
  relativePath: string
): UniversalSymbol[] {
  const symbols: UniversalSymbol[] = [];
  const internedProj = internString(projectName)!;

  const protoRegex = /\b(service|message|rpc|enum)\s+([a-zA-Z0-9_]+)/g;
  let match: RegExpExecArray | null;
  while ((match = protoRegex.exec(content)) !== null) {
    const pKind = match[1];
    const pName = match[2];
    const line = content.substring(0, match.index).split(/\r?\n/).length;

    let symKind: UniversalSymbolKind = 'class';
    if (pKind === 'service') symKind = 'interface';
    else if (pKind === 'rpc') symKind = 'endpoint';
    else if (pKind === 'enum') symKind = 'enum';

    symbols.push({
      id: `${filePath}:${line}:proto:${pName}`,
      name: `${pKind} ${pName}`,
      kind: internString(symKind) as UniversalSymbolKind,
      filePath,
      relativePath,
      projectName: internedProj,
      line,
      column: 1,
      metadata: {
        docSummary: `Protobuf ${pKind}`
      }
    });
  }

  return symbols;
}

export function parseSymbolsFromMarkdown(
  content: string,
  filePath: string,
  projectName: string,
  relativePath: string
): UniversalSymbol[] {
  const symbols: UniversalSymbol[] = [];
  const internedProj = internString(projectName)!;
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#')) {
      const headingText = line.replace(/^#+\s*/, '').trim();
      if (headingText) {
        symbols.push({
          id: `${filePath}:${i + 1}:md:${headingText.slice(0, 40)}`,
          name: `# ${headingText}`,
          kind: internString('file') as UniversalSymbolKind,
          filePath,
          relativePath,
          projectName: internedProj,
          line: i + 1,
          column: 1,
          metadata: {
            docSummary: internString(headingText)
          }
        });
      }
    }
  }

  return symbols;
}

export class UniversalSymbolIndex {
  private readonly fileCache = new Map<string, UniversalSymbol[]>();
  private readonly fileTimestamps = new Map<string, number>();
  private readonly kindBuckets = new Map<UniversalSymbolKind, Set<UniversalSymbol>>();
  private readonly tokenBuckets = new Map<string, Set<UniversalSymbol>>();
  private readonly projectBuckets = new Map<string, Set<UniversalSymbol>>();
  private cachedAllSymbols: UniversalSymbol[] | undefined = undefined;
  private _isFullScanCompleted: boolean = false;
  private diskStore?: DiskSymbolStore;

  public setDiskStore(store: DiskSymbolStore): void {
    this.diskStore = store;
  }

  public getDiskStore(): DiskSymbolStore | undefined {
    return this.diskStore;
  }

  public get isFullScanCompleted(): boolean {
    return this._isFullScanCompleted;
  }

  public markFullScanCompleted(): void {
    this._isFullScanCompleted = true;
  }

  public getFileTimestamp(filePath: string): number | undefined {
    return this.fileTimestamps.get(filePath);
  }

  public exportSnapshot(): SearchIndexSnapshot {
    const symbolsByFile: Record<string, UniversalSymbol[]> = {};
    const fileTimestamps: Record<string, number> = {};
    for (const [filePath, symbols] of this.fileCache.entries()) {
      symbolsByFile[filePath] = symbols;
      const mtime = this.fileTimestamps.get(filePath) || 0;
      if (mtime > 0) {
        fileTimestamps[filePath] = mtime;
      }
    }
    return {
      version: 5,
      timestamp: Date.now(),
      fileTimestamps,
      symbolsByFile
    };
  }

  public loadSnapshot(snapshot: SearchIndexSnapshot): void {
    this.fileCache.clear();
    this.fileTimestamps.clear();
    this.kindBuckets.clear();
    this.tokenBuckets.clear();
    this.projectBuckets.clear();
    this.cachedAllSymbols = undefined;
    this._isFullScanCompleted = false;
    if (!snapshot || !snapshot.symbolsByFile) return;
    for (const [filePath, symbols] of Object.entries(snapshot.symbolsByFile)) {
      this.fileCache.set(filePath, symbols);
      const mtime = snapshot.fileTimestamps?.[filePath] || 0;
      if (mtime > 0) {
        this.fileTimestamps.set(filePath, mtime);
      }
      for (const s of symbols) {
        this.addSymbolToBuckets(s);
      }
    }
    this._isFullScanCompleted = true;
  }

  public addSymbolToBuckets(sym: UniversalSymbol): void {
    // Kind bucket
    let kb = this.kindBuckets.get(sym.kind);
    if (!kb) {
      kb = new Set<UniversalSymbol>();
      this.kindBuckets.set(sym.kind, kb);
    }
    kb.add(sym);

    // Project bucket
    const projLower = sym.projectName.toLowerCase();
    let pb = this.projectBuckets.get(projLower);
    if (!pb) {
      pb = new Set<UniversalSymbol>();
      this.projectBuckets.set(projLower, pb);
    }
    pb.add(sym);

    // Token buckets
    const tokens = extractIndexTokens(sym);
    for (const tok of tokens) {
      let tb = this.tokenBuckets.get(tok);
      if (!tb) {
        tb = new Set<UniversalSymbol>();
        this.tokenBuckets.set(tok, tb);
      }
      tb.add(sym);
    }
  }

  private removeSymbolFromBuckets(sym: UniversalSymbol): void {
    const kb = this.kindBuckets.get(sym.kind);
    if (kb) kb.delete(sym);

    const pb = this.projectBuckets.get(sym.projectName.toLowerCase());
    if (pb) pb.delete(sym);

    const tokens = extractIndexTokens(sym);
    for (const tok of tokens) {
      const tb = this.tokenBuckets.get(tok);
      if (tb) tb.delete(sym);
    }
  }

  public scanFileContent(
    filePath: string,
    content: string,
    projectName: string,
    relativePath: string,
    mtime?: number
  ): UniversalSymbol[] {
    const oldSymbols = this.fileCache.get(filePath);
    if (oldSymbols) {
      for (const s of oldSymbols) {
        this.removeSymbolFromBuckets(s);
      }
    }

    if (mtime !== undefined && mtime > 0) {
      this.fileTimestamps.set(filePath, mtime);
    }

    const baseName = path.basename(filePath);
    const internedProj = internString(projectName)!;

    let symbols: UniversalSymbol[] = [];
    if (filePath.endsWith('.cs')) {
      symbols = parseSymbolsFromCSharp(content, filePath, projectName, relativePath);
    } else if (filePath.endsWith('.resx')) {
      symbols = parseSymbolsFromResx(content, filePath, projectName, relativePath);
    } else if (filePath.endsWith('.json')) {
      symbols = parseSymbolsFromAppSettings(content, filePath, projectName, relativePath);
    } else if (filePath.endsWith('.sql')) {
      symbols = parseSymbolsFromSql(content, filePath, projectName, relativePath);
    } else if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
      symbols = parseSymbolsFromYaml(content, filePath, projectName, relativePath);
    } else if (filePath.endsWith('.proto')) {
      symbols = parseSymbolsFromProto(content, filePath, projectName, relativePath);
    } else if (filePath.endsWith('.md')) {
      symbols = parseSymbolsFromMarkdown(content, filePath, projectName, relativePath);
    } else if (filePath.endsWith('.csproj')) {
      const projName = internString(path.basename(filePath, '.csproj'))!;
      symbols = [
        {
          id: `${filePath}:project:${projName}`,
          name: `${projName}.csproj`,
          kind: 'project',
          filePath,
          relativePath,
          projectName: projName,
          line: 1,
          column: 1
        }
      ];
    }

    // Always register the file symbol itself for instant file location matching
    if (!filePath.endsWith('.csproj')) {
      symbols.push({
        id: `${filePath}:file:${baseName}`,
        name: baseName,
        kind: 'file',
        filePath,
        relativePath,
        projectName: internedProj,
        line: 1,
        column: 1,
        metadata: {
          docSummary: internString(relativePath)
        }
      });
    }

    let retainedSymbols = symbols;
    if (this.diskStore) {
      const primary: UniversalSymbol[] = [];
      const secondary: UniversalSymbol[] = [];
      for (const s of symbols) {
        if (PRIMARY_HOT_KINDS.has(s.kind)) {
          primary.push(s);
        } else {
          secondary.push(s);
        }
      }
      this.diskStore.registerFileSymbols(filePath, relativePath, projectName, secondary);
      retainedSymbols = primary;
    }

    for (const s of retainedSymbols) {
      this.addSymbolToBuckets(s);
    }

    this.fileCache.set(filePath, retainedSymbols);
    this.cachedAllSymbols = undefined;
    return symbols;
  }

  public async scanFile(filePath: string, projectName: string, relativePath: string): Promise<UniversalSymbol[]> {
    try {
      if (isIgnoredSearchFile(filePath) || !fs.existsSync(filePath)) {
        this.invalidateFile(filePath);
        return [];
      }
      const stat = await fs.promises.stat(filePath);
      const content = await fs.promises.readFile(filePath, 'utf8');
      return this.scanFileContent(filePath, content, projectName, relativePath, stat.mtimeMs);
    } catch {
      this.invalidateFile(filePath);
      return [];
    }
  }

  public invalidateFile(filePath: string): void {
    const old = this.fileCache.get(filePath);
    if (old) {
      for (const s of old) {
        this.removeSymbolFromBuckets(s);
      }
      this.fileCache.delete(filePath);
      this.fileTimestamps.delete(filePath);
      this.cachedAllSymbols = undefined;
    }
    if (this.diskStore) {
      this.diskStore.registerFileSymbols(filePath, '', '', []);
    }
  }

  public clear(): void {
    this.fileCache.clear();
    this.fileTimestamps.clear();
    this.kindBuckets.clear();
    this.tokenBuckets.clear();
    this.projectBuckets.clear();
    this.cachedAllSymbols = undefined;
    this._isFullScanCompleted = false;
    this.diskStore?.clear();
  }

  public hasFile(filePath: string): boolean {
    return this.fileCache.has(filePath);
  }

  public get fileCount(): number {
    return this.fileCache.size;
  }

  public getAllSymbols(): UniversalSymbol[] {
    if (this.cachedAllSymbols === undefined) {
      const all: UniversalSymbol[] = [];
      for (const list of this.fileCache.values()) {
        all.push(...list);
      }
      this.cachedAllSymbols = all;
    }
    return this.cachedAllSymbols;
  }

  public getSymbolsForMode(mode: SearchFilterMode): UniversalSymbol[] {
    switch (mode) {
      case 'endpoints':
        return Array.from(this.kindBuckets.get('endpoint') || []);
      case 'cqrs':
        return [
          ...Array.from(this.kindBuckets.get('cqrs_command') || []),
          ...Array.from(this.kindBuckets.get('cqrs_query') || []),
          ...Array.from(this.kindBuckets.get('cqrs_handler') || []),
          ...Array.from(this.kindBuckets.get('cqrs_event') || [])
        ];
      case 'database':
        return [
          ...Array.from(this.kindBuckets.get('ef_entity') || []),
          ...Array.from(this.kindBuckets.get('ef_dbset') || []),
          ...Array.from(this.kindBuckets.get('ef_migration') || []),
          ...Array.from(this.kindBuckets.get('db_table') || [])
        ];
      case 'di':
        return Array.from(this.kindBuckets.get('di_registration') || []);
      case 'jobs':
        return Array.from(this.kindBuckets.get('background_job') || []);
      case 'types':
        return [
          ...Array.from(this.kindBuckets.get('class') || []),
          ...Array.from(this.kindBuckets.get('interface') || []),
          ...Array.from(this.kindBuckets.get('record') || []),
          ...Array.from(this.kindBuckets.get('enum') || []),
          ...Array.from(this.kindBuckets.get('enum_member') || [])
        ];
      case 'methods':
        return [
          ...Array.from(this.kindBuckets.get('method') || []),
          ...Array.from(this.kindBuckets.get('property') || []),
          ...Array.from(this.kindBuckets.get('validation_rule') || []),
          ...Array.from(this.kindBuckets.get('mapping_profile') || [])
        ];
      case 'files':
        return [
          ...Array.from(this.kindBuckets.get('file') || []),
          ...Array.from(this.kindBuckets.get('project') || []),
          ...Array.from(this.kindBuckets.get('config_key') || [])
        ];
      default:
        return this.getAllSymbols();
    }
  }

  public getCandidates(
    filterMode: SearchFilterMode,
    tokens: string[],
    projectNameFilter?: string
  ): UniversalSymbol[] {
    const all = this.getAllSymbols();
    if (all.length <= 200) {
      return all;
    }

    let pool: UniversalSymbol[] | undefined;
    if (filterMode && filterMode !== 'all') {
      pool = this.getSymbolsForMode(filterMode);
    }

    if (tokens.length === 0) {
      if (projectNameFilter) {
        const projList = Array.from(this.projectBuckets.get(projectNameFilter) || []);
        if (pool) {
          const poolSet = new Set(pool);
          return projList.filter(s => poolSet.has(s));
        }
        return projList;
      }
      return pool || all;
    }

    const candidateSet = new Set<UniversalSymbol>();
    const rawQuery = tokens.join(' ');
    const rawQueryLower = rawQuery.toLowerCase();

    // 1. Direct token bucket match
    const direct = this.tokenBuckets.get(rawQueryLower);
    if (direct) {
      for (const s of direct) candidateSet.add(s);
    }

    // 2. Query word segments & prefix buckets
    const segments = rawQuery.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|[-_\s/.:]+/).filter(Boolean);
    for (const seg of segments) {
      const segLower = seg.toLowerCase();
      const segBucket = this.tokenBuckets.get(segLower);
      if (segBucket) {
        for (const s of segBucket) candidateSet.add(s);
      }
      if (segLower.length >= 3) {
        const p3 = segLower.slice(0, 3);
        const p3Bucket = this.tokenBuckets.get(p3);
        if (p3Bucket && candidateSet.size < 500) {
          for (const s of p3Bucket) candidateSet.add(s);
        }
      } else if (segLower.length === 2 && candidateSet.size < 100) {
        const p2Bucket = this.tokenBuckets.get(segLower);
        if (p2Bucket) {
          for (const s of p2Bucket) candidateSet.add(s);
        }
      }
    }

    // 3. Acronym bucket match
    const uppercase = rawQuery.replace(/[^A-Z]/g, '').toLowerCase();
    if (uppercase.length >= 2) {
      const acBucket = this.tokenBuckets.get(uppercase);
      if (acBucket) {
        for (const s of acBucket) candidateSet.add(s);
      }
    }

    if (candidateSet.size === 0) {
      return pool || all;
    }

    let candidates = Array.from(candidateSet);
    if (pool) {
      const poolSet = new Set(pool);
      candidates = candidates.filter(s => poolSet.has(s));
    }

    if (projectNameFilter) {
      candidates = candidates.filter(s => s.projectName.toLowerCase().includes(projectNameFilter));
    }

    return candidates;
  }

  public get count(): number {
    let sum = 0;
    for (const list of this.fileCache.values()) {
      sum += list.length;
    }
    return sum;
  }
}

export function extractDomainNoun(name: string): string {
  if (!name) return '';
  return name
    .replace(/(CommandHandler|QueryHandler|DomainEventHandler|EventHandler|Consumer|Handler)$/, '')
    .replace(/(Command|Query|DomainEvent|Event)$/, '')
    .replace(/^(Add|Update|Delete|Create|Remove|Get|Fetch|Clone|Copy|Sync|Process|On|Execute)/, '')
    .replace(/(Added|Updated|Deleted|Created|Removed|Synchronized)$/, '')
    .replace(/(Added|Updated|Deleted|Created|Removed|Synchronized)/, '');
}

export function detectActiveCqrsContext(
  targetQueryOrSymbol?: string | UniversalSymbol | { fsPath: string } | any,
  activeEditor?: {
    document?: {
      fileName: string;
      getText: (range?: any) => string;
      getWordRangeAtPosition?: (pos: any) => any;
    };
    selection?: {
      isEmpty: boolean;
      active: any;
    };
  }
): string {
  // 1. Explicit string query
  if (typeof targetQueryOrSymbol === 'string' && targetQueryOrSymbol.trim().length > 0) {
    return targetQueryOrSymbol.trim();
  }

  // 2. UniversalSymbol object
  if (
    targetQueryOrSymbol &&
    typeof targetQueryOrSymbol === 'object' &&
    'name' in targetQueryOrSymbol &&
    typeof targetQueryOrSymbol.name === 'string' &&
    targetQueryOrSymbol.name.trim().length > 0
  ) {
    return targetQueryOrSymbol.name.trim();
  }

  // 3. Inspect active text editor if open
  if (activeEditor && activeEditor.document) {
    const doc = activeEditor.document;
    const selection = activeEditor.selection;

    // Check highlighted text
    if (selection && !selection.isEmpty) {
      const selectedText = doc.getText(selection).trim();
      if (selectedText.length >= 2 && !selectedText.includes('\n')) {
        return selectedText;
      }
    }

    // Check word under cursor
    if (selection && doc.getWordRangeAtPosition) {
      const wordRange = doc.getWordRangeAtPosition(selection.active);
      if (wordRange) {
        const word = doc.getText(wordRange).trim();
        if (word.length >= 3 && /^[A-Z][A-Za-z0-9_]*$/.test(word)) {
          return word;
        }
      }
    }

    // Check primary class/record/interface name in document
    const text = doc.getText();
    const classMatch = text.match(
      /(?:public|internal|protected|private)?\s*(?:static|abstract|sealed|partial)*\s*(?:record\s+struct|record\s+class|class|interface|record|enum|struct)\s+([A-Za-z0-9_]+)/
    );
    if (classMatch && classMatch[1]) {
      return classMatch[1];
    }

    // Fall back to filename without .cs
    if (doc.fileName) {
      const base = path.basename(doc.fileName, path.extname(doc.fileName));
      if (base && !base.startsWith('.')) {
        return base;
      }
    }
  }

  // 4. vscode.Uri (passed from context menu)
  if (targetQueryOrSymbol && typeof targetQueryOrSymbol === 'object' && 'fsPath' in targetQueryOrSymbol) {
    const fsPath = (targetQueryOrSymbol as { fsPath: string }).fsPath;
    const base = path.basename(fsPath, path.extname(fsPath));
    if (base && !base.startsWith('.')) {
      return base;
    }
  }

  return '';
}

export function buildCqrsFlow(queryOrName: string, index: UniversalSymbolIndex): CqrsFlowResult {
  const cleanName = queryOrName.replace(/^[\$#@&/!:]*/, '').trim();
  const rootNoun = extractDomainNoun(cleanName) || cleanName;
  const allSymbols = index.getAllSymbols();

  const commands: UniversalSymbol[] = [];
  const handlers: UniversalSymbol[] = [];
  const events: UniversalSymbol[] = [];
  const eventHandlers: UniversalSymbol[] = [];

  for (const s of allSymbols) {
    const sNoun = extractDomainNoun(s.name);
    const matches =
      s.name.toLowerCase().includes(cleanName.toLowerCase()) ||
      (rootNoun.length >= 3 && sNoun.toLowerCase().includes(rootNoun.toLowerCase())) ||
      (s.metadata?.handledType &&
        (s.metadata.handledType.toLowerCase().includes(cleanName.toLowerCase()) ||
          s.metadata.handledType.toLowerCase().includes(rootNoun.toLowerCase())));

    if (!matches) continue;

    if (s.kind === 'cqrs_command' || s.kind === 'cqrs_query') {
      commands.push(s);
    } else if (s.kind === 'cqrs_handler') {
      if (
        s.name.endsWith('DomainEventHandler') ||
        s.name.endsWith('EventHandler') ||
        s.metadata?.handledType?.endsWith('Event')
      ) {
        eventHandlers.push(s);
      } else {
        handlers.push(s);
      }
    } else if (s.kind === 'cqrs_event') {
      events.push(s);
    }
  }

  // Sort items so exact matches appear at the top
  const rankByRelevance = (list: UniversalSymbol[]) => {
    return list.sort((a, b) => {
      const aExact =
        a.name.toLowerCase() === cleanName.toLowerCase() ||
        a.metadata?.handledType?.toLowerCase() === cleanName.toLowerCase();
      const bExact =
        b.name.toLowerCase() === cleanName.toLowerCase() ||
        b.metadata?.handledType?.toLowerCase() === cleanName.toLowerCase();
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      return a.name.localeCompare(b.name);
    });
  };

  rankByRelevance(commands);
  rankByRelevance(handlers);
  rankByRelevance(events);
  rankByRelevance(eventHandlers);

  const nodes: CqrsFlowNode[] = [];

  for (const cmd of commands) {
    nodes.push({
      category: '1. Request / Command',
      icon: '$(symbol-event)',
      symbol: cmd,
      label: `📥 ${cmd.name}`,
      detail: `[${cmd.projectName}] ${cmd.relativePath}:${cmd.line}`
    });
  }

  for (const h of handlers) {
    const handledText = h.metadata?.handledType ? ` (Handles: ${h.metadata.handledType})` : '';
    nodes.push({
      category: '2. Command Handler',
      icon: '$(zap)',
      symbol: h,
      label: `⚡ ${h.name}`,
      detail: `[${h.projectName}] ${h.relativePath}:${h.line}${handledText}`
    });
  }

  for (const e of events) {
    nodes.push({
      category: '3. Domain Event',
      icon: '$(megaphone)',
      symbol: e,
      label: `📢 ${e.name}`,
      detail: `[${e.projectName}] ${e.relativePath}:${e.line}`
    });
  }

  for (const eh of eventHandlers) {
    const listensText = eh.metadata?.handledType ? ` (Listens to: ${eh.metadata.handledType})` : '';
    nodes.push({
      category: '4. Event Listener',
      icon: '$(radio-tower)',
      symbol: eh,
      label: `👂 ${eh.name}`,
      detail: `[${eh.projectName}] ${eh.relativePath}:${eh.line}${listensText}`
    });
  }

  return {
    rootNoun,
    nodes
  };
}

