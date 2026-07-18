import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compareNugetVersionsDescending,
  isNewerNugetVersion,
  parseOutdated,
  parseSearchResponse,
  parseVersionsResponse
} from '../nugetService';

test('parses NuGet search results into package summaries', () => {
  const result = parseSearchResponse({
    data: [{
      id: 'Newtonsoft.Json',
      version: '13.0.3',
      description: 'Popular high-performance JSON framework for .NET',
      totalDownloads: 6_000_000_000,
      ignored: 'value'
    }]
  });

  assert.deepEqual(result, [{
    id: 'Newtonsoft.Json',
    latestVersion: '13.0.3',
    description: 'Popular high-performance JSON framework for .NET',
    totalDownloads: 6_000_000_000
  }]);
});

test('filters prerelease NuGet versions when disabled', () => {
  const response = {
    versions: ['2.0.0-beta.2', '1.0.0', '2.0.0', '2.0.0-rc.1']
  };

  assert.deepEqual(parseVersionsResponse(response, false), ['2.0.0', '1.0.0']);
  assert.deepEqual(
    parseVersionsResponse(response, true),
    ['2.0.0', '2.0.0-rc.1', '2.0.0-beta.2', '1.0.0']
  );
});

test('sorts NuGet semantic versions descending including prerelease tags', () => {
  const versions = [
    '1.0.0-beta.10',
    '1.0.0',
    '2.0.0-alpha',
    '1.0.0-beta.2',
    '1.10.0',
    '1.2.0'
  ];

  assert.deepEqual(versions.sort(compareNugetVersionsDescending), [
    '2.0.0-alpha',
    '1.10.0',
    '1.2.0',
    '1.0.0',
    '1.0.0-beta.10',
    '1.0.0-beta.2'
  ]);
  assert.equal(isNewerNugetVersion('2.0.0', '2.0.0-rc.1'), true);
  assert.equal(isNewerNugetVersion('1.9.0', '2.0.0'), false);
  assert.equal(isNewerNugetVersion('2.0.0', '2.0.0'), false);
});

test('parses outdated package rows by project and ignores headers and frameworks', () => {
  const stdout = [
    "Project `src/App/App.csproj` has the following updates to its packages",
    '   [net8.0]:',
    '   Top-level Package             Requested   Resolved   Latest',
    '   > Newtonsoft.Json             12.0.1      12.0.1    13.0.3',
    '   > Microsoft.Extensions.Http   8.0.0       8.0.0     9.0.1',
    '   Transitive Package      Resolved   Latest',
    "Project 'tests/App.Tests.csproj' has the following updates to its packages",
    '   > FluentAssertions   6.12.0   6.12.0   7.2.0'
  ].join('\n');

  assert.deepEqual(parseOutdated(stdout), new Map([
    ['src/App/App.csproj', new Map([
      ['Newtonsoft.Json', '13.0.3'],
      ['Microsoft.Extensions.Http', '9.0.1']
    ])],
    ['tests/App.Tests.csproj', new Map([
      ['FluentAssertions', '7.2.0']
    ])]
  ]));
});

test('uses the supplied project path when dotnet omits a project heading', () => {
  const parsed = parseOutdated(
    '   > Serilog   3.1.0   3.1.0   4.2.0',
    '/repo/App/App.csproj'
  );

  assert.deepEqual(parsed, new Map([
    ['/repo/App/App.csproj', new Map([['Serilog', '4.2.0']])]
  ]));
});
