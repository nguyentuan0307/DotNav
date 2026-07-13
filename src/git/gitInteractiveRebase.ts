import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { runGit } from './gitCli';
import { GitRebasePlanItem } from './gitPanelModels';
import { GitCommandError } from './gitRepositoryService';

/** Runs an explicit rebase plan without opening a terminal editor. */
export async function runInteractiveRebase(root: string, base: string, plan: GitRebasePlanItem[], token?: vscode.CancellationToken): Promise<void> {
  validatePlan(plan);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'solution-navigator-rebase-'));
  const planPath = path.join(directory, 'plan.json');
  const messagesPath = path.join(directory, 'messages.json');
  const sequenceEditor = path.join(directory, 'sequence-editor.js');
  const messageEditor = path.join(directory, 'message-editor.js');
  try {
    await fs.writeFile(planPath, JSON.stringify(plan), 'utf8');
    await fs.writeFile(messagesPath, JSON.stringify(plan.filter(item => item.action === 'reword').map(item => item.message || item.subject)), 'utf8');
    await fs.writeFile(sequenceEditor, sequenceEditorSource, 'utf8');
    await fs.writeFile(messageEditor, messageEditorSource, 'utf8');
    const result = await runGit(root, ['rebase', '-i', base], token, undefined, {
      GIT_SEQUENCE_EDITOR: `node "${sequenceEditor}"`,
      GIT_EDITOR: `node "${messageEditor}"`,
      DSN_REBASE_PLAN: planPath,
      DSN_REBASE_MESSAGES: messagesPath
    });
    if (result.cancelled) throw new vscode.CancellationError();
    if (result.exitCode !== 0) throw new GitCommandError(['rebase', '-i', base], result.stderr, result.exitCode);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function validatePlan(plan: GitRebasePlanItem[]): void {
  if (!plan.length) throw new Error('Interactive rebase requires at least one commit.');
  if (plan[0].action === 'squash' || plan[0].action === 'fixup') throw new Error('The first commit cannot be squash or fixup.');
  const hashes = new Set<string>();
  for (const item of plan) {
    if (hashes.has(item.hash)) throw new Error(`Commit ${item.hash} appears more than once in the rebase plan.`);
    hashes.add(item.hash);
  }
}

const sequenceEditorSource = String.raw`const fs=require('fs');const todo=process.argv[2];const plan=JSON.parse(fs.readFileSync(process.env.DSN_REBASE_PLAN,'utf8'));const lines=fs.readFileSync(todo,'utf8').split(/\r?\n/);const commands=lines.filter(x=>/^(pick|reword|edit|squash|fixup|drop)\s+/.test(x));const comments=lines.filter(x=>!x||x.startsWith('#'));const output=plan.map(item=>{const found=commands.find(line=>{const hash=line.trim().split(/\s+/)[1];return item.hash.startsWith(hash)||hash.startsWith(item.hash)});if(!found)throw new Error('Commit not present in rebase todo: '+item.hash);return item.action+' '+found.trim().split(/\s+/).slice(1).join(' ')});fs.writeFileSync(todo,output.concat(comments).join('\n'));`;
const messageEditorSource = String.raw`const fs=require('fs');const file=process.argv[2],state=process.env.DSN_REBASE_MESSAGES;const messages=JSON.parse(fs.readFileSync(state,'utf8'));if(messages.length){fs.writeFileSync(file,messages.shift()+'\n');fs.writeFileSync(state,JSON.stringify(messages));}`;
