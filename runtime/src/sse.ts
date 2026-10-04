import {AppError} from './types.js';
/** Incremental UTF-8 SSE parser; never forwards provider events to the browser. */
export async function* parseSSE(stream:ReadableStream<Uint8Array>,maxEventBytes=262144,maxStreamBytes=2097152):AsyncGenerator<unknown> {
  const reader=stream.getReader(),decode=new TextDecoder('utf-8',{fatal:true});
  let buffer='',data:string[]=[],total=0,eventBytes=0;
  const parseLine=(line:string):unknown|undefined=>{
    if(line===''){
      if(!data.length)return undefined;
      const payload=data.join('\n');data=[];eventBytes=0;
      if(payload==='[DONE]')return {type:'transport.done'};
      try{return JSON.parse(payload);}catch{throw new AppError('PROVIDER_PROTOCOL',502);}
    }
    if(line.startsWith(':'))return undefined;
    const colon=line.indexOf(':');const field=colon<0?line:line.slice(0,colon);
    let value=colon<0?'':line.slice(colon+1);if(value.startsWith(' '))value=value.slice(1);
    if(field==='data'){eventBytes+=new TextEncoder().encode(value).length;if(eventBytes>maxEventBytes)throw new AppError('PROVIDER_TOO_LARGE',502);data.push(value);}
    return undefined;
  };
  try {
    for(;;){const {done,value}=await reader.read();if(done)break;
      total+=value.byteLength;if(total>maxStreamBytes)throw new AppError('PROVIDER_TOO_LARGE',502);
      buffer+=decode.decode(value,{stream:true});
      for(;;){const m=/\r\n|\r|\n/.exec(buffer);if(!m)break;
        if(m[0]==='\r'&&m.index===buffer.length-1)break;
        const line=buffer.slice(0,m.index);buffer=buffer.slice(m.index+m[0].length);const event=parseLine(line);if(event!==undefined)yield event;
      }
      if(buffer.length>maxEventBytes)throw new AppError('PROVIDER_TOO_LARGE',502);
    }
    buffer+=decode.decode();
    // A terminal CR is a complete line ending, not a partial CRLF after EOF.
    if(buffer.endsWith('\r')){const event=parseLine(buffer.slice(0,-1));buffer='';if(event!==undefined)yield event;}
    if(buffer||data.length)throw new AppError('PROVIDER_TRUNCATED',502);
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function consumeResponse(stream:ReadableStream<Uint8Array>,maxTextBytes=32768):Promise<{text:string;usage:unknown}> {
  const pieces:string[]=[];const encoder=new TextEncoder();let textBytes=0,completed=false,usage:unknown=null;
  for await(const raw of parseSSE(stream)){
    if(!raw||typeof raw!=='object')throw new AppError('PROVIDER_PROTOCOL',502);
    const e=raw as Record<string,unknown>;
    if(e.type==='response.output_text.delta'){
      if(completed||typeof e.delta!=='string')throw new AppError('PROVIDER_PROTOCOL',502);
      textBytes+=encoder.encode(e.delta).length;pieces.push(e.delta);if(textBytes>maxTextBytes)throw new AppError('PROVIDER_TOO_LARGE',502);
    } else if(e.type==='response.completed'){
      const r=e.response as {status?:string;usage?:unknown}|undefined;
      if(completed||r?.status!=='completed')throw new AppError('PROVIDER_PROTOCOL',502);
      completed=true;usage=r.usage??null;
    } else if(['error','response.failed','response.incomplete'].includes(String(e.type)))throw new AppError('PROVIDER_FAILED',502);
    else if(e.type==='response.output_item.added'){
      const t=(e.item as {type?:string}|undefined)?.type;
      if(t&&t!=='message'&&t!=='reasoning')throw new AppError('UNEXPECTED_TOOL',502);
    }
    // Reasoning, model identifiers, internal IDs and unknown events are not client output.
  }
  const text=pieces.join('');
  if(!completed||!text)throw new AppError('PROVIDER_TRUNCATED',502);
  return {text,usage};
}
