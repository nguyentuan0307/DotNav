import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { UniversalSymbol, UniversalSymbolKind } from './searchModel';

export interface CompactDiskSymbol {
  n: string; // name
  k: UniversalSymbolKind; // kind
  f: string; // filePath
  r: string; // relativePath
  p: string; // projectName
  l: number; // line
  c: number; // column
  rt?: string; // returnType / baseType
  ps?: string; // parameterSummary / configValue
}

export class DiskSymbolStore {
  private cacheDir: string;
  private isInitialized = false;

  // Inverted word index for cold symbols: word -> Set of file paths
  // Since this only maps word -> file paths (not full objects), 50k words -> ~3MB RAM
  private readonly wordToFileMap = new Map<string, Set<string>>();
  private readonly fileSymbolsMap = new Map<string, CompactDiskSymbol[]>();
  private readonly dirtyFiles = new Set<string>();
  private saveDebounceTimer?: NodeJS.Timeout;

  constructor(cacheDir?: string) {
    this.cacheDir = cacheDir || path.join(process.cwd(), '.dotnav', 'cache');
  }

  public setCacheDir(dir: string): void {
    this.cacheDir = dir;
  }

  public get storagePath(): string {
    return path.join(this.cacheDir, 'cold_symbols.gz');
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;
    try {
      if (!fs.existsSync(this.cacheDir)) {
        await fs.promises.mkdir(this.cacheDir, { recursive: true });
      }
      await this.loadFromDisk();
    } catch {
      // Best-effort initialization
    }
  }

  public registerFileSymbols(
    filePath: string,
    relativePath: string,
    projectName: string,
    symbols: UniversalSymbol[]
  ): void {
    // Remove old tokens for this file
    this.removeFileTokens(filePath);

    if (symbols.length === 0) {
      this.fileSymbolsMap.delete(filePath);
      this.dirtyFiles.add(filePath);
      this.scheduleSave();
      return;
    }

    const compactList: CompactDiskSymbol[] = [];
    for (const s of symbols) {
      compactList.push({
        n: s.name,
        k: s.kind,
        f: s.filePath,
        r: s.relativePath,
        p: s.projectName,
        l: s.line,
        c: s.column,
        rt: s.metadata?.returnType || s.metadata?.baseType,
        ps: s.metadata?.parameterSummary || s.metadata?.configValue
      });

      this.indexSymbolTokens(filePath, s.name);
    }

    this.fileSymbolsMap.set(filePath, compactList);
    this.dirtyFiles.add(filePath);
    this.scheduleSave();
  }

  private indexSymbolTokens(filePath: string, name: string): void {
    const bareName = name.split('(')[0].replace(/^(DbSet|Table|Map|RuleFor|Job|AddScoped|AddTransient|AddSingleton):\s*/i, '').trim();
    const bareLower = bareName.toLowerCase();
    if (bareLower.length >= 2) {
      let fSet = this.wordToFileMap.get(bareLower);
      if (!fSet) {
        fSet = new Set<string>();
        this.wordToFileMap.set(bareLower, fSet);
      }
      fSet.add(filePath);
    }

    const words = bareName.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|[-_\s/.:{}="',<>]+/).filter(w => w.length >= 2);
    for (const w of words) {
      const wLower = w.toLowerCase();
      let fileSet = this.wordToFileMap.get(wLower);
      if (!fileSet) {
        fileSet = new Set<string>();
        this.wordToFileMap.set(wLower, fileSet);
      }
      fileSet.add(filePath);
      if (wLower.length >= 4) {
        const p3 = wLower.slice(0, 3);
        let p3Set = this.wordToFileMap.get(p3);
        if (!p3Set) {
          p3Set = new Set<string>();
          this.wordToFileMap.set(p3, p3Set);
        }
        p3Set.add(filePath);
      }
    }
  }

  private removeFileTokens(filePath: string): void {
    const oldSymbols = this.fileSymbolsMap.get(filePath);
    if (!oldSymbols) return;

    for (const s of oldSymbols) {
      const bareName = s.n.split('(')[0].replace(/^(DbSet|Table|Map|RuleFor|Job|AddScoped|AddTransient|AddSingleton):\s*/i, '').trim();
      const bareLower = bareName.toLowerCase();
      const bareSet = this.wordToFileMap.get(bareLower);
      if (bareSet) {
        bareSet.delete(filePath);
        if (bareSet.size === 0) this.wordToFileMap.delete(bareLower);
      }

      const words = bareName.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|[-_\s/.:{}="',<>]+/).filter(w => w.length >= 2);
      for (const w of words) {
        const wLower = w.toLowerCase();
        const fileSet = this.wordToFileMap.get(wLower);
        if (fileSet) {
          fileSet.delete(filePath);
          if (fileSet.size === 0) {
            this.wordToFileMap.delete(wLower);
          }
        }
        if (wLower.length >= 4) {
          const p3 = wLower.slice(0, 3);
          const p3Set = this.wordToFileMap.get(p3);
          if (p3Set) {
            p3Set.delete(filePath);
            if (p3Set.size === 0) this.wordToFileMap.delete(p3);
          }
        }
      }
    }
  }

  public searchColdSymbols(tokens: string[], limit = 50): UniversalSymbol[] {
    if (tokens.length === 0) return [];

    const candidateFiles = new Set<string>();
    const searchTerms: string[] = [];

    for (const tok of tokens) {
      const tokLower = tok.toLowerCase();
      searchTerms.push(tokLower);
      const subWords = tok.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|[-_\s/.:{}="',<>]+/).filter(w => w.length >= 2);
      for (const sw of subWords) {
        searchTerms.push(sw.toLowerCase());
      }
    }

    for (const term of searchTerms) {
      const direct = this.wordToFileMap.get(term);
      if (direct) {
        for (const f of direct) candidateFiles.add(f);
      }
      if (term.length >= 3) {
        const p3 = term.slice(0, 3);
        const p3Set = this.wordToFileMap.get(p3);
        if (p3Set && candidateFiles.size < 50) {
          for (const f of p3Set) candidateFiles.add(f);
        }
      }
    }

    if (candidateFiles.size === 0) {
      return [];
    }

    const results: UniversalSymbol[] = [];

    for (const filePath of candidateFiles) {
      const symbols = this.fileSymbolsMap.get(filePath);
      if (!symbols) continue;

      for (const s of symbols) {
        const nameLower = s.n.toLowerCase();
        let matched = false;
        for (const term of searchTerms) {
          if (nameLower.includes(term)) {
            matched = true;
            break;
          }
        }

        if (matched) {
          results.push({
            id: `${s.f}:${s.l}:${s.k}:${s.n}`,
            name: s.n,
            kind: s.k,
            filePath: s.f,
            relativePath: s.r,
            projectName: s.p,
            line: s.l,
            column: s.c,
            metadata: {
              returnType: s.rt,
              parameterSummary: s.ps
            }
          });
          if (results.length >= limit * 2) break;
        }
      }
      if (results.length >= limit * 2) break;
    }

    return results.slice(0, limit);
  }

  public clear(): void {
    this.wordToFileMap.clear();
    this.fileSymbolsMap.clear();
    this.dirtyFiles.clear();
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = undefined;
    }
  }

  public async purgeDiskCache(): Promise<void> {
    this.clear();
    try {
      if (fs.existsSync(this.storagePath)) {
        await fs.promises.unlink(this.storagePath);
      }
      const tmpPath = `${this.storagePath}.tmp`;
      if (fs.existsSync(tmpPath)) {
        await fs.promises.unlink(tmpPath);
      }
    } catch {}
  }

  private scheduleSave(): void {
    if (this.saveDebounceTimer) return;
    this.saveDebounceTimer = setTimeout(async () => {
      this.saveDebounceTimer = undefined;
      await this.saveToDisk();
    }, 2000);
  }

  public async saveToDisk(): Promise<void> {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        await fs.promises.mkdir(this.cacheDir, { recursive: true });
      }
      const data: Record<string, CompactDiskSymbol[]> = {};
      for (const [fp, syms] of this.fileSymbolsMap.entries()) {
        data[fp] = syms;
      }
      const jsonStr = JSON.stringify(data);
      const compressed = await new Promise<Buffer>((resolve, reject) => {
        zlib.gzip(Buffer.from(jsonStr), { level: 6 }, (err, buf) => {
          if (err) reject(err);
          else resolve(buf);
        });
      });
      const tempPath = `${this.storagePath}.tmp`;
      await fs.promises.writeFile(tempPath, compressed);
      await fs.promises.rename(tempPath, this.storagePath);
      this.dirtyFiles.clear();
    } catch {
      // Ignore disk write errors
    }
  }

  public async loadFromDisk(): Promise<boolean> {
    try {
      if (!fs.existsSync(this.storagePath)) {
        return false;
      }
      const compressed = await fs.promises.readFile(this.storagePath);
      const jsonStr = await new Promise<string>((resolve, reject) => {
        zlib.gunzip(compressed, (err, buf) => {
          if (err) reject(err);
          else resolve(buf.toString('utf8'));
        });
      });
      const data: Record<string, CompactDiskSymbol[]> = JSON.parse(jsonStr);
      if (!data) return false;

      this.clear();
      for (const [filePath, symbols] of Object.entries(data)) {
        this.fileSymbolsMap.set(filePath, symbols);
        for (const s of symbols) {
          this.indexSymbolTokens(filePath, s.n);
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  public get count(): number {
    let total = 0;
    for (const list of this.fileSymbolsMap.values()) {
      total += list.length;
    }
    return total;
  }
}
