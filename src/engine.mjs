import {parseIntent,checkIntent} from './intent.mjs';
export const ASSETS = {'沪深300':'000300.SH','上证指数':'000001.SH','创业板指':'399006.SZ','贵州茅台':'600519.SH','宁德时代':'300750.SZ'};
export const FIELDS = {changePct:'当日涨跌幅',price:'最新价',volumeRatio:'量比',date:'日期',event:'事件',heat:'热度'};
export const OPS = {lt:'低于',lte:'不高于',gt:'高于',gte:'不低于',eq:'等于',contains:'包含'};
export function validateRule(r) {
  if (!r || !Object.values(ASSETS).includes(r.symbol)) throw Error('请选择支持的标的');
  if (!['all','any'].includes(r.logic)) throw Error('组合关系必须为全部或任一');
  if (!Array.isArray(r.conditions)||r.conditions.length<1||r.conditions.length>5) throw Error('条件数必须为1至5');
  for (const c of r.conditions) {
    if (!c||!Object.hasOwn(FIELDS,c.field)||!Object.hasOwn(OPS,c.op)) throw Error('不支持的规则字段或运算符');
    if (['event','date'].includes(c.field)) {
      if(typeof c.value!=='string'||!c.value.trim()||c.value.length>100) throw Error('日期或事件值无效');
      if(c.field==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(c.value)||Number.isNaN(Date.parse(c.value+'T00:00:00Z'))||new Date(c.value+'T00:00:00Z').toISOString().slice(0,10)!==c.value)) throw Error('请使用有效日期 YYYY-MM-DD');
      if(c.field==='event'&&c.op!=='contains') throw Error('事件只支持包含关键词');
      if(c.field==='date'&&c.op==='contains') throw Error('日期不支持包含');
    } else {
      if(typeof c.value!=='number'||!Number.isFinite(c.value)) throw Error('阈值必须是有效数字');
      if(['contains'].includes(c.op)) throw Error('数字字段不支持包含');
      if(c.field==='changePct'&&Math.abs(c.value)>100) throw Error('涨跌幅阈值应在-100至100之间');
      if(c.field!=='changePct'&&c.value<0) throw Error('价格、量比和热度不能为负数');
    }
  }
  if(r.logic==='all'){
    for(const field of ['changePct','price','volumeRatio','heat']){
      let low=-Infinity,high=Infinity,lowClosed=true,highClosed=true;
      for(const c of r.conditions.filter(x=>x.field===field)){
        if(['gt','gte','eq'].includes(c.op)){if(c.value>low){low=c.value;lowClosed=c.op!=='gt';}else if(c.value===low)lowClosed=lowClosed&&c.op!=='gt';}
        if(['lt','lte','eq'].includes(c.op)){if(c.value<high){high=c.value;highClosed=c.op!=='lt';}else if(c.value===high)highClosed=highClosed&&c.op!=='lt';}
      }
      if(low>high||low===high&&(!lowClosed||!highClosed))throw Error('同一指标的上下界相互矛盾，无法同时满足，请检查范围');
    }
    if(new Set(r.conditions.filter(c=>c.field==='date'&&c.op==='eq').map(c=>c.value)).size>1)throw Error('同一任务不能同时等于两个不同日期，请拆分任务或改用任一满足');
  }
  if(!Number.isInteger(r.cooldownMinutes)||r.cooldownMinutes<1||r.cooldownMinutes>10080) throw Error('冷却应为1至10080分钟');
  if(!Number.isInteger(r.intervalMinutes)||r.intervalMinutes<1||r.intervalMinutes>1440) throw Error('检查间隔应为1至1440分钟');
  return r;
}
export const validateIntent=checkIntent;
export function parseLocal(text,now=Date.now()) {
 const parsed=parseIntent(text,ASSETS,now);validateRule(parsed.rule);
 return {rule:parsed.rule,parser:'本地规则解析器',warnings:[...parsed.warnings,'请核对阈值和组合关系；规则确认后才开始监控。','当前未调用大模型；不能完整理解的要求会拒绝生成草稿。']};
}
export function evaluate(rule, snapshot, now=Date.now()) {
  validateRule(rule);
  if(rule.conditions.every(c=>c.field==='date'))snapshot={symbol:rule.symbol,source:'Asia/Shanghai 系统日历',asOf:new Date(now).toISOString()};
  if(!snapshot||snapshot.symbol!==rule.symbol) return {kind:'degraded',reason:'标的不匹配或数据缺失',evidence:[]};
  if(typeof snapshot.source!=='string'||!snapshot.source.trim())return {kind:'degraded',reason:'数据来源缺失，无法追溯，暂停条件判断',evidence:[]};
  const age=now-Date.parse(snapshot.asOf);
  if(!Number.isFinite(age)||age>180000||age < -60000) return {kind:'degraded',reason:age>180000?'报价时点已超过3分钟（可能休市或来源延迟），暂停价格判断；不会用取回时间替代报价时间':'报价时间缺失或来自未来，暂停条件判断',evidence:[]};
  if(snapshot.conflict) return {kind:'degraded',reason:'来源数据冲突，等待核验，不生成正常结论',evidence:[]};
  const evidence=rule.conditions.map(c=>{
    const value=c.field==='date'?new Date(now+8*3600000).toISOString().slice(0,10):snapshot[c.field];
    const missing=value===undefined||value===null||(typeof c.value==='number'&&(typeof value!=='number'||!Number.isFinite(value)))||(typeof c.value==='string'&&typeof value!=='string');
    const match=missing?null:({lt:()=>value<c.value,lte:()=>value<=c.value,gt:()=>value>c.value,gte:()=>value>=c.value,eq:()=>value===c.value,contains:()=>value.includes(c.value)}[c.op])();
    return {...c,actual:missing?null:value,match,unit:c.field==='changePct'?'%':c.field==='price'?(['000300.SH','000001.SH','399006.SZ'].includes(rule.symbol)?'指数点':'元'):c.field==='volumeRatio'?'倍':c.field==='heat'?'供应商口径分值':'',source:c.field==='date'?'Asia/Shanghai 系统日历':snapshot.source,asOf:c.field==='date'?new Date(now).toISOString():snapshot.asOf};
  });
  if(evidence.some(x=>x.match===null))return {kind:'degraded',reason:'必要字段缺失，无法可靠判断',evidence};
  const match=rule.logic==='all'?evidence.every(x=>x.match):evidence.some(x=>x.match);
  return {kind:match?'matched':'clear',reason:match?'已满足配置条件':'条件未满足',evidence};
}
export function transition(task,result,now) {
  if(result.kind==='degraded')return {...result,status:'degraded',alert:false};
  const recovered=task.status==='degraded';
  if(result.kind==='clear') return {...result,status:'running',alert:false,recovered,latched:false};
  if(task.lastAlertAt && now-task.lastAlertAt<task.rule.cooldownMinutes*60000)return {...result,status:'cooldown',alert:false,recovered,reason:'条件满足，但仍在冷却期内；本次不重复提醒'};
  if(task.latched)return {...result,status:'running',alert:false,recovered,reason:'同一轮条件持续满足，已去重；条件解除后重新布防'};
  return {...result,status:'running',alert:true,recovered,latched:true,reason:'条件首次满足，或解除后再次满足；已生成提醒'};
}
export function demoSnapshot(symbol,scenario='normal',now=Date.now()) {
  const changes={normal:-0.82,trigger:-3.12,recovery:0.46,stale:-3.12,conflict:-3.12,missing:-3.12};
  const prevClose=({'000300.SH':4000,'000001.SH':3300,'399006.SZ':2200,'600519.SH':1450,'300750.SZ':250})[symbol]||4000;
  const changePct=changes[scenario]??changes.normal;
  return {symbol,prevClose,price:Number((prevClose*(1+changePct/100)).toFixed(2)),changePct,volumeRatio:scenario==='trigger'?2.4:1.12,heat:scenario==='trigger'?88:43,event:scenario==='trigger'?'演示公告：业绩预告':'演示公告：无新增匹配事件',asOf:new Date(now-(scenario==='stale'?600000:0)).toISOString(),source:'构造数据 · 场景回放（非实时行情）',conflict:scenario==='conflict',...(scenario==='missing'?{changePct:null}:{})};
}

