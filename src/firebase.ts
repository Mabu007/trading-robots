export type CloudBot = {
  id: string;
  name: string;
  asset: string;
  prompt: string;
  code?: string;
  storageKey?: string;
  updatedAt?: unknown;
  lastBacktest?: { metrics: Record<string, number | string>; candleCount: number; from: string; to: string } | null;
};

export type BotVersion = { id: string; name: string; storageKey: string; createdAt: string };

export type CloudClient = {
  listBots: () => Promise<CloudBot[]>;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
  saveBot: (bot: CloudBot, storageKey: string) => Promise<void>;
  deleteBot: (botId: string) => Promise<void>;
  loadChats: (botId: string) => Promise<any[]>;
  saveChats: (botId: string, chat: any[]) => Promise<void>;
  listVersions: (botId: string) => Promise<BotVersion[]>;
  saveVersionPointer: (botId: string, version: BotVersion) => Promise<void>;
  renameVersionPointer: (botId: string, version: BotVersion) => Promise<void>;
  deleteVersionPointer: (botId: string, versionId: string) => Promise<void>;
  getProfile: () => { uid: string; email: string | null; displayName: string; isAnonymous: boolean; emailVerified: boolean } | null;
  createAccount: (email: string, password: string, displayName: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
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
    await authSdk.getRedirectResult(auth);
    const db = storeSdk.getFirestore(app);
    const signedInUser = async () => {
      await auth.authStateReady();
      const user=auth.currentUser;
      if (!user) throw new Error('Your sign-in is no longer active. Sign in again to continue.');
      return user;
    };
    const currentUserId = async () => (await signedInUser()).uid;

    return {
      async listBots() {
        const botCollection = storeSdk.collection(db, 'users', await currentUserId(), 'bots');
        const snapshot = await storeSdk.getDocs(storeSdk.query(botCollection, storeSdk.limit(100)));
        return snapshot.docs.map((doc: any) => { const data = doc.data(); return { id: doc.id, ...data, storageKey: data.storage?.key } }) as CloudBot[];
      },
      async getIdToken(forceRefresh = false) {
        return (await signedInUser()).getIdToken(forceRefresh);
      },
      async saveBot(bot: CloudBot, storageKey: string) {
        const reference = storeSdk.doc(db, 'users', await currentUserId(), 'bots', bot.id);
        const payload = {
          name: bot.name.slice(0, 64),
          asset: bot.asset,
          prompt: bot.prompt.slice(0, 12_000),
          storage: { provider: 'r2', key: storageKey },
          lastBacktest: bot.lastBacktest ?? null,
          updatedAt: storeSdk.serverTimestamp(),
          code: storeSdk.deleteField(),
        };
        await storeSdk.setDoc(reference, payload, { merge: true });
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
      async createAccount(email: string, password: string, displayName: string) {
        const user = auth.currentUser;
        const credential = authSdk.EmailAuthProvider.credential(email, password);
        const result = user?.isAnonymous
          ? await authSdk.linkWithCredential(user, credential)
          : await authSdk.createUserWithEmailAndPassword(auth, email, password);
        if (displayName.trim()) await authSdk.updateProfile(result.user, { displayName: displayName.trim().slice(0, 60) });
      },
      async signIn(email: string, password: string) {
        await authSdk.signInWithEmailAndPassword(auth, email, password);
        await auth.authStateReady();
      },
      async signInWithGoogle() {
        const provider = new authSdk.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        // Popup completes on this origin, avoiding redirect storage restrictions on hosted domains.
        if (auth.currentUser?.isAnonymous) await authSdk.linkWithPopup(auth.currentUser, provider);
        else await authSdk.signInWithPopup(auth, provider);
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
  if (code.includes('auth/unauthorized-domain')) return `Google sign-in needs ${window.location.hostname} added to Firebase Authentication → Settings → Authorized domains.`;
  if (code.includes('auth/too-many-requests')) return 'Too many sign-in attempts. Wait a few minutes, then try again.';
  if (code.includes('auth/user-disabled')) return 'This account is currently unavailable. Please contact support.';
  if (code.includes('auth/network-request-failed')) return 'Could not reach account services. Check your connection and try again.';
  if (code.includes('auth/account-exists-with-different-credential')) return 'An account already uses this email. Sign in with your email and password, then connect Google from your account settings.';
  if (code.includes('auth/admin-restricted-operation') || code.includes('auth/operation-not-allowed')) return 'This sign-in option is temporarily unavailable. Try another option or contact support.';
  if (code.includes('permission-denied')) return 'Could not access your saved workspace. Please refresh and try again.';
  if (code.includes('auth/email-already-in-use') || code.includes('auth/credential-already-in-use')) return 'That email already has an account. Choose Sign in to open its robot library.';
  if (code.includes('auth/weak-password')) return 'Choose a password with at least 6 characters.';
  if (code.includes('auth/invalid-email')) return 'Enter a valid email address.';
  if (code.includes('auth/invalid-credential') || code.includes('auth/wrong-password') || code.includes('auth/user-not-found')) return 'Email or password is incorrect. Check the details or reset your password.';
  if (code.includes('auth/popup-blocked')) return 'Google sign-in popup was blocked. Allow popups for this site and try again.';
  if (code.includes('auth/popup-closed-by-user')) return 'Google sign-in was cancelled. Try again when you are ready.';
  if (code.includes('auth/web-storage-unsupported')) return 'This browser is blocking secure sign-in storage. Enable site data and try again.';
  if (code.includes('auth/credential-already-in-use')) return 'That Google account already has a Trading Vibes profile. Choose Sign in to open it.';
  if (code.includes('unavailable') || code.includes('network')) return 'Cloud sync is temporarily unavailable. Your work on this device is still available.';
  return 'Something went wrong with account sync. Please try again.';
}
