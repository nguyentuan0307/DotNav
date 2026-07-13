import * as path from 'path';
import * as vscode from 'vscode';
import { GitLogFilter } from './gitPanelModels';
import { GitRepositoryService } from './gitRepositoryService';
import { revisionUri } from './gitRevisionProvider';
import { GitMutationRunner } from './gitMutationRunner';
import { GitMutationRequest } from './gitPanelModels';

interface WebviewMessage { type: string; root?: string; hash?: string; hashes?: string[]; path?: string; ref?: string; action?: string; kind?: string; operation?: string; parent?: number; offset?: number; filter?: GitLogFilter; }

export class GitLogViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'dotnetSolutionNavigator.gitLog';
  private view?: vscode.WebviewView;
  private root?: string;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly mutations: GitMutationRunner;
  private autoFetchTimer?: NodeJS.Timeout;

  constructor(private readonly service: GitRepositoryService, private readonly extensionUri: vscode.Uri) {
    this.mutations = new GitMutationRunner(service);
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    view.webview.html = renderHtml(view.webview);
    this.disposables.push(view.webview.onDidReceiveMessage(message => this.handle(message)));
    this.configureAutoFetch();
  }

  async refresh(): Promise<void> {
    if (!this.view) return;
    const repositories = await this.service.discoverRepositories();
    if (!this.root || !repositories.includes(this.root)) this.root = repositories[0];
    if (!this.root) return this.post({ type: 'state', repositories });
    const [repository, log, uncommitted] = await Promise.all([
      this.service.snapshot(this.root), this.service.log(this.root, 0, 200, {}), this.service.workingTreeFiles(this.root)
    ]);
    this.post({ type: 'state', repositories, repository, log, uncommitted });
  }

  dispose(): void {
    if (this.autoFetchTimer) clearInterval(this.autoFetchTimer);
    this.disposables.splice(0).forEach(item => item.dispose());
  }

  configureAutoFetch(): void {
    if (this.autoFetchTimer) clearInterval(this.autoFetchTimer);
    const config = vscode.workspace.getConfiguration('dotnetSolutionNavigator.gitLog');
    if (!config.get<boolean>('autoFetch', true)) return;
    const minutes = config.get<number>('autoFetchMinutes', 20);
    this.autoFetchTimer = setInterval(() => {
      if (this.root && this.view?.visible) this.mutations.run(this.root, { action: 'fetch' }).then(() => this.refresh(), console.error);
    }, Math.max(1, minutes) * 60_000);
  }

  private async handle(message: WebviewMessage): Promise<void> {
    try {
      if (message.type === 'ready' || message.type === 'refresh') return await this.refresh();
      if (message.type === 'selectRepo' && message.root) { this.root = message.root; return await this.refresh(); }
      if (!this.root) return;
      if (message.type === 'loadLog') {
        return this.post({ type: 'log', log: await this.service.log(this.root, message.offset ?? 0, 200, message.filter ?? {}) });
      }
      if (message.type === 'detail' && message.hash) {
        return this.post({ type: 'detail', detail: await this.service.commitDetail(this.root, message.hash, message.parent) });
      }
      if (message.type === 'diff' && message.hash && message.path) return await this.openDiff(message.hash, message.path, message.parent);
      if (message.type === 'workingDiff' && message.path) return await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path.join(this.root, message.path)));
      if (message.type === 'openFile' && message.path) {
        await vscode.window.showTextDocument(vscode.Uri.file(path.join(this.root, message.path)));
        return;
      }
      if (message.type === 'copy' && message.hash) return await vscode.env.clipboard.writeText(message.hash);
      if (message.type === 'openConflict' && message.path) return await this.openConflict(message.path);
      if (message.type === 'compare' && message.hashes?.length === 2) {
        const files = await this.service.filesBetween(this.root, message.hashes[0], message.hashes[1]);
        return this.post({ type: 'compareFiles', files, from: message.hashes[0], to: message.hashes[1] });
      }
      if (message.type === 'mutate' && message.action) {
        if (message.action === 'continue') {
          const unresolved = (await this.service.workingTreeFiles(this.root)).filter(file => file.conflict);
          if (unresolved.length) throw new Error(`Resolve these files before continuing: ${unresolved.map(file => file.path).join(', ')}`);
        }
        const request = await this.prepareMutation(message);
        if (request && await this.mutations.run(this.root, request)) await this.refresh();
      }
      if (message.type === 'context') await this.showContextMenu(message);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.post({ type: 'error', message: text });
      vscode.window.showErrorMessage(text);
    }
  }

  private async showContextMenu(message: WebviewMessage): Promise<void> {
    const actions = contextActions(message.kind);
    const selected = await vscode.window.showQuickPick(actions, { title: message.ref ?? message.hash ?? message.path });
    if (!selected) return;
    if (selected.action === 'copy') {
      await vscode.env.clipboard.writeText(message.ref ?? message.hash ?? message.path ?? '');
      return;
    }
    if (selected.action === 'diff' && message.hash && message.path) return await this.openDiff(message.hash, message.path, message.parent);
    if (selected.action === 'openRevision' && message.hash && message.path) {
      await vscode.window.showTextDocument(revisionUri(this.root!, message.hash, message.path), { preview: true });
      return;
    }
    if (selected.action === 'openFile' && message.path) {
      await vscode.window.showTextDocument(vscode.Uri.file(path.join(this.root!, message.path)));
      return;
    }
    if (selected.action === 'compare' && message.hashes?.length === 2) {
      const files = await this.service.filesBetween(this.root!, message.hashes[0], message.hashes[1]);
      this.post({ type: 'compareFiles', files, from: message.hashes[0], to: message.hashes[1] });
      return;
    }
    const request = await this.prepareMutation({ ...message, type: 'mutate', action: selected.action });
    if (request && await this.mutations.run(this.root!, request)) await this.refresh();
  }

  private async prepareMutation(message: WebviewMessage): Promise<GitMutationRequest | undefined> {
    const action = message.action!;
    if (action === 'stash') {
      const value = await vscode.window.showInputBox({ title: 'Stash Changes', prompt: 'Stash message', value: `WIP on ${new Date().toLocaleString()}` });
      return value === undefined ? undefined : { action, options: { message: value, includeUntracked: true } };
    }
    if (action === 'createBranch') {
      const name = await vscode.window.showInputBox({ title: 'New Branch', prompt: 'Branch name', validateInput: validateRefName });
      return name ? { action, ref: message.ref, options: { name, checkout: true } } : undefined;
    }
    if (action === 'update') {
      const strategy = await vscode.window.showQuickPick([
        { label: 'Merge', value: 'merge' }, { label: 'Rebase', value: 'rebase' },
        { label: 'Reset to Remote Branch', description: 'Discards local commits and changes', value: 'reset' }
      ], { title: 'Update Project Strategy' });
      if (!strategy) return undefined;
      if (strategy.value === 'reset') {
        const confirmed = await vscode.window.showWarningMessage(
          'Reset to Remote Branch permanently discards local commits and working tree changes.',
          { modal: true }, 'Reset to Remote Branch');
        if (!confirmed) return undefined;
      }
      return { action, options: { strategy: strategy.value } };
    }
    if (action === 'push') {
      const snapshot = await this.service.snapshot(this.root!);
      const forceLease = await vscode.window.showQuickPick([
        { label: 'Push', value: false, description: snapshot.upstream ?? 'Configured upstream' },
        { label: 'Force with Lease', value: true, description: 'Rewrites the remote only if it has not changed' }
      ], { title: 'Push Current Branch' });
      return forceLease ? { action, options: { forceLease: forceLease.value } } : undefined;
    }
    if (action === 'merge') {
      const mode = await vscode.window.showQuickPick([
        { label: 'Merge', noFf: false, squash: false }, { label: 'No Fast-Forward', noFf: true, squash: false },
        { label: 'Squash', noFf: false, squash: true }
      ], { title: `Merge ${message.ref} into Current` });
      return mode ? { action, ref: message.ref, options: { noFf: mode.noFf, squash: mode.squash } } : undefined;
    }
    if (action === 'deleteRemote') {
      const parts = (message.ref ?? '').split('/');
      return parts.length > 1 ? { action, ref: parts.slice(1).join('/'), options: { remote: parts[0] } } : undefined;
    }
    if (action === 'deleteBranch') {
      const choice = await vscode.window.showWarningMessage(`Delete local branch ${message.ref}?`, { modal: true }, 'Delete', 'Force Delete');
      return choice ? { action, ref: message.ref, options: { force: choice === 'Force Delete' } } : undefined;
    }
    if (action === 'reset') {
      const mode = await vscode.window.showQuickPick(['soft', 'mixed', 'hard', 'keep'], { title: `Reset Current Branch to ${message.hash}` });
      return mode ? { action, ref: message.hash, options: { mode } } : undefined;
    }
    if (action === 'tag') {
      const name = await vscode.window.showInputBox({ title: 'New Tag', prompt: 'Tag name', validateInput: validateRefName });
      return name ? { action, ref: message.hash, options: { name } } : undefined;
    }
    return { action, ref: message.ref ?? message.hash, hash: message.hash, hashes: message.hashes, path: message.path, options: message.operation ? { operation: message.operation } : undefined };
  }

  private async openDiff(hash: string, filePath: string, parent = 1): Promise<void> {
    const detail = await this.service.commitDetail(this.root!, hash, parent);
    const leftRef = detail.parents[parent - 1];
    const left = leftRef ? revisionUri(this.root!, leftRef, filePath) : vscode.Uri.parse('untitled:empty');
    const right = revisionUri(this.root!, hash, filePath);
    await vscode.commands.executeCommand('vscode.diff', left, right, `${filePath} (${hash.slice(0, 8)})`);
  }

  private async openConflict(filePath: string): Promise<void> {
    const uri = vscode.Uri.file(path.join(this.root!, filePath));
    try { await vscode.commands.executeCommand('git.openMergeEditor', uri); }
    catch { await vscode.window.showTextDocument(uri); }
  }

  private post(message: unknown): void { this.view?.webview.postMessage(message); }
}

function validateRefName(value: string): string | undefined {
  return !value.trim() || /[~^:?*\[\\\s]|\.\.|\/\//.test(value) ? 'Enter a valid Git ref name.' : undefined;
}

function contextActions(kind?: string): Array<{ label: string; action: string }> {
  if (kind === 'local') return [
    { label: 'Checkout', action: 'checkout' }, { label: 'New Branch from Selected...', action: 'createBranch' },
    { label: 'Merge into Current', action: 'merge' }, { label: 'Rebase Current onto Selected', action: 'rebase' },
    { label: 'Push', action: 'pushBranch' }, { label: 'Delete Branch', action: 'deleteBranch' }, { label: 'Copy Branch Name', action: 'copy' }
  ];
  if (kind === 'remote') return [
    { label: 'Checkout Tracking Branch', action: 'checkoutRemote' }, { label: 'Merge into Current', action: 'merge' },
    { label: 'Rebase Current onto Selected', action: 'rebase' }, { label: 'Delete on Remote', action: 'deleteRemote' }, { label: 'Copy Branch Name', action: 'copy' }
  ];
  if (kind === 'tag') return [{ label: 'Checkout Revision', action: 'checkout' }, { label: 'New Branch from Tag...', action: 'createBranch' }, { label: 'Delete Tag', action: 'deleteTag' }, { label: 'Copy Tag Name', action: 'copy' }];
  if (kind === 'stash') return [{ label: 'Apply', action: 'stashApply' }, { label: 'Pop', action: 'stashPop' }, { label: 'Drop', action: 'stashDrop' }];
  if (kind === 'commit') return [
    { label: 'Checkout Revision', action: 'checkout' }, { label: 'New Branch here...', action: 'createBranch' }, { label: 'New Tag here...', action: 'tag' },
    { label: 'Cherry-Pick', action: 'cherryPick' }, { label: 'Revert Commit', action: 'revert' }, { label: 'Reset Current Branch to Here...', action: 'reset' }, { label: 'Copy Revision Number', action: 'copy' }
  ];
  if (kind === 'commits') return [{ label: 'Compare Versions', action: 'compare' }, { label: 'Cherry-Pick in Selected Order', action: 'cherryPick' }, { label: 'Revert in Selected Order', action: 'revert' }];
  if (kind === 'commitFile') return [
    { label: 'Show Diff', action: 'diff' }, { label: 'Open Version at Revision', action: 'openRevision' },
    { label: 'Get File from Revision', action: 'getFile' }, { label: 'Open in Editor', action: 'openFile' }, { label: 'Copy Path', action: 'copy' }
  ];
  if (kind === 'workingFile') return [{ label: 'Rollback', action: 'rollbackFile' }];
  return [];
}

function renderHtml(webview: vscode.Webview): string {
  const nonce = Math.random().toString(36).slice(2);
  return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'">
<style>
*{box-sizing:border-box}body{margin:0;color:var(--vscode-foreground);background:var(--vscode-panel-background);font:var(--vscode-font-size) var(--vscode-font-family);overflow:hidden}button,input,select{font:inherit;color:inherit;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);height:26px}button{cursor:pointer}.toolbar{height:34px;display:flex;gap:4px;align-items:center;padding:4px;border-bottom:1px solid var(--vscode-panel-border)}.toolbar .grow{flex:1}.layout{height:calc(100vh - 34px);display:grid;grid-template-columns:var(--left,220px) 4px minmax(320px,1fr) 4px var(--right,330px)}.split{background:var(--vscode-panel-border);cursor:col-resize}.pane{min-width:0;overflow:hidden}.branches,.right{display:flex;flex-direction:column}.heading{height:30px;padding:7px 9px;font-weight:600;border-bottom:1px solid var(--vscode-panel-border)}#branchSearch{margin:5px;width:calc(100% - 10px)}#branches,#files{overflow:auto;flex:1;padding:3px 0}.group{padding:7px 8px 3px;color:var(--vscode-descriptionForeground);font-size:11px;text-transform:uppercase}.item{height:24px;padding:4px 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:default}.item:hover,.row:hover{background:var(--vscode-list-hoverBackground)}.item.active{font-weight:600;color:var(--vscode-gitDecoration-addedResourceForeground)}.badge{float:right;color:var(--vscode-descriptionForeground)}.center{display:flex;flex-direction:column}.filters{height:34px;padding:4px;display:flex;gap:4px;border-bottom:1px solid var(--vscode-panel-border)}#textFilter{min-width:90px;flex:1}.header,.row{display:grid;grid-template-columns:58px minmax(180px,1fr) 130px 130px;align-items:center}.header{height:25px;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-panel-border)}.header>*{padding:0 7px}.viewport{position:relative;overflow:auto;flex:1}.spacer{position:relative}.row{position:absolute;left:0;right:0;height:28px;border-bottom:1px solid color-mix(in srgb,var(--vscode-panel-border) 45%,transparent)}.row>*{padding:0 7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.row.selected{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}.graph{font-family:monospace;color:var(--vscode-gitDecoration-modifiedResourceForeground)}.refs{color:var(--vscode-badge-foreground);background:var(--vscode-badge-background);padding:1px 4px;margin-left:6px}.right{border-left:0}.detail{height:44%;min-height:120px;border-top:1px solid var(--vscode-panel-border);overflow:auto;padding:9px}.file{display:grid;grid-template-columns:18px 1fr auto;gap:5px;padding:5px 8px;cursor:default}.file .stat{color:var(--vscode-descriptionForeground)}.message{font-weight:600;white-space:pre-wrap}.meta{margin-top:7px;color:var(--vscode-descriptionForeground);word-break:break-all}.empty{padding:14px;color:var(--vscode-descriptionForeground)}.banner{display:none;padding:6px 9px;background:var(--vscode-inputValidation-warningBackground);border-bottom:1px solid var(--vscode-inputValidation-warningBorder)}
</style></head><body>
<div class="toolbar"><button id="refresh" title="Refresh">↻</button><button data-action="fetch">Fetch</button><button data-action="update">Update Project</button><button data-action="pull">Pull</button><button data-action="push">Push</button><button data-action="stash">Stash</button><button data-action="createBranch">New Branch</button><button id="viewOptions">View</button><span id="status"></span><span class="grow"></span><select id="repo"></select></div>
<main class="layout" id="layout"><section class="pane branches"><div class="heading">BRANCHES</div><input id="branchSearch" placeholder="Search branches"><div id="branches"></div></section><div class="split" data-side="left"></div>
<section class="pane center"><div class="banner" id="banner"><b id="operation"></b><button data-conflict="continue">Continue</button><button data-conflict="abort">Abort</button><button data-conflict="skip">Skip</button></div><div class="filters"><input id="textFilter" placeholder="Message"><input id="authorFilter" placeholder="Author"><input id="pathFilter" placeholder="Path"><input id="sinceFilter" type="date" title="From date"><input id="untilFilter" type="date" title="To date"><input id="goto" placeholder="Hash / ref"><label><input type="checkbox" id="regex"> Regex</label><label><input type="checkbox" id="case"> Case</label><button id="clear">Clear</button></div><div class="header"><span>Graph</span><span>Subject</span><span>Author</span><span>Date</span></div><div class="row" id="uncommitted" style="display:none;position:relative"><span>●</span><strong>Uncommitted changes</strong><span></span><span></span></div><div class="viewport" id="viewport" tabindex="0"><div class="spacer" id="spacer"></div></div></section>
<div class="split" data-side="right"></div><section class="pane right"><div class="heading">CHANGED FILES</div><div id="files"></div><div class="detail" id="detail"><div class="empty">Select a commit</div></div></section></main>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi(), ROW=28, PAGE=200, overscan=12;let state={commits:[],total:0,loading:new Set(),selected:-1,selectedHashes:new Set(),detail:null,uncommitted:[]};
const $=id=>document.getElementById(id), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function send(type,data={}){vscode.postMessage({type,...data})}function date(ts){return new Date(ts*1000).toLocaleString()}
function renderBranches(){const q=$('branchSearch').value.toLowerCase(),r=state.repository;if(!r)return;$('branches').innerHTML=['local','remote','tag'].map(kind=>{const rows=r.refs.filter(x=>x.kind===kind&&x.name.toLowerCase().includes(q));if(!rows.length)return'';return '<div class="group">'+kind+'</div>'+rows.map(x=>'<div class="item '+(x.current?'active':'')+'" data-kind="'+kind+'" data-hash="'+x.hash+'" data-ref="'+esc(x.name)+'">'+esc(x.name)+'<span class="badge">'+(x.ahead?'↑'+x.ahead+' ':'')+(x.behind?'↓'+x.behind:'')+'</span></div>').join('')}).join('')+'<div class="group">Stashes</div>'+r.stashes.map(x=>'<div class="item" data-kind="stash" data-ref="'+esc(x.ref)+'" data-hash="'+x.hash+'">'+esc(x.ref+' '+x.message)+'</div>').join('')}
function renderRows(){const vp=$('viewport'),start=Math.max(0,Math.floor(vp.scrollTop/ROW)-overscan),end=Math.min(state.total,Math.ceil((vp.scrollTop+vp.clientHeight)/ROW)+overscan);$('spacer').style.height=(state.total*ROW)+'px';$('spacer').innerHTML=Array.from({length:Math.max(0,end-start)},(_,i)=>{const n=start+i,c=state.commits[n];if(!c)return '<div class="row" style="top:'+(n*ROW)+'px"><span></span><span>Loading…</span></div>';const refs=c.refs.length?'<span class="refs">'+esc(c.refs[0].replace('refs/heads/','').replace('refs/remotes/','').replace('tag: refs/tags/',''))+'</span>':'';return '<div class="row '+(n===state.selected?'selected ':'')+(state.selectedHashes.has(c.hash)?'multi':'')+'" data-index="'+n+'" style="top:'+(n*ROW)+'px"><span class="graph">● '+(c.parents.length>1?'╲':'│')+'</span><span>'+esc(c.subject)+refs+'</span><span>'+esc(c.author)+'</span><span>'+date(c.authorTimestamp)+'</span></div>'}).join('');for(let page=Math.floor(start/PAGE)*PAGE;page<end;page+=PAGE)if(!state.commits[page]&&!state.loading.has(page)){state.loading.add(page);send('loadLog',{offset:page,filter:filter()})}}
function renderDetail(){const d=state.detail;if(!d)return;$('detail').innerHTML='<div class="message">'+esc(d.message)+'</div><div class="meta">'+esc(d.hash)+'<br>'+esc(d.author+' <'+d.authorEmail+'> · '+date(d.authorTimestamp))+'<br>Parents: '+d.parents.map(esc).join(', ')+'</div>';$('files').innerHTML=d.files.map(f=>'<div class="file" data-path="'+esc(f.path)+'"><b>'+esc(f.status)+'</b><span>'+esc(f.path)+'</span><span class="stat">+'+f.additions+' -'+f.deletions+'</span></div>').join('')}
function filter(){return{text:$('textFilter').value||undefined,author:$('authorFilter').value||undefined,path:$('pathFilter').value||undefined,since:$('sinceFilter').value||undefined,until:$('untilFilter').value||undefined,refs:state.selectedRef?[state.selectedRef]:undefined,regex:$('regex').checked,matchCase:$('case').checked}}
function loadFiltered(){state.commits=[];state.total=0;state.loading.clear();state.loading.add(0);send('loadLog',{offset:0,filter:filter()})}let timer;for(const id of ['textFilter','authorFilter','pathFilter','sinceFilter','untilFilter'])$(id).oninput=()=>{clearTimeout(timer);timer=setTimeout(loadFiltered,250)};$('regex').onchange=$('case').onchange=loadFiltered;$('clear').onclick=()=>{for(const id of ['textFilter','authorFilter','pathFilter','sinceFilter','untilFilter'])$(id).value='';state.selectedRef=undefined;$('regex').checked=$('case').checked=false;loadFiltered()};
$('viewport').onscroll=renderRows;$('viewport').onclick=e=>{const row=e.target.closest('.row');if(!row)return;state.selected=Number(row.dataset.index);const hash=state.commits[state.selected].hash;if(e.ctrlKey||e.metaKey){state.selectedHashes.has(hash)?state.selectedHashes.delete(hash):state.selectedHashes.add(hash)}else{state.selectedHashes.clear();state.selectedHashes.add(hash)}send('detail',{hash});renderRows()};$('viewport').oncontextmenu=e=>{e.preventDefault();const row=e.target.closest('.row');if(row){const c=state.commits[Number(row.dataset.index)],hashes=[...state.selectedHashes];send('context',{kind:hashes.length>1?'commits':'commit',hash:c.hash,ref:c.hash,hashes})}};$('viewport').onkeydown=e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();state.selected=Math.max(0,Math.min(state.commits.length-1,state.selected+(e.key==='ArrowDown'?1:-1)));send('detail',{hash:state.commits[state.selected].hash});$('viewport').scrollTop=Math.max(0,state.selected*ROW-$('viewport').clientHeight/2);renderRows()}if(e.key==='Enter'&&state.detail?.files[0])send('diff',{hash:state.detail.hash,path:state.detail.files[0].path})};
$('files').ondblclick=e=>{const f=e.target.closest('.file');if(f&&state.detail)send('diff',{hash:state.detail.hash,path:f.dataset.path})};$('files').oncontextmenu=e=>{e.preventDefault();const f=e.target.closest('.file');if(f&&state.detail)send('context',{kind:'commitFile',hash:state.detail.hash,path:f.dataset.path})};$('branchSearch').oninput=renderBranches;$('branches').onclick=e=>{const item=e.target.closest('.item');if(!item)return;if(item.dataset.ref){state.selectedRef=item.dataset.ref;loadFiltered()}else if(item.dataset.hash)send('detail',{hash:item.dataset.hash})};$('branches').ondblclick=e=>{const item=e.target.closest('.item');if(item&&['local','remote'].includes(item.dataset.kind))send('mutate',{action:item.dataset.kind==='remote'?'checkoutRemote':'checkout',ref:item.dataset.ref})};$('branches').oncontextmenu=e=>{e.preventDefault();const item=e.target.closest('.item');if(item)send('context',{kind:item.dataset.kind,ref:item.dataset.ref,hash:item.dataset.hash})};$('goto').onkeydown=e=>{if(e.key==='Enter'&&e.target.value)send('detail',{hash:e.target.value})};$('refresh').onclick=()=>send('refresh');for(const b of document.querySelectorAll('[data-action]'))b.onclick=()=>send('mutate',{action:b.dataset.action});for(const b of document.querySelectorAll('[data-conflict]'))b.onclick=()=>send('mutate',{action:b.dataset.conflict,operation:state.repository?.operation});$('repo').onchange=()=>send('selectRepo',{root:$('repo').value});
$('files').addEventListener('click',e=>{const f=e.target.closest('.file[data-conflict]');if(f)send('openConflict',{path:f.dataset.path})});
$('uncommitted').onclick=()=>{$('files').innerHTML=state.uncommitted.map(f=>'<div class="file" data-working="true" data-path="'+esc(f.path)+'"><b>'+esc(f.status)+'</b><span>'+esc(f.path)+'</span></div>').join('');$('detail').innerHTML='<div class="message">Uncommitted changes</div>'};
$('viewOptions').onclick=()=>{const compact=document.body.classList.toggle('compact');localStorage.setItem('gitLog.compact',String(compact));document.querySelectorAll('.header span:nth-child(3),.row span:nth-child(3)').forEach(x=>x.style.display=compact?'none':'')};
for(const split of document.querySelectorAll('.split'))split.onmousedown=e=>{const side=split.dataset.side,start=e.clientX,layout=$('layout'),initial=side==='left'?layout.children[0].offsetWidth:layout.children[4].offsetWidth;document.onmousemove=m=>{const value=Math.max(140,initial+(side==='left'?m.clientX-start:start-m.clientX));layout.style.setProperty('--'+side,value+'px');localStorage.setItem('gitLog.'+side,value)};document.onmouseup=()=>document.onmousemove=document.onmouseup=null};for(const side of ['left','right']){const v=localStorage.getItem('gitLog.'+side);if(v)$('layout').style.setProperty('--'+side,v+'px')}
window.onmessage=e=>{const m=e.data;if(m.type==='state'){state={...state,...m,commits:m.log?.commits??[],total:m.log?.total??0};state.commits.length=state.total;$('repo').innerHTML=m.repositories.map(r=>'<option '+(r===m.repository?.root?'selected':'')+'>'+esc(r)+'</option>').join('');const r=m.repository;$('status').textContent=r?r.head+'  ↑'+r.ahead+' ↓'+r.behind+'  '+r.changedCount+' changed':'';$('uncommitted').style.display=state.uncommitted.length?'grid':'none';$('banner').style.display=r?.operation?'block':'none';$('operation').textContent=r?.operation??'';renderBranches();renderRows();if(r?.operation){$('files').innerHTML=state.uncommitted.filter(f=>f.conflict).map(f=>'<div class="file" data-conflict="true" data-path="'+esc(f.path)+'"><b>!</b><span>'+esc(f.path)+'</span></div>').join('')}}else if(m.type==='log'){state.total=m.log.total;if(state.commits.length!==state.total)state.commits.length=state.total;state.commits.splice(m.log.offset,m.log.commits.length,...m.log.commits);state.loading.delete(m.log.offset);renderRows()}else if(m.type==='detail'){state.detail=m.detail;renderDetail()}else if(m.type==='compareFiles'){$('files').innerHTML=m.files.map(f=>'<div class="file"><b>'+esc(f.status)+'</b><span>'+esc(f.path)+'</span></div>').join('')}};send('ready');
</script></body></html>`;
}
