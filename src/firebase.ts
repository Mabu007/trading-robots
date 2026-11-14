import {venueOf,type Venue} from '../shared/venues';
import {cloudBotFromRecord} from './cloud-bot';
import type {CodeAnalysis} from './code-analysis';
import type {PracticeRecord} from './practice-history';
import {validateSkill,type UserSkill} from './skills';
export type CloudBot = {
  id: string;
  name: string;
  asset: string;
  venue?: Venue;
  prompt: string;
  code?: string;
  storageKey?: string;
  updatedAt?: unknown;
  lastBacktest?: { metrics: Record<string, number | string>; candleCount: number; from: string; to: string; money?: {netProfit:number;returnPercent:number;currency:'ZAR'} } | null;
};

export type BotVersion = { id: string; name: string; storageKey: string; createdAt: string };

import {verifiedPreferences,saneTask,type TradingPreferences,type ConversationTask} from './conversation-workflow';
export type CloudClient = {
  listConversations: () => Promise<{id:string;title:string;model?:string|null}[]>;
  loadConversation: (id:string) => Promise<any[]|null>;
  loadConversationRecord: (id:string) => Promise<{messages:any[];model:string|null;title:string;task:ConversationTask|null}|null>;
  saveConversation: (id:string, messages:any[],semanticTitle?:string,task?:ConversationTask|null) => Promise<void>;
  renameConversation: (id:string,title:string) => Promise<void>;
  deleteConversation: (id:string) => Promise<void>;
  selectConversationModel: (id:string,model:string|null) => Promise<void>;
  listSkills: () => Promise<UserSkill[]>;
  saveSkill: (skill:UserSkill) => Promise<void>;
  deleteSkill: (id:string) => Promise<void>;
  loadTradingPreferences: () => Promise<TradingPreferences>;
  saveTradingPreferences: (prefs:TradingPreferences) => Promise<void>;
  loadPersonality: () => Promise<string>;
  savePersonality: (instructions:string) => Promise<void>;
  listPracticeRecords: () => Promise<PracticeRecord[]>;
  savePracticeRecord: (record:PracticeRecord) => Promise<void>;
  listBots: () => Promise<CloudBot[]>;
  listCodeAnalyses: () => Promise<CodeAnalysis[]>;
  saveCodeAnalysis: (analysis:CodeAnalysis) => Promise<void>;
  deleteCodeAnalysis: (id:string) => Promise<void>;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
  saveBot: (bot: CloudBot, storageKey: string) => Promise<void>;
  saveBacktestSummary: (botId: string, lastBacktest: NonNullable<CloudBot['lastBacktest']>) => Promise<void>;
  deleteBot: (botId: string) => Promise<void>;
  loadChats: (botId: string) => Promise<any[]>;
  saveChats: (botId: string, chat: any[]) => Promise<void>;
  listVersions: (botId: string) => Promise<BotVersion[]>;
  saveVersionPointer: (botId: string, version: BotVersion) => Promise<void>;
  renameVersionPointer: (botId: string, version: BotVersion) => Promise<void>;
  deleteVersionPointer: (botId: string, versionId: string) => Promise<void>;
  getProfile: () => { uid: string; email: string | null; displayName: string; isAnonymous: boolean; emailVerified: boolean } | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  sendVerificationEmail: () => Promise<void>;
  refreshIdentity: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  updateDisplayName: (displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const requiredConfig = ['apiKey', 'authDomain', 'projectId', 'appId'] as const;
export const firebaseConfigured = requiredConfig.every((key) => Boolean(firebaseConfig[key]));
let clientPromise: Promise<CloudClient | null> | undefined;

export function connectFirebase(): Promise<CloudClient | null> {
  if (!firebaseConfigured) return Promise.resolve(null);
  if (clientPromise) return clientPromise;

  clientPromise = (async () => {
    const cdn = 'https://www.gstatic.com/firebasejs/12.19.0';
    const [appSdk, authSdk, storeSdk] = await Promise.all([
      import(/* @vite-ignore */ `${cdn}/firebase-app.js`),
      import(/* @vite-ignore */ `${cdn}/firebase-auth.js`),
      import(/* @vite-ignore */ `${cdn}/firebase-firestore.js`),
    ]);
    const app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp(firebaseConfig);
    const auth = authSdk.getAuth(app);
    await authSdk.setPersistence(auth, authSdk.browserLocalPersistence);
    await auth.authStateReady();
    const db = storeSdk.getFirestore(app);
    const signedInUser = async () => {
      await auth.authStateReady();
      const user=auth.currentUser;
      if (!user) throw new Error('Your sign-in is no longer active. Sign in again to continue.');
      return user;
    };
    const currentUserId = async () => (await signedInUser()).uid;
    const deletedConversationIds = new Set<string>();
    const pendingConversationWrites = new Map<string,Promise<void>>();

    return {
      async listPracticeRecords(){
        const uid=await currentUserId();
        const snapshot=await storeSdk.getDocs(storeSdk.query(storeSdk.collection(db,'users',uid,'practiceRecords'),storeSdk.orderBy('completedAt','desc'),storeSdk.limit(100)));
        return snapshot.docs.map((doc:any)=>({...doc.data(),id:doc.id}) as PracticeRecord);
      },
      async savePracticeRecord(record:PracticeRecord){
        if(!/^[a-zA-Z0-9-]{1,80}$/.test(record.id))throw Error('Invalid practice record identifier.');
        const uid=await currentUserId();
        await storeSdk.setDoc(storeSdk.doc(db,'users',uid,'practiceRecords',record.id),record);
      },
      async listBots() {
        const botCollection = storeSdk.collection(db, 'users', await currentUserId(), 'bots');
        const snapshot = await storeSdk.getDocs(storeSdk.query(botCollection, storeSdk.limit(100)));
        return snapshot.docs.map((doc:any)=>cloudBotFromRecord(doc.id,doc.data()));
      },
      async getIdToken(forceRefresh = false) {
        return (await signedInUser()).getIdToken(forceRefresh);
      },
      async saveBot(bot: CloudBot, storageKey: string) {
        const reference = storeSdk.doc(db, 'users', await currentUserId(), 'bots', bot.id);
        const payload = {
          name: bot.name.slice(0, 64),
          asset: bot.asset,
          venue: venueOf(bot.venue),
          prompt: bot.prompt.slice(0, 12_000),
          storage: { provider: 'r2', key: storageKey },
          ...(bot.lastBacktest===undefined?{}:{lastBacktest:bot.lastBacktest}),
          updatedAt: storeSdk.serverTimestamp(),
          code: storeSdk.deleteField(),
        };
        await storeSdk.setDoc(reference, payload, { merge: true });
      },
      async saveBacktestSummary(botId, lastBacktest) {
        const reference = storeSdk.doc(db, 'users', await currentUserId(), 'bots', botId);
        await storeSdk.updateDoc(reference, {lastBacktest, updatedAt: storeSdk.serverTimestamp()});
      },
      async listCodeAnalyses(){
        const uid=await currentUserId();
        const reference=storeSdk.collection(db,'users',uid,'codeAnalyses');
        const snapshot=await storeSdk.getDocs(storeSdk.query(reference,storeSdk.limit(100)));
        return snapshot.docs.map((doc:any)=>{
         const data=doc.data()||{};
         if(!['liquidity_sweeps','volatility_profile'].includes(data.kind)||!['m1','m5','m15','h1'].includes(data.timeframe))return null;
         return {id:doc.id,name:String(data.name||'Market analysis').slice(0,80),kind:data.kind,asset:String(data.asset||'').slice(0,50),venue:venueOf(data.venue),timeframe:data.timeframe,lookback:Number(data.lookback)||5,source:String(data.source||'').slice(0,30000),updatedAt:typeof data.updatedAt?.toMillis==='function'?data.updatedAt.toMillis():undefined} as CodeAnalysis;
        }).filter(Boolean) as CodeAnalysis[];
      },
      async saveCodeAnalysis(analysis:CodeAnalysis){
       if(!/^analysis-[a-z0-9_-]{8,100}$/.test(analysis.id)||!['liquidity_sweeps','volatility_profile'].includes(analysis.kind)||!['m1','m5','m15','h1'].includes(analysis.timeframe)||analysis.source.length>30000)throw Error('Invalid Code analysis record.');
       const uid=await currentUserId();
       await storeSdk.setDoc(storeSdk.doc(db,'users',uid,'codeAnalyses',analysis.id),{name:analysis.name.slice(0,80),kind:analysis.kind,asset:analysis.asset.slice(0,50),venue:venueOf(analysis.venue),timeframe:analysis.timeframe,lookback:analysis.lookback,source:analysis.source,updatedAt:storeSdk.serverTimestamp()},{merge:false});
      },
      async deleteCodeAnalysis(id:string){
        if(!/^analysis-[a-z0-9_-]{8,100}$/.test(id))throw Error('Invalid Code analysis ID.');
        await storeSdk.deleteDoc(storeSdk.doc(db,'users',await currentUserId(),'codeAnalyses',id));
      },
      async deleteBot(botId: string) {
        const uid = await currentUserId();
        const reference = storeSdk.doc(db, 'users', uid, 'bots', botId);
        const versions = await storeSdk.getDocs(storeSdk.collection(reference, 'versions'));
        for (let i = 0; i < versions.docs.length; i += 400) {
          const chunk = storeSdk.writeBatch(db);
          versions.docs.slice(i, i + 400).forEach((version: any) => chunk.delete(version.ref));
          await chunk.commit();
        }
        const batch = storeSdk.writeBatch(db);
        batch.delete(storeSdk.doc(reference, 'chats', 'current'));
        batch.delete(reference);
        await batch.commit();
      },
      async listConversations(){
        const uid=await currentUserId();
        const reference=storeSdk.collection(db,'users',uid,'conversations');
        const snapshot=await storeSdk.getDocs(storeSdk.query(reference,storeSdk.orderBy('updatedAt','desc'),storeSdk.limit(100)));
        return snapshot.docs.filter((doc:any)=>!deletedConversationIds.has(uid+':'+doc.id)).map((doc:any)=>{
          const data=doc.data()||{},first=Array.isArray(data.messages)?data.messages.find((m:any)=>m.role==='user'&&typeof m.content==='string'):null;
          return {id:doc.id,title:String(data.title||first?.content||'New chat').slice(0,80),model:typeof data.model==='string'?data.model:null};
        });
      },
      async loadConversationRecord(id:string){
        const uid=await currentUserId();
        if(deletedConversationIds.has(uid+':'+id))return null;
        const snapshot=await storeSdk.getDoc(storeSdk.doc(db,'users',uid,'conversations',id));
        if(!snapshot.exists())return null;
        const data=snapshot.data()||{},messages=data.messages;
        return {messages:Array.isArray(messages)?messages.filter((m:any)=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string'):[],model:typeof data.model==='string'?data.model:null,title:String(data.title||'New chat'),task:saneTask(data.task)};
      },
      async loadConversation(id:string){
        return (await this.loadConversationRecord(id))?.messages??null;
      },
      async saveConversation(id:string,chat:any[],semanticTitle?:string,assistantTask?:ConversationTask|null){
        const uid=await currentUserId(),key=uid+':'+id;
        if(deletedConversationIds.has(key))return;
        let messages=chat.slice(-60).map(item=>{
          if(!item.toolReceiptId)return item;
          const {toolTrace:_,...message}=item;
          return message;
        });
        while(messages.length>1&&JSON.stringify(messages).length>650000)messages=messages.slice(1);
        if(JSON.stringify(messages).length>650000)throw Error('Conversation is too large to save.');
        const payload=JSON.parse(JSON.stringify(messages));
        const previous=pendingConversationWrites.get(key);
        const task=(previous||Promise.resolve()).catch(()=>undefined).then(async()=>{
          if(deletedConversationIds.has(key))return;
          const ref=storeSdk.doc(db,'users',uid,'conversations',id);
          // Respect a user's manual chat title. Only auto-label conversations
          // that have never been explicitly renamed.
          const prior=semanticTitle?await storeSdk.getDoc(ref):null;
          const manuallyNamed=prior?.exists()&&prior.data()?.titleEdited===true;
          await storeSdk.setDoc(ref,{
            messages:payload,updatedAt:storeSdk.serverTimestamp(),
            ...(assistantTask!==undefined?{task:saneTask(assistantTask)}:{}),
            ...(!manuallyNamed&&semanticTitle?{title:semanticTitle.slice(0,80)}:{})
          },{merge:true});
        });
        pendingConversationWrites.set(key,task);
        try{await task}finally{if(pendingConversationWrites.get(key)===task)pendingConversationWrites.delete(key)}
      },
      async renameConversation(id:string,title:string){
        const name=title.trim();
        if(!name||name.length>80)throw Error('Chat name must be 1–80 characters.');
        const uid=await currentUserId(),key=uid+':'+id;
        if(deletedConversationIds.has(key))throw Error('This conversation was deleted.');
        await pendingConversationWrites.get(key)?.catch(()=>undefined);
        await storeSdk.setDoc(storeSdk.doc(db,'users',uid,'conversations',id),{title:name,titleEdited:true,updatedAt:storeSdk.serverTimestamp()},{merge:true});
      },
      async deleteConversation(id:string){
        const uid=await currentUserId(),key=uid+':'+id;
        deletedConversationIds.add(key);
        try{
          await pendingConversationWrites.get(key)?.catch(()=>undefined);
          await storeSdk.deleteDoc(storeSdk.doc(db,'users',uid,'conversations',id));
        }catch(error){deletedConversationIds.delete(key);throw error}
      },
      async selectConversationModel(id:string,model:string|null){
        const uid=await currentUserId();
        if(deletedConversationIds.has(uid+':'+id))throw Error('This conversation was deleted.');
        if(model!==null&&!/^[a-zA-Z0-9_.:/-]{1,200}$/.test(model))throw Error('Choose an available OpenRouter model.');
        await storeSdk.setDoc(storeSdk.doc(db,'users',uid,'conversations',id),{model,updatedAt:storeSdk.serverTimestamp()},{merge:true});
      },
      async listSkills(){
        const reference=storeSdk.collection(db,'users',await currentUserId(),'skills');
        const snapshot=await storeSdk.getDocs(reference);
        return snapshot.docs.flatMap((doc:any)=>{
          try{const data=doc.data();return [validateSkill({id:doc.id,name:String(data.name||''),description:String(data.description||''),instructions:String(data.instructions||''),triggers:Array.isArray(data.triggers)?data.triggers:[],enabled:data.enabled===true,alwaysOn:data.alwaysOn===true,updatedAt:data.updatedAt?.toMillis?.()})]}catch{return []}
        }).sort((a:UserSkill,b:UserSkill)=>(b.updatedAt??0)-(a.updatedAt??0)||a.name.localeCompare(b.name));
      },
      async saveSkill(raw:UserSkill){
        const skill=validateSkill(raw);
        await storeSdk.setDoc(storeSdk.doc(db,'users',await currentUserId(),'skills',skill.id),{name:skill.name,description:skill.description,instructions:skill.instructions,triggers:skill.triggers,enabled:skill.enabled,alwaysOn:skill.alwaysOn,updatedAt:storeSdk.serverTimestamp()},{merge:false});
      },
      async deleteSkill(id:string){
        if(!/^skill-[a-zA-Z0-9_-]{8,90}$/.test(id))throw Error('Invalid skill ID.');
        await storeSdk.deleteDoc(storeSdk.doc(db,'users',await currentUserId(),'skills',id));
      },
      async loadTradingPreferences(){
        const snapshot=await storeSdk.getDoc(storeSdk.doc(db,'users',await currentUserId(),'preferences','trading'));
        return verifiedPreferences(snapshot.exists()?snapshot.data():null);
      },
      async saveTradingPreferences(input:TradingPreferences){
        const prefs=verifiedPreferences(input);
        await storeSdk.setDoc(storeSdk.doc(db,'users',await currentUserId(),'preferences','trading'),
          {...prefs,updatedAt:storeSdk.serverTimestamp()},{merge:true});
      },
      async loadPersonality(){
        const snapshot=await storeSdk.getDoc(storeSdk.doc(db,'users',await currentUserId(),'preferences','personality'));
        const value=snapshot.exists()?snapshot.data()?.instructions:'';
        return typeof value==='string'?value.slice(0,4000):'';
      },
      async savePersonality(instructions:string){
        if(typeof instructions!=='string'||instructions.length>4000)throw Error('Personality must be under 4,000 characters.');
        await storeSdk.setDoc(storeSdk.doc(db,'users',await currentUserId(),'preferences','personality'),{instructions:instructions.trim(),updatedAt:storeSdk.serverTimestamp()},{merge:true});
      },
      async loadChats(botId: string) {
        const reference = storeSdk.doc(db, 'users', await currentUserId(), 'bots', botId, 'chats', 'current');
        const snapshot = await storeSdk.getDoc(reference);
        const messages = snapshot.exists() ? snapshot.data()?.messages : [];
        return Array.isArray(messages) ? messages : [];
      },
      async saveChats(botId: string, chat: any[]) {
        const reference = storeSdk.doc(db, 'users', await currentUserId(), 'bots', botId, 'chats', 'current');
        let messages = chat.slice(-60);
        while (messages.length > 1 && JSON.stringify(messages).length > 650_000) messages = messages.slice(1);
        await storeSdk.setDoc(reference, { messages, updatedAt: storeSdk.serverTimestamp() });
      },
      async listVersions(botId: string) {
        const versions = storeSdk.collection(db, 'users', await currentUserId(), 'bots', botId, 'versions');
        const snapshot = await storeSdk.getDocs(storeSdk.query(versions, storeSdk.orderBy('createdAt', 'desc'), storeSdk.limit(100)));
        return snapshot.docs.map((document: any) => ({ id: document.id, ...document.data() })) as BotVersion[];
      },
      async saveVersionPointer(botId: string, version: BotVersion) {
        const reference = storeSdk.doc(db, 'users', await currentUserId(), 'bots', botId, 'versions', version.id);
        await storeSdk.setDoc(reference, { ...version, updatedAt: storeSdk.serverTimestamp() });
      },
      async renameVersionPointer(botId: string, version: BotVersion) {
        const reference = storeSdk.doc(db, 'users', await currentUserId(), 'bots', botId, 'versions', version.id);
        await storeSdk.updateDoc(reference, { name: version.name, updatedAt: storeSdk.serverTimestamp() });
      },
      async deleteVersionPointer(botId: string, versionId: string) {
        const reference = storeSdk.doc(db, 'users', await currentUserId(), 'bots', botId, 'versions', versionId);
        await storeSdk.deleteDoc(reference);
      },
      getProfile() {
        const user = auth.currentUser;
        if (!user) return null;
        return { uid: user.uid, email: user.email, displayName: user.displayName || '', isAnonymous: user.isAnonymous, emailVerified:user.emailVerified };
      },
      async signUp(email: string, password: string) {
        await authSdk.createUserWithEmailAndPassword(auth, email, password);
        await auth.authStateReady();
      },
      async signIn(email: string, password: string) {
        await authSdk.signInWithEmailAndPassword(auth, email, password);
        await auth.authStateReady();
      },
      async sendVerificationEmail(){const user=await signedInUser();if(user.emailVerified)return;if(!user.email)throw Error('This account needs an email address.');await authSdk.sendEmailVerification(user);},
      async refreshIdentity(){const user=await signedInUser();await authSdk.reload(user);await user.getIdToken(true);},
      async sendPasswordReset(email: string) {
        await authSdk.sendPasswordResetEmail(auth, email);
      },
      async updateDisplayName(displayName: string) {
        const user = auth.currentUser;
        if (!user) throw new Error('Your sign-in is no longer active. Sign in again to continue.');
        await authSdk.updateProfile(user, { displayName: displayName.trim().slice(0, 60) });
      },
      async signOut() { await authSdk.signOut(auth); },
    } satisfies CloudClient;
  })().catch((error) => {
    clientPromise = undefined;
    throw new Error(readableFirebaseError(error));
  });

  return clientPromise;
}

export function readableFirebaseError(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  if(error instanceof Error&&/Account services are not configured|Your sign-in is no longer active/.test(error.message))return error.message;
  if (code.includes('auth/api-key-not-valid') || code.includes('auth/configuration-not-found')) return 'Account services are temporarily unavailable. Please try again later.';
  if (code.includes('auth/too-many-requests')) return 'Too many sign-in attempts. Wait a few minutes, then try again.';
  if (code.includes('auth/user-disabled')) return 'This account is currently unavailable. Please contact support.';
  if (code.includes('auth/network-request-failed')) return 'Could not reach account services. Check your connection and try again.';
  if (code.includes('auth/account-exists-with-different-credential')) return 'An account already uses this email. Try signing in or resetting your password.';
  if (code.includes('auth/admin-restricted-operation') || code.includes('auth/operation-not-allowed')) return 'This sign-in option is temporarily unavailable. Try another option or contact support.';
  if (code.includes('permission-denied')) return 'Could not access your saved workspace. Please refresh and try again.';
  if (code.includes('auth/email-already-in-use') || code.includes('auth/credential-already-in-use')) return 'That email already has an account. Choose Sign in to access your account.';
  if (code.includes('auth/weak-password')) return 'Choose a password with at least 6 characters.';
  if (code.includes('auth/invalid-email')) return 'Enter a valid email address.';
  if (code.includes('auth/invalid-credential') || code.includes('auth/wrong-password') || code.includes('auth/user-not-found')) return 'Email or password is incorrect. Check the details or reset your password.';
  if (code.includes('auth/web-storage-unsupported')) return 'This browser is blocking secure sign-in storage. Enable site data and try again.';
  if (code.includes('unavailable') || code.includes('network')) return 'Cloud sync is temporarily unavailable. Your work on this device is still available.';
  return 'Something went wrong with account sync. Please try again.';
}
