import type { CloudClient } from './firebase';
import type { InstanceAction, InstanceObservation } from './live-status';
import { sharingRequest } from './components/BotSharing';

/** Do not present a successful transition until the runtime confirms it. */
export async function requestInstanceAction(client:CloudClient, botId:string, action:InstanceAction, signal:AbortSignal):Promise<InstanceObservation> {
  const observed=await sharingRequest<InstanceObservation>(client,`/api/marketplace/bots/${encodeURIComponent(botId)}/deployment`,'POST',{action},{signal});
  if(observed.deployed!==true||typeof observed.running!=='boolean'||observed.running!==(action==='start')) throw Error('The requested state was not confirmed. Check instance health.');
  return observed;
}
