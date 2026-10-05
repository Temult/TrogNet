import {AppError} from './types.js';

/** Qualified by two sanitized grants; units remain undocumented by the provider.
 * The 15-minute bound is a conservative local acceptance rule, not provider policy.
 */
export function normalizeRefreshSchedule(response:Record<string,unknown>,expiresAtMs:number):number|undefined {
 if(!Object.prototype.hasOwnProperty.call(response,'earliest_refresh_at'))return undefined;
 const raw=response.earliest_refresh_at;
 if(typeof raw!=='number'||!Number.isSafeInteger(raw)||!Number.isSafeInteger(expiresAtMs))throw new AppError('REFRESH_SCHEDULE_REJECTED',503);
 const ms=raw*1000,lead=expiresAtMs-ms;
 if(!Number.isSafeInteger(ms)||ms<=0||lead<=0||lead>15*60000)throw new AppError('REFRESH_SCHEDULE_REJECTED',503);
 return ms;
}
