const QUOTES={'000300.SH':'sh000300','000001.SH':'sh000001','399006.SZ':'sz399006','600519.SH':'sh600519','300750.SZ':'sz300750'};
export const PUBLIC_FIELDS=['price','changePct','date'];
export function parsePublicQuote(text,symbol,fetchedAt=Date.now()){
 const code=QUOTES[symbol];if(!code)throw Error('公开报价不支持该标的');
 if(typeof text!=='string'||text.length>64000)throw Error('公开报价格式或长度异常');
 const match=text.trim().match(/^v_([a-z]{2}\d{6})="([^"\r\n]+)";?$/);
 if(!match||match[1]!==code)throw Error('公开报价标的不匹配或响应格式变化');
 const f=match[2].split('~');if(f.length<33||f[2]!==symbol.split('.')[0])throw Error('公开报价字段不足或证券代码不一致');
 const price=Number(f[3]),prevClose=Number(f[4]),reportedChangePct=Number(f[32]);
 if(![price,prevClose,reportedChangePct].every(Number.isFinite)||price<=0||prevClose<=0||!f[3].trim()||!f[4].trim()||!f[32].trim())throw Error('公开报价价格、前收盘或涨跌幅缺失');
 const stamp=f[30];if(!/^\d{14}$/.test(stamp))throw Error('公开报价时点缺失或格式变化');
 const asOf=new Date(stamp.slice(0,4)+'-'+stamp.slice(4,6)+'-'+stamp.slice(6,8)+'T'+stamp.slice(8,10)+':'+stamp.slice(10,12)+':'+stamp.slice(12,14)+'+08:00');
 if(Number.isNaN(asOf.getTime())||new Date(asOf.getTime()+8*3600000).toISOString().replace(/[-:T]/g,'').slice(0,14)!==stamp)throw Error('公开报价时点无效');
 const calculated=(price/prevClose-1)*100;
 return {symbol,price,prevClose,changePct:reportedChangePct,asOf:asOf.toISOString(),fetchedAt:new Date(fetchedAt).toISOString(),source:'腾讯公开报价 · https://qt.gtimg.cn/q='+code+' · 可能延迟',conflict:Math.abs(calculated-reportedChangePct)>0.02,raw:{format:'Tencent tilde quote',encoding:'GB18030',text,fields:{price:3,prevClose:4,asOf:30,changePct:32},calculatedChangePct:Number(calculated.toFixed(6))}};
}
export async function fetchPublicQuote(symbol,fetcher=fetch){
 const code=QUOTES[symbol];if(!code)throw Error('公开报价不支持该标的');
 const response=await fetcher('https://qt.gtimg.cn/q='+code,{signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('腾讯公开报价返回 HTTP '+response.status);
 const bytes=await response.arrayBuffer();if(bytes.byteLength>64000)throw Error('公开报价响应过大，停止解析');
 return parsePublicQuote(new TextDecoder('gb18030').decode(bytes),symbol);
}
