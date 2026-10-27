import { createSign } from 'node:crypto';
export type RecordData = Record<string, any>;
export interface RecordStore { get(path:string):Promise<RecordData|null>; put(path:string,data:RecordData):Promise<void>; create(path:string,data:RecordData):Promise<boolean>; query(collection:string,field?:string,value?:string):Promise<RecordData[]>; }
function value(v:any):any { if(v===null)return {nullValue:null};if(typeof v==='string')return {stringValue:v};if(typeof v==='boolean')return {booleanValue:v};if(typeof v==='number')return Number.isSafeInteger(v)?{integerValue:String(v)}:{doubleValue:v};if(Array.isArray(v))return {arrayValue:{values:v.map(value)}};return {mapValue:{fields:fields(v)}}; }
const fields=(v:RecordData)=>Object.fromEntries(Object.entries(v).filter(([,v])=>v!==undefined).map(([k,v])=>[k,value(v)]));
function unpack(v:any):any {if('nullValue'in v)return null;if('integerValue'in v)return Number(v.integerValue);if('doubleValue'in v)return v.doubleValue;if('booleanValue'in v)return v.booleanValue;if('stringValue'in v)return v.stringValue;if(v.arrayValue)return(v.arrayValue.values||[]).map(unpack);if(v.mapValue)return decode(v.mapValue.fields||{});return null;}
const decode=(v:RecordData)=>Object.fromEntries(Object.entries(v).map(([k,v])=>[k,unpack(v)]));
export class FirestoreStore implements RecordStore {
  private token='';private expires=0;
  private project:string;
  constructor(project=process.env.FIREBASE_PROJECT_ID||process.env.VITE_FIREBASE_PROJECT_ID||''){this.project=project;}
  static configured(){return Boolean(process.env.FIREBASE_CLIENT_EMAIL&&process.env.FIREBASE_PRIVATE_KEY&&(process.env.FIREBASE_PROJECT_ID||process.env.VITE_FIREBASE_PROJECT_ID));}
  private async accessToken(){
    if(this.token&&this.expires>Date.now()+60000)return this.token;
    if(!FirestoreStore.configured())throw Error('Server-side Firebase credentials are not configured.');
    const now=Math.floor(Date.now()/1000),encode=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');
    const input=`${encode({alg:'RS256',typ:'JWT'})}.${encode({iss:process.env.FIREBASE_CLIENT_EMAIL,scope:'https://www.googleapis.com/auth/datastore',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600})}`;
    const signature=createSign('RSA-SHA256').update(input).sign(process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g,'\n'),'base64url');
    const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${input}.${signature}`}),signal:AbortSignal.timeout(10000)});
    const d=await r.json() as any;if(!r.ok||!d.access_token)throw Error('Firebase service authentication failed.');this.token=d.access_token;this.expires=Date.now()+Number(d.expires_in)*1000;return this.token;
  }
  private async call(path:string,method='GET',body?:unknown){const token=await this.accessToken();return fetch(`https://firestore.googleapis.com/v1/projects/${this.project}/databases/(default)/documents${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});}
  async get(path:string){const r=await this.call(`/${path}`);if(r.status===404)return null;if(!r.ok)throw Error('Could not read marketplace records.');const d=await r.json() as any;return decode(d.fields||{});}
  async put(path:string,data:RecordData){const r=await this.call(`/${path}`,'PATCH',{fields:fields(data)});if(!r.ok)throw Error('Could not save marketplace records.');}
  async create(path:string,data:RecordData){const r=await this.call(`/${path}?currentDocument.exists=false`,'PATCH',{fields:fields(data)});if(r.status===409||r.status===412)return false;if(!r.ok)throw Error('Could not create marketplace record.');return true;}
  async query(collection:string,field?:string,value?:string){
    const parts=collection.split('/'),collectionId=parts.pop()!,parent=parts.join('/');
    const result:RecordData[]=[];let after:string|undefined;
    for(let page=0;page<100;page++){
      const r=await this.call(`${parent?'/'+parent:''}:runQuery`,'POST',{structuredQuery:{from:[{collectionId}],...(field?{where:{fieldFilter:{field:{fieldPath:field},op:'EQUAL',value:{stringValue:value}}}}:{}),orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}],...(after?{startAt:{values:[{referenceValue:after}],before:false}}:{}),limit:1000}});
      if(!r.ok)throw Error('Could not query marketplace records.');const data=await r.json() as any[];const docs=data.filter(row=>row.document);
      result.push(...docs.map(row=>({id:row.document.name.split('/').at(-1),...decode(row.document.fields||{})})));
      if(docs.length<1000)return result;after=docs.at(-1).document.name;
    }
    throw Error('Marketplace query exceeded the operational limit. Contact support.');
  }
}
export const recordId=(uid:string)=>Buffer.from(uid).toString('base64url');
