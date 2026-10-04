/** Test preload: production fetch is unavailable; only the callback fixture may use loopback. */
const original=globalThis.fetch;
globalThis.fetch=(input,init)=>{
 const u=new URL(input instanceof Request?input.url:String(input));
 if(u.origin!=='http://127.0.0.1:19455')throw Error('TEST_EXTERNAL_NETWORK_FORBIDDEN');
 return original(input,init);
};
