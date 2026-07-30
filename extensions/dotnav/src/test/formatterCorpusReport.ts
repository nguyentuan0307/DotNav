import {
  FormatterCorpusCase,
  FormatterCorpusState,
  formatterCorpus
} from './fixtures/formatterCorpus';

const stateLabels: Record<FormatterCorpusState, string> = {
  'bad-format': 'Badly formatted input',
  'well-formatted': 'Already well-formatted input',
  malformed: 'Malformed or ambiguous input'
};

for (const state of ['bad-format', 'well-formatted', 'malformed'] as const) {
  const cases = formatterCorpus.filter(value => value.state === state);
  console.log(`# ${stateLabels[state]} (${cases.length})\n`);
  for (const corpusCase of cases) printCase(corpusCase);
}

function printCase(corpusCase: FormatterCorpusCase): void {
  console.log(`## ${corpusCase.name}`);
  console.log(`Category: ${corpusCase.category}\n`);
  console.log('Input:');
  console.log('```csharp');
  console.log(corpusCase.input);
  console.log('```\n');
  console.log('Expected:');
  console.log('```csharp');
  console.log(corpusCase.expected);
  console.log('```\n');
}
