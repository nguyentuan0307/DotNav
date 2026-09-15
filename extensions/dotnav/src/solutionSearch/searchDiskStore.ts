import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { UniversalSymbol, UniversalSymbolKind, CompactDiskSymbol } from './searchModel';

export { CompactDiskSymbol };

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

  public get cacheFilePath(): string {
    return this.storagePath;
  }

  public get coldSymbolCount(): number {
    let count = 0;
    for (const list of this.fileSymbolsMap.values()) {
      count += list.length;
    }
    return count;
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

  private static readonly STOP_WORDS = new Set([
    'get', 'set', 'async', 'is', 'has', 'to', 'by', 'for', 'in', 'on', 'of', 'and', 'or', 'not', 'with', 'from', 'at'
  ]);

  private indexSymbolTokens(filePath: string, name: string): void {
    if (!name) return;
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

    const simpleName = bareName.includes('.') ? bareName.split('.').pop()! : '';
    if (simpleName && simpleName.length >= 2) {
      const simpleLower = simpleName.toLowerCase();
      let sfSet = this.wordToFileMap.get(simpleLower);
      if (!sfSet) {
        sfSet = new Set<string>();
        this.wordToFileMap.set(simpleLower, sfSet);
      }
      sfSet.add(filePath);
    }

    const uppercase = bareName.replace(/[^A-Z]/g, '').toLowerCase();
    if (uppercase.length >= 2) {
      let acSet = this.wordToFileMap.get(uppercase);
      if (!acSet) {
        acSet = new Set<string>();
        this.wordToFileMap.set(uppercase, acSet);
      }
      acSet.add(filePath);
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
      if (!s || !s.n) continue;
      const bareName = s.n.split('(')[0].replace(/^(DbSet|Table|Map|RuleFor|Job|AddScoped|AddTransient|AddSingleton):\s*/i, '').trim();
      const bareLower = bareName.toLowerCase();
      const bareSet = this.wordToFileMap.get(bareLower);
      if (bareSet) {
        bareSet.delete(filePath);
        if (bareSet.size === 0) this.wordToFileMap.delete(bareLower);
      }

      const simpleName = bareName.includes('.') ? bareName.split('.').pop()! : '';
      if (simpleName && simpleName.length >= 2) {
        const simpleLower = simpleName.toLowerCase();
        const sfSet = this.wordToFileMap.get(simpleLower);
        if (sfSet) {
          sfSet.delete(filePath);
          if (sfSet.size === 0) this.wordToFileMap.delete(simpleLower);
        }
      }

      const uppercase = bareName.replace(/[^A-Z]/g, '').toLowerCase();
      if (uppercase.length >= 2) {
        const acSet = this.wordToFileMap.get(uppercase);
        if (acSet) {
          acSet.delete(filePath);
          if (acSet.size === 0) this.wordToFileMap.delete(uppercase);
        }
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

  public searchColdSymbols(tokens: string[], limit = 100): UniversalSymbol[] {
    if (tokens.length === 0) return [];

    const rawTerms: string[] = [];
    const specificTerms: string[] = [];
    const stopTerms: string[] = [];

    for (const tok of tokens) {
      const tokLower = tok.toLowerCase();
      rawTerms.push(tokLower);
      const subWords = tok.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|[-_\s/.:{}="',<>]+/).filter(w => w.length >= 2);
      for (const sw of subWords) {
        const swLower = sw.toLowerCase();
        if (DiskSymbolStore.STOP_WORDS.has(swLower)) {
          stopTerms.push(swLower);
        } else {
          specificTerms.push(swLower);
        }
      }
      const upper = tok.replace(/[^A-Z]/g, '').toLowerCase();
      if (upper.length >= 2) {
        specificTerms.push(upper);
      }
    }

    specificTerms.sort((a, b) => b.length - a.length);

    const filePriority = new Map<string, number>();
    const addFileWithPriority = (file: string, priority: number) => {
      const cur = filePriority.get(file) || 0;
      if (priority > cur) filePriority.set(file, priority);
    };

    // 1. Direct full token matches (highest priority = 3)
    for (const raw of rawTerms) {
      const direct = this.wordToFileMap.get(raw);
      if (direct) {
        for (const f of direct) addFileWithPriority(f, 3);
      }
    }

    // 2. Specific terms (priority = 2)
    for (const term of specificTerms) {
      const direct = this.wordToFileMap.get(term);
      if (direct) {
        for (const f of direct) addFileWithPriority(f, 2);
      }
      if (term.length >= 4) {
        const p3 = term.slice(0, 3);
        const p3Set = this.wordToFileMap.get(p3);
        if (p3Set && p3Set.size < 100) {
          for (const f of p3Set) addFileWithPriority(f, 1);
        }
      }
    }

    // 3. Fallback to stop terms ONLY if no candidate files found from specific/raw terms
    if (filePriority.size === 0) {
      for (const term of stopTerms) {
        const direct = this.wordToFileMap.get(term);
        if (direct) {
          for (const f of direct) addFileWithPriority(f, 1);
        }
      }
    }

    if (filePriority.size === 0) {
      return [];
    }

    const sortedFiles = Array.from(filePriority.keys()).sort((a, b) => {
      return (filePriority.get(b) || 0) - (filePriority.get(a) || 0);
    });

    const results: { sym: UniversalSymbol; score: number }[] = [];

    for (const filePath of sortedFiles) {
      const symbols = this.fileSymbolsMap.get(filePath);
      if (!symbols) continue;

      for (const s of symbols) {
        const nameLower = s.n.toLowerCase();
        let matchScore = 0;

        for (const raw of rawTerms) {
          if (nameLower.split('(')[0].trim() === raw) {
            matchScore += 100;
          } else if (nameLower.includes(raw)) {
            matchScore += 80;
          }
        }

        for (const term of specificTerms) {
          if (nameLower.includes(term)) {
            matchScore += term.length * 5;
          }
        }

        const upper = s.n.replace(/[^A-Z]/g, '').toLowerCase();
        for (const raw of rawTerms) {
          if (upper.length >= 2 && (upper === raw || upper.startsWith(raw))) {
            matchScore += 60;
          }
        }

        if (specificTerms.length === 0 && matchScore === 0) {
          for (const term of stopTerms) {
            if (nameLower.includes(term)) {
              matchScore += 20;
              break;
            }
          }
        }

        if (matchScore > 0) {
          results.push({
            sym: {
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
            },
            score: matchScore
          });
        }
      }

      if (results.length >= limit * 4) {
        break;
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit).map(r => r.sym);
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

  public hasFile(filePath: string): boolean {
    return this.fileSymbolsMap.has(filePath);
  }

  public exportData(): Record<string, CompactDiskSymbol[]> {
    const data: Record<string, CompactDiskSymbol[]> = {};
    for (const [fp, syms] of this.fileSymbolsMap.entries()) {
      data[fp] = syms;
    }
    return data;
  }

  public loadData(data: Record<string, CompactDiskSymbol[]>): void {
    this.clear();
    if (!data) return;
    for (const [filePath, symbols] of Object.entries(data)) {
      this.fileSymbolsMap.set(filePath, symbols);
      for (const s of symbols) {
        this.indexSymbolTokens(filePath, s.n);
      }
    }
  }

  public async saveToDisk(): Promise<void> {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        await fs.promises.mkdir(this.cacheDir, { recursive: true });
      }
      const data = this.exportData();
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

      this.loadData(data);
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
