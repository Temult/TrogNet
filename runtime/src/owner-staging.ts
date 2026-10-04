import {createApp} from './app.js';
import type {Env} from './types.js';

// Owner-only staging entrypoint. This is intentionally separate from the
// production entrypoint. It permits candidate/fixture publication rows only
// so the exact reviewed publication can be exercised before audience approval.
// It never enables provider-backed inference.
const stagingApp=createApp({allowFixtures:true});

export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    if(env.INFERENCE_MODE!=='extractive'||env.INFERENCE_ENABLED!=='false'){
      return new Response('Service unavailable.',{
        status:503,
        headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}
      });
    }
    return stagingApp.fetch(request,env);
  }
};
