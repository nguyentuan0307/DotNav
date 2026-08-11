import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSmartBuildTraversal } from '../build/smartBuildTraversal';
import { EvaluatedProjectVariant } from '../build/types';

test('Smart Build traversal disables recursive project builds and optionally restores once', () => {
  const project = variant('/repo/A & tools/A.csproj');
  const withRestore = createSmartBuildTraversal([project, project], true);
  assert.equal((withRestore.match(/SmartBuildProject Include=/g) ?? []).length, 1);
  assert.match(withRestore, /A &amp; tools/);
  assert.match(withRestore, /Targets="Restore"/);
  assert.match(withRestore, /BuildProjectReferences=false/);
  assert.match(withRestore, /AdditionalProperties>Configuration=Debug;Platform=AnyCPU/);
  assert.equal((createSmartBuildTraversal([project], false).match(/Targets="Restore"/g) ?? []).length, 0);
});

test('Smart Build traversal schedules dependencies before dependents', () => {
  const dependency = variant('/repo/A.csproj');
  const dependent = { ...variant('/repo/B.csproj'), projectReferences: [dependency.projectPath] };
  const traversal = createSmartBuildTraversal([dependent, dependency], false);
  const firstBuild = traversal.indexOf('Projects="@(SmartBuildLevel0)"');
  const secondBuild = traversal.indexOf('Projects="@(SmartBuildLevel1)"');
  assert.ok(firstBuild >= 0 && secondBuild > firstBuild);
  assert.match(traversal, /SmartBuildLevel0 Include="\/repo\/A\.csproj"/);
  assert.match(traversal, /SmartBuildLevel1 Include="\/repo\/B\.csproj"/);
});

test('opaque fallback projects retain recursive MSBuild semantics', () => {
  const project = variant('/repo/Custom.csproj');
  const traversal = createSmartBuildTraversal([project], false, new Set([project.projectPath]));
  assert.match(traversal, /SmartBuildFallbackLevel0 Include=/);
  assert.match(traversal, /BuildProjectReferences=true/);
  assert.doesNotMatch(traversal, /BuildProjectReferences=false/);
});

function variant(projectPath: string): EvaluatedProjectVariant {
  return {
    id: projectPath, projectPath, projectName: 'A', configuration: 'Debug', platform: 'AnyCPU',
    targetFramework: 'net6.0', runtimeIdentifier: '', targetPath: '', referenceAssemblyPath: '',
    intermediateOutputPath: '', outputPath: '', assetsFile: '', isSdkStyle: true, isOpaque: false,
    opaqueReasons: [], projectReferences: [], inputs: [], imports: [], outputs: [], copies: []
  };
}
