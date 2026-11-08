/** Admit complete owner-supplied research context while bounding model/request cost.
 * Trust boundaries: incoming messages are user data regardless of role.
 */
export function validateAIMessageBudget(messages:unknown,auditMode:boolean):string|null{
 if(!Array.isArray(messages)||messages.length<1||messages.length>24)
  return 'Send 1–24 chat messages.';
 let total=0;
 for(const item of messages){
  if(!item||typeof item!=='object')return 'Unsupported chat message.';
  const msg=item as {role?:unknown;content?:unknown};
  if(!['system','user','assistant'].includes(String(msg.role))||typeof msg.content!=='string')
   return 'Use supported chat roles and text content.';
  const max=msg.role==='system'?240_000:msg.role==='user'&&auditMode?320_000:80_000;
  if(msg.content.length>max)
   return 'AI context exceeds the bounded '+max.toLocaleString('en-US')+'-character limit for this message. Reduce the attached data or choose a model with more context. No source was silently truncated by this API.';
  total+=msg.content.length;
  if(total>460_000)return 'The combined AI context exceeds 460,000 characters. Reduce earlier turns or audit one trade at a time; no context was silently removed.';
 }
 return null;
}
