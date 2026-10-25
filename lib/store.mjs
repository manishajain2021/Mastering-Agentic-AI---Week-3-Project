import fs from 'node:fs/promises';
import path from 'node:path';
export class Store {
 constructor(dir){this.dir=dir;this.queue=Promise.resolve();this.sequence=0;this.references=new Map();}
 async init(){
  await fs.mkdir(this.dir,{recursive:true});
  try{const state=JSON.parse(await fs.readFile(path.join(this.dir,'_case-sequence.json'),'utf8'));if(!Number.isSafeInteger(state.last)||state.last<0)throw Error('Invalid case sequence counter');this.sequence=state.last;}catch(e){if(e.code!=='ENOENT')throw e;}
  const names=(await fs.readdir(this.dir)).filter(name=>/^CASE-[a-f0-9-]{36}\.json$/.test(name));
  const cases=await Promise.all(names.map(name=>fs.readFile(path.join(this.dir,name),'utf8').then(JSON.parse)));
  for(const c of cases){if(c.case_sequence!==undefined){if(!Number.isSafeInteger(c.case_sequence)||c.case_sequence<1||this.references.has(c.case_sequence))throw Error('Invalid or duplicate case sequence');this.references.set(c.case_sequence,c.id);this.sequence=Math.max(this.sequence,c.case_sequence);}}
  for(const c of cases.sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id))){if(!c.case_sequence){await this.assignReference(c);await this.save(c);}else if(c.case_label!==this.label(c.case_sequence,c.created_at))throw Error('Case reference does not match its stored sequence');}
  await this.saveSequence();
 }
 label(sequence,createdAt){const date=new Date(createdAt);if(!Number.isFinite(date.getTime()))throw Error('Invalid case creation date');const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);const part=type=>parts.find(p=>p.type===type).value;return `AML Case ${String(sequence).padStart(4,'0')} · ${part('year')}-${part('month')}-${part('day')}`;}
 async saveSequence(){const p=path.join(this.dir,'_case-sequence.json');await fs.writeFile(p+'.tmp',JSON.stringify({last:this.sequence}),{mode:0o600});await fs.rename(p+'.tmp',p);}
 async assignReference(c){if(this.sequence>=Number.MAX_SAFE_INTEGER)throw Error('Case sequence exhausted');this.sequence++;await this.saveSequence();c.case_sequence=this.sequence;c.case_label=this.label(this.sequence,c.created_at);this.references.set(this.sequence,c.id);}
 create(c){const work=this.queue.then(async()=>{await this.assignReference(c);return this.save(c);});this.queue=work.catch(()=>{});return work;}
 async lookup(reference){if(/^CASE-[a-f0-9-]{36}$/.test(reference))return this.get(reference);const match=reference.match(/^AML Case (\d{4,})(?:\s*·\s*(\d{4}-\d{2}-\d{2}))?$/i);const id=match&&this.references.get(Number(match[1]));if(!id)throw Object.assign(Error('Case not found'),{code:'ENOENT'});const c=await this.get(id);if(match[2]&&!c.case_label.endsWith(match[2]))throw Object.assign(Error('Case not found'),{code:'ENOENT'});return c;}
 file(id){if(!/^CASE-[a-f0-9-]{36}$/.test(id))throw Error('Invalid case ID');return path.join(this.dir,id+'.json');}
 async get(id){return JSON.parse(await fs.readFile(this.file(id),'utf8'));}
 async save(c){const p=this.file(c.id);await fs.writeFile(p+'.tmp',JSON.stringify(c,null,2),{mode:0o600});await fs.rename(p+'.tmp',p);return c;}
 async update(id,fn){const work=this.queue.then(async()=>{const c=await this.get(id);const result=await fn(c);await this.save(c);return result??c;});this.queue=work.catch(()=>{});return work;}
}
