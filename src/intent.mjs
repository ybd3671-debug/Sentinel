const quoted=/“[^”]*”|「[^」]*」|"[^"]*"|'[^']*'/g;
export function checkIntent(text){
 if(typeof text!=='string'||!text.trim()||text.length>1500)throw Error('请输入1500字以内的关注点');
 if(/买入|卖出|买卖|仓位|保证收益|稳赚|预测.*涨|自动交易/.test(text))throw Error('本产品仅提供条件监控，不执行交易、仓位建议或收益预测');
 const plain=text.replace(quoted,'');
 if(/连续|交易日|收盘|开盘|除非|不提醒|微信|短信|邮件|波动率|市盈率|市值|回撤|止盈|止损/.test(plain))throw Error('存在尚不支持的时间、指标或通知限制，请改写为明确的价格、事件或日期条件');
 if(/下周|本周|周[一二三四五六日天]|下月|本月|个月|季度|年底|昨天|今晚|上午|下午|盘中|\d{1,2}[:：]\d{2}/.test(plain))throw Error('暂不支持该时间范围或时刻，请写具体日期 YYYY-MM-DD，或使用今天、明天、后天');
 if(/[()（）]/.test(plain))throw Error('暂不支持括号分组，请拆成多条任务，或使用统一的“且”或“或”');
 if(/且|并|同时|和|与/.test(plain)&&/或者|或|任一/.test(plain))throw Error('同时出现“且”和“或”，组合关系需要澄清。请拆成两条任务，或统一使用一种连接关系');
}
export function parseIntent(text,assets,now=Date.now()){
 checkIntent(text);let work=text,conditions=[],warnings=[],lastMetric=null,interval=5,cooldown=60,seenInterval=false,seenCooldown=false;
 const consume=(pattern,fn)=>{work=work.replace(pattern,(...args)=>{fn(...args);return ' '.repeat(args[0].length);});};
 const eventPattern=/(?:公告|事件|新闻)(?:包含|出现|含有)\s*(?:“([^”]+)”|「([^」]+)」|"([^"]+)"|'([^']+)'|(.+?)(?=且|并且|或者|或|，|,|。|；|;|时提醒|提醒|$))/g;
 consume(eventPattern,(_m,a,b,c,d,e)=>{const value=(a||b||c||d||e).trim();if(!value)throw Error('请提供明确的事件关键词');conditions.push({field:'event',op:'contains',value});});
 if(/[“”「」"']/.test(work))throw Error('引号未成对，或引号内的内容无法识别，请检查事件关键词');
 const names=Object.keys(assets).filter(n=>work.includes(n));if(names.length!==1)throw Error('请明确一个标的：'+Object.keys(assets).join('、'));
 const name=names[0];work=work.split(name).join(' '.repeat(name.length));
 const minutes=(n,u)=>Number(n)*(u==='小时'?60:1);
 const setCooldown=(n,u)=>{const value=minutes(n,u);if(seenCooldown&&cooldown!==value)throw Error('出现多个不同冷却时间，请明确一个');seenCooldown=true;cooldown=value;};
 consume(/(?:触发后|冷却)\s*(\d+)\s*(分钟|小时)(?:内(?:不要|不再|不)?重复提醒)?/g,(_m,n,u)=>setCooldown(n,u));
 consume(/(\d+)\s*(分钟|小时)内(?:不要|不再|不)?重复提醒/g,(_m,n,u)=>setCooldown(n,u));
 consume(/每\s*(\d+)\s*(分钟|小时)(?:检查一次|检查|监控一次|监控)?/g,(_m,n,u)=>{const value=minutes(n,u);if(seenInterval&&interval!==value)throw Error('出现多个不同检查间隔，请明确一个');seenInterval=true;interval=value;});
 consume(/\d{4}-\d{2}-\d{2}/g,value=>conditions.push({field:'date',op:'eq',value}));
 consume(/今天|明天|后天/g,value=>{const days={今天:0,明天:1,后天:2}[value],date=new Date(now+8*3600000+days*86400000).toISOString().slice(0,10);conditions.push({field:'date',op:'eq',value:date});warnings.push('“'+value+'”已固定为上海日期 '+date+'，不会随运行日期自动顺延。');});
 const map={涨跌幅:'changePct',跌幅:'changePct',下跌:'changePct',涨幅:'changePct',上涨:'changePct',股价:'price',价格:'price',最新价:'price',量比:'volumeRatio',热度:'heat'};
 const opMap={不低于:'gte',至少:'gte',达到:'gte',不高于:'lte',不超过:'lte',至多:'lte',低于:'lt',小于:'lt',少于:'lt',跌破:'lt',高于:'gt',大于:'gt',超过:'gt',突破:'gt',等于:'eq',为:'eq','>=':'gte','<=':'lte','≥':'gte','≤':'lte','>':'gt','<':'lt','=':'eq'};
 const numeric=/(?:(涨跌幅|跌幅|下跌|涨幅|上涨|股价|价格|最新价|量比|热度)\s*)?(不低于|不高于|不超过|至少|至多|达到|低于|小于|少于|跌破|高于|大于|超过|突破|等于|为|>=|<=|≥|≤|>|<|=)?\s*(-?\d+(?:\.\d+)?)\s*([%％]|元|点|倍|分)?/g;
 consume(numeric,(_m,metric,word,raw,unit)=>{
  if(!metric&&(!word||!lastMetric))throw Error('数值缺少对应指标，请写明涨跌幅、价格、量比或热度');
  metric=metric||lastMetric;lastMetric=metric;const field=map[metric];let value=Number(raw),op=opMap[word]||'eq';
  if(field==='changePct'&&unit&&!/[%％]/.test(unit)||field==='price'&&unit&&!/元|点/.test(unit)||field==='volumeRatio'&&unit!=='倍'&&unit||field==='heat'&&unit!=='分'&&unit)throw Error('指标与单位不一致，请检查百分比、元/点、倍或分');
  if(metric==='跌幅'||metric==='下跌'){if(value<0)throw Error('跌幅请使用正数；若使用负数，请写“涨跌幅低于-2%”');value=-value;op={gt:'lt',gte:'lte',lt:'gt',lte:'gte',eq:'eq'}[op];}
  conditions.push({field,op,value});
 });
 const residue=work.replace(/提醒我|通知我|帮我|请帮|的时候|当日|当天|并且|而且|或者|以及|任一|全部|同时|满足|条件|关注|监控|检查|提醒|通知|如果|仅在|只在|在|于|当|时|就|且|并|和|与|或|请|我/g,'').replace(/[\s，,。.;；、：:!！?？]/g,'');
 if(residue)throw Error('尚未理解“'+residue.slice(0,45)+'”，未生成规则。请补充或改写，避免遗漏限制');
 if(!conditions.length)throw Error('未识别出明确条件。示例：沪深300当日跌幅超过2%，冷却60分钟');
 return {rule:{symbol:assets[name],name,logic:/或者|或|任一/.test(text.replace(quoted,''))?'any':'all',conditions,cooldownMinutes:cooldown,intervalMinutes:interval},warnings};
}
