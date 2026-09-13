import * as assert from 'assert';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { parseSlnfFile, writeSlnfFile } from '../scope/slnfService';

describe('SlnfService', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dotnav-slnf-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('writes and reads Microsoft .slnf file accurately', async () => {
    const slnPath = path.join(tempDir, 'ELDesk.sln');
    const slnfPath = path.join(tempDir, 'CustomApp-Work.slnf');
    const projectA = path.join(tempDir, 'src/Services/CustomApp/CustomApp.csproj');
    const projectB = path.join(tempDir, 'src/Services/Work/Work.csproj');

    await writeSlnfFile(slnfPath, slnPath, [projectA, projectB]);

    const fileContent = await fs.readFile(slnfPath, 'utf8');
    const json = JSON.parse(fileContent);

    assert.strictEqual(json.solution.path, 'ELDesk.sln');
    assert.strictEqual(json.solution.projects.length, 2);
    assert.ok(json.solution.projects[0].includes('CustomApp.csproj'));
    assert.ok(json.solution.projects[1].includes('Work.csproj'));

    const parsed = await parseSlnfFile(slnfPath);
    assert.strictEqual(path.resolve(parsed.solutionAbsolutePath), path.resolve(slnPath));
    assert.strictEqual(parsed.projectAbsolutePaths.length, 2);
    assert.strictEqual(path.resolve(parsed.projectAbsolutePaths[0]), path.resolve(projectA));
    assert.strictEqual(path.resolve(parsed.projectAbsolutePaths[1]), path.resolve(projectB));
  });

  it('throws descriptive error on invalid .slnf format', async () => {
    const badSlnfPath = path.join(tempDir, 'invalid.slnf');
    await fs.writeFile(badSlnfPath, JSON.stringify({ invalid: true }), 'utf8');

    await assert.rejects(
      async () => {
        await parseSlnfFile(badSlnfPath);
      },
      /Invalid \.slnf format/
    );
  });
});
