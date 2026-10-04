import {AppError,type Env} from './types.js';
import {validHostId} from './oauth-protocol.js';
export interface PlanContract {
 INFERENCE_MODE:string; INFERENCE_ENABLED:string; PLAN_CLIENT_ID:string; BROKER_HOST_ID:string; BROKER_SESSION_EPOCH:string;
 PLAN_REMOTE_ELIGIBILITY_REF:string; PLAN_VISIBILITY_DECISION_REF:string;
 PLAN_OWNER_SUBJECT:string; PLAN_OWNER_EMAIL:string; PLAN_TIER:string; PLAN_WORKSPACE_ID?:string;
 PLAN_PRO_VERIFICATION_REF:string; PLAN_CREDITS_DISABLED_REF:string; PLAN_POLICY_EXPIRES_MS:string;
 OPENAI_API_KEY?:string; API_BILLING_APPROVED?:string; CREDITS_FALLBACK?:string;
}
export const BROKER_OBJECT='librarian-owner-v1';
export function checkPlanContract(e:PlanContract,now=Date.now()):void {
 const refs=[e.PLAN_CLIENT_ID,e.PLAN_REMOTE_ELIGIBILITY_REF,e.PLAN_VISIBILITY_DECISION_REF,e.PLAN_OWNER_SUBJECT,e.PLAN_PRO_VERIFICATION_REF,e.PLAN_CREDITS_DISABLED_REF];
 const expires=Number(e.PLAN_POLICY_EXPIRES_MS);
 if(e.INFERENCE_MODE!=='plan'||e.INFERENCE_ENABLED!=='true'||e.PLAN_TIER!=='pro'||e.CREDITS_FALLBACK!=='false'||e.OPENAI_API_KEY!==undefined||(e.API_BILLING_APPROVED!==undefined&&e.API_BILLING_APPROVED!=='false')||
 !validHostId(e.BROKER_HOST_ID??'')||!/^\d+$/.test(e.BROKER_SESSION_EPOCH??'')||!Number.isSafeInteger(Number(e.BROKER_SESSION_EPOCH))||!e.PLAN_OWNER_EMAIL?.includes('@')||e.PLAN_OWNER_EMAIL!==e.PLAN_OWNER_EMAIL.toLowerCase()||refs.some(r=>typeof r!=='string'||!r.trim()||r.length>512||/REPLACE|dynamic_agent_client/.test(r))||!Number.isSafeInteger(expires)||expires<=now||expires>now+86400000)
 throw new AppError('PLAN_CONTRACT_BLOCKED',503);
}
export type PlanEnv=Env & PlanContract;
