async function boundedJSON(response,limit) {
  const reader=response.body?.getReader();if(!reader)throw Error('STOP_BODY');
  const chunks=[];let total=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>limit)throw Error('STOP_BODY');chunks.push(value);}
    const bytes=new Uint8Array(total);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
}

const KEY='trognet-e06-qualification-v1';
const prompt={instructions:'Reply with exactly OK and nothing else.',input:[{role:'user',content:'Reply OK.'}],store:false,stream:true};
const sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
/** Browser-only helper. Importing makes no requests. Invoke only after owner authorization. */
export async function visibleModels({fetcher=fetch}={}) {
  const r=await fetcher('/e06/models',{credentials:'same-origin',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(120000)});
  if(r.status!==200)throw Error('STOP_MODELS');const b=await boundedJSON(r,262144);
  if(!Array.isArray(b.models)||b.models.length>256)throw Error('STOP_MODELS');return b.models;
}
export async function qualifyOnce({model,models,authorize,attestation,storage=localStorage,locks=navigator.locks,fetcher=fetch,now=Date.now}={}) {
  if(!locks||authorize!=='I_AUTHORIZE_EXACTLY_ONE_INFERENCE'||!models?.some(m=>m.slug===model)||!/^[-A-Za-z0-9._]{1,128}$/.test(model??'')||
    !attestation||attestation.source_verified!==true||attestation.only_plan_gateway!==true||attestation.no_api_key_or_credits_fallback!==true||
    attestation.gate_5i!=='PASS'||!/^([a-f0-9]{64})$/.test(attestation.manifest_sha256??''))throw Error('STOP_PREREQUISITES');
  return locks.request(KEY,{mode:'exclusive'},async()=>{
    if(storage.getItem(KEY)!==null)throw Error('STOP_EXISTING_ATTEMPT_RECONCILE');
    const request_id=crypto.randomUUID(),started=now();
    let receipt={schema:'trognet-e06-qualification/v1',status:'STOP_UNCERTAIN',request_id,model,manifest_sha256:attestation.manifest_sha256,
      inference:'unknown',provider_inference_requests_permitted:1,automatic_retries:0,gateway_completion:false,route_stages:['browser_attempt_reserved'],started_ms:started};
    // Browser persistence failure happens before dispatch. Never clear this marker to retry.
    storage.setItem(KEY,JSON.stringify(receipt));
    if(storage.getItem(KEY)!==JSON.stringify(receipt))throw Error('STOP_LOCAL_PERSISTENCE');
    try {
      const r=await fetcher('/e06/responses',{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(120000),
        headers:{'Content-Type':'application/json','X-TrogNet-CSRF':'1'},body:JSON.stringify({request_id,payload:{model,...prompt}})});
      receipt.http_status=r.status;
      const b=await boundedJSON(r,262144);
      if(b.schema==='trognet-e06-attempt/v1'&&b.request_id===request_id&&b.model===model&&/^[a-f0-9]{64}$/.test(b.gateway_request_sha256??'')) {
        receipt.gateway_request_sha256=b.gateway_request_sha256;
        if(r.status===200&&b.status==='completed'&&b.gateway_completion===true&&b.inference==='confirmed') {
          receipt.inference='confirmed';receipt.gateway_completion=true;
          receipt.route_stages=['browser','authenticated_worker','durable_attempt','configured_vpc_service','gateway_completion'];
          receipt.answer_sha256=await sha(b.text);receipt.status=b.text.trim()==='OK'?'PASS_PENDING_OWNER_PATH_CORRELATION':'STOP_ANSWER_MISMATCH';
        } else if(b.status==='not_dispatched'&&b.inference==='no'){receipt.inference='no';receipt.status='STOP_NOT_DISPATCHED';}
      }
    } catch { /* No exception text, raw response or retry. */ }
    receipt.elapsed_ms=Math.max(0,now()-started);
    storage.setItem(KEY,JSON.stringify(receipt));
    return receipt;
  });
}
export async function reconcileQualification({storage=localStorage,fetcher=fetch}={}) {
  const old=JSON.parse(storage.getItem(KEY)??'null');
  if(!old||!/^[A-Za-z0-9_-]{16,96}$/.test(old.request_id))throw Error('STOP_NO_LOCAL_ID');
  const r=await fetcher('/e06/requests/'+old.request_id,{credentials:'same-origin',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(![200,409].includes(r.status))return {request_id:old.request_id,status:'STOP_UNCERTAIN'};
  const b=await boundedJSON(r,262144);
  if(b.schema!=='trognet-e06-attempt/v1'||b.request_id!==old.request_id||b.model!==old.model||!/^([a-f0-9]{64})$/.test(b.gateway_request_sha256??''))return {request_id:old.request_id,status:'STOP_UNCERTAIN'};
  return {request_id:old.request_id,status:b.status==='completed'?'COMPLETION_RECORDED_REVIEW_RECEIPT':'STOP_UNCERTAIN',inference:b.inference==='confirmed'?'confirmed':'unknown',gateway_completion:b.gateway_completion===true};
}

export function qualificationPage(nonce) {
  const code=`const KEY=${JSON.stringify(KEY)},prompt=${JSON.stringify(prompt)};const sha=${sha.toString()};
    ${boundedJSON.toString()} ${visibleModels.toString()} ${qualifyOnce.toString()} ${reconcileQualification.toString()}
    const select=document.querySelector('select'),out=document.querySelector('pre');let models=[];
    document.querySelector('#models').onclick=async()=>{try{models=await visibleModels();select.replaceChildren(new Option('Select the visible GPT-6 Astra model',''));for(const m of models)select.add(new Option(m.display_name,m.slug));out.textContent='Catalog loaded. Select the visible Astra model.';}catch{out.textContent='STOP: catalog unavailable.';}};
    document.querySelector('#run').onclick=async()=>{if(!document.querySelector('#reviewed').checked||!select.value){out.textContent='STOP: select a model and confirm prerequisites.';return;}try{const receipt=await qualifyOnce({model:select.value,models,authorize:'I_AUTHORIZE_EXACTLY_ONE_INFERENCE',attestation:{source_verified:true,only_plan_gateway:true,no_api_key_or_credits_fallback:true,gate_5i:'PASS',manifest_sha256:document.querySelector('#manifest').value}});out.textContent=JSON.stringify(receipt,null,2);}catch{out.textContent='STOP: prerequisites or existing attempt require review. Do not retry.';}};
    document.querySelector('#status').onclick=async()=>{try{out.textContent=JSON.stringify(await reconcileQualification(),null,2);}catch{out.textContent='STOP: no reconciled receipt available.';}};`;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>TrogNet E06 owner qualification</title>
    <h1>TrogNet owner qualification</h1><p>This runs one small inference. Complete the owner checklist first. Any uncertain result requires reconciliation.</p>
    <button id="models">Load visible models (no inference)</button><p><label>Model <select><option value="">Select after loading</option></select></label></p>
    <p><label>Reviewed source manifest SHA-256 <input id="manifest" size="64" maxlength="64"></label></p>
    <p><label><input id="reviewed" type="checkbox">I verified Gate 5I PASS, installed source and routes, and plan-only operation with no API-key or credits fallback.</label></p>
    <button id="run">Authorize exactly one inference</button> <button id="status">Reconcile saved attempt (no inference)</button><pre aria-live="polite"></pre>
    <script nonce="${nonce}" type="module">${code}</script></html>`;
}
