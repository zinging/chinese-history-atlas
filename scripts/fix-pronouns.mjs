const fs=require('fs');const path=require('path');
function walk(d){const out=[];for(const f of fs.readdirSync(d)){const p=path.join(d,f);const s=fs.statSync(p);if(s.isDirectory())out.push(...walk(p));else if(f.endsWith('.json'))out.push(p);}return out;}
const files=walk('data').filter(f=>!f.includes('schema')&&!f.includes('undefined'));
let count=0;
for(const f of files){
  let j;try{j=JSON.parse(fs.readFileSync(f,'utf8'));}catch(e){continue;}
  if(!j.name||!Array.isArray(j.funFacts)) continue;
  const nm=j.name;
  let changed=false;
  j.funFacts.forEach(x=>{
    if(!x.fact) return;
    const before=x.fact;
    // 句首他/她 → 皇帝名
    x.fact=x.fact.replace(/^他/g, nm).replace(/^她/g, nm);
    // 逗号/句号/分号后紧跟他/她，且后面不是引用别人动作，替换为皇帝名
    // 但要排除前面刚出现别人名字的情况（简单起见，只替换常见动词开头）
    x.fact=x.fact.replace(/(，|。|；)他/g, '$1'+nm).replace(/(，|。|；)她/g, '$1'+nm);
    if(x.fact!==before) changed=true;
  });
  if(changed){fs.writeFileSync(f, JSON.stringify(j,null,2));count++;console.log('updated',f);}
}
console.log('total',count);
