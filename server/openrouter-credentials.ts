export function selectOpenRouterApiKey(personalKey:string|undefined,sharedKey:string|undefined,allowShared:boolean):string|undefined{
 const personal=personalKey?.trim();if(personal)return personal;
 const shared=sharedKey?.trim();return allowShared&&shared?shared:undefined;
}
