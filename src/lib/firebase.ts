import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type { AutomationJob, CaptionLanguage, StudioChannel } from '../types/studio';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.upload',
];

const googleProvider = new GoogleAuthProvider();
for (const scope of YOUTUBE_SCOPES) {
  googleProvider.addScope(scope);
}
googleProvider.setCustomParameters({
  prompt: 'select_account',
});

// Strictly in-memory OAuth access token cache (never localStorage/sessionStorage)
let primaryAccessToken: string | null = null;
const channelAccessTokens = new Map<string, string>();
let isSigningIn = false;

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: Array<{ providerId?: string | null; email?: string | null }>;
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId ?? null,
      providerInfo:
        auth.currentUser?.providerData?.map((p) => ({
          providerId: p.providerId,
          email: p.email,
        })) ?? [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

testFirestoreConnection();

export function initFirebaseAuth(
  onUserChange: (user: User | null, accessToken: string | null) => void
): () => void {
  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      primaryAccessToken = null;
      channelAccessTokens.clear();
      onUserChange(null, null);
      return;
    }
    if (!isSigningIn) {
      onUserChange(user, primaryAccessToken);
    }
  });
}

export async function signInWithGoogleAndYouTube(): Promise<{
  user: User;
  accessToken: string | null;
}> {
  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    primaryAccessToken = credential?.accessToken ?? null;
    return {
      user: result.user,
      accessToken: primaryAccessToken,
    };
  } finally {
    isSigningIn = false;
  }
}

export async function authorizeAdditionalYouTubeAccount(): Promise<{
  email: string | null;
  accessToken: string;
}> {
  const secondaryProvider = new GoogleAuthProvider();
  for (const scope of YOUTUBE_SCOPES) {
    secondaryProvider.addScope(scope);
  }
  secondaryProvider.setCustomParameters({
    prompt: 'consent select_account',
  });
  const result = await signInWithPopup(auth, secondaryProvider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) {
    throw new Error('Could not obtain YouTube OAuth access token from Google.');
  }
  primaryAccessToken = credential.accessToken;
  return {
    email: result.user.email,
    accessToken: credential.accessToken,
  };
}

export function setChannelAccessToken(youtubeChannelId: string, token: string): void {
  channelAccessTokens.set(youtubeChannelId, token);
}

export function getAccessTokenForChannel(youtubeChannelId?: string): string | null {
  if (youtubeChannelId && channelAccessTokens.has(youtubeChannelId)) {
    return channelAccessTokens.get(youtubeChannelId) ?? null;
  }
  return primaryAccessToken;
}

export async function signOutUser(): Promise<void> {
  primaryAccessToken = null;
  channelAccessTokens.clear();
  await signOut(auth);
}

export async function upsertUserProfile(
  user: User,
  defaults?: { defaultMaxDuration?: number; defaultLanguage?: CaptionLanguage }
): Promise<void> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  try {
    const existingSnap = await getDocFromServer(ref);
    if (!existingSnap.exists()) {
      await setDoc(ref, {
        uid: user.uid,
        email: (user.email ?? 'creator@example.com').slice(0, 254),
        displayName: (user.displayName ?? user.email ?? 'Creator').slice(0, 120),
        photoURL: (user.photoURL ?? '').slice(0, 500),
        defaultMaxDuration: defaults?.defaultMaxDuration ?? 45,
        defaultLanguage: defaults?.defaultLanguage ?? 'hinglish',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        displayName: (user.displayName ?? user.email ?? 'Creator').slice(0, 120),
        photoURL: (user.photoURL ?? '').slice(0, 500),
        defaultMaxDuration: defaults?.defaultMaxDuration ?? existingSnap.data().defaultMaxDuration ?? 45,
        defaultLanguage: defaults?.defaultLanguage ?? existingSnap.data().defaultLanguage ?? 'hinglish',
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeUserChannels(
  uid: string,
  onData: (channels: StudioChannel[]) => void,
  onError?: (err: Error) => void
): () => void {
  const path = 'channels';
  const q = query(collection(db, path), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items: StudioChannel[] = snap.docs.map((d) => {
        const raw = d.data();
        return {
          id: d.id,
          ownerId: String(raw.ownerId ?? uid),
          youtubeChannelId: String(raw.youtubeChannelId ?? d.id),
          title: String(raw.title ?? 'YouTube Channel'),
          handle: String(raw.handle ?? '@channel'),
          thumbnailUrl: String(raw.thumbnailUrl ?? ''),
          subscriberCount: String(raw.subscriberCount ?? '0'),
          isOAuthConnected: Boolean(raw.isOAuthConnected),
          videosPerDay: Number(raw.videosPerDay ?? 1),
          postingSlots: Array.isArray(raw.postingSlots) ? raw.postingSlots.map(String) : ['10:00'],
          preferredTemplate: String(raw.preferredTemplate ?? 'viral-hook-bold'),
          maxClipDuration: Number(raw.maxClipDuration ?? 45),
          automationMonths: Number(raw.automationMonths ?? 3),
          automationActive: Boolean(raw.automationActive),
        };
      });
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) onError(wrapped);
      }
    }
  );
}

export async function saveChannelRecord(
  uid: string,
  channel: Omit<StudioChannel, 'ownerId' | 'createdAt' | 'updatedAt'>,
  isNew: boolean
): Promise<void> {
  const safeId = channel.id.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120);
  const path = `channels/${safeId}`;
  const ref = doc(db, 'channels', safeId);
  const payload = {
    ownerId: uid,
    youtubeChannelId: channel.youtubeChannelId.slice(0, 128),
    title: channel.title.slice(0, 120),
    handle: (channel.handle || '@channel').slice(0, 80),
    thumbnailUrl: (channel.thumbnailUrl || '').slice(0, 500),
    subscriberCount: (channel.subscriberCount || '0').slice(0, 40),
    isOAuthConnected: Boolean(channel.isOAuthConnected),
    videosPerDay: Math.max(1, Math.min(3, Number(channel.videosPerDay) || 1)),
    postingSlots: (channel.postingSlots.length > 0 ? channel.postingSlots : ['10:00']).slice(0, 3),
    preferredTemplate: channel.preferredTemplate.slice(0, 64),
    maxClipDuration: Math.max(15, Math.min(60, Number(channel.maxClipDuration) || 45)),
    automationMonths: Math.max(1, Math.min(12, Number(channel.automationMonths) || 3)),
    automationActive: Boolean(channel.automationActive),
    updatedAt: serverTimestamp(),
  };

  try {
    if (isNew) {
      await setDoc(ref, {
        ...payload,
        createdAt: serverTimestamp(),
      });
    } else {
      const { ownerId: _omit, ...updatePayload } = payload;
      await updateDoc(ref, updatePayload);
    }
  } catch (error) {
    handleFirestoreError(error, isNew ? OperationType.CREATE : OperationType.UPDATE, path);
  }
}

export async function deleteChannelRecord(channelId: string): Promise<void> {
  const path = `channels/${channelId}`;
  try {
    await deleteDoc(doc(db, 'channels', channelId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeAutomationJobs(
  uid: string,
  onData: (jobs: AutomationJob[]) => void,
  onError?: (err: Error) => void
): () => void {
  const path = 'automationJobs';
  const q = query(collection(db, path), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items: AutomationJob[] = snap.docs.map((d) => {
        const raw = d.data();
        return {
          id: d.id,
          ownerId: String(raw.ownerId ?? uid),
          channelId: String(raw.channelId ?? ''),
          sourceType: (raw.sourceType ?? 'youtube_url') as AutomationJob['sourceType'],
          sourceUrl: raw.sourceUrl ? String(raw.sourceUrl) : undefined,
          sourceTitle: String(raw.sourceTitle ?? ''),
          sourceVideoId: raw.sourceVideoId ? String(raw.sourceVideoId) : undefined,
          clipStartSec: Number(raw.clipStartSec ?? 0),
          clipEndSec: Number(raw.clipEndSec ?? 30),
          durationSec: Number(raw.durationSec ?? 30),
          templateId: String(raw.templateId ?? 'viral-hook-bold'),
          copyrightFreeTransforms: Array.isArray(raw.copyrightFreeTransforms)
            ? raw.copyrightFreeTransforms.map(String)
            : [],
          captionsPayload: raw.captionsPayload ? String(raw.captionsPayload) : undefined,
          title: String(raw.title ?? 'Scheduled Short'),
          description: raw.description ? String(raw.description) : undefined,
          scheduledAt: String(raw.scheduledAt ?? new Date().toISOString()),
          status: (raw.status ?? 'scheduled') as AutomationJob['status'],
          youtubeVideoId: raw.youtubeVideoId ? String(raw.youtubeVideoId) : undefined,
          renderPath: raw.renderPath ? String(raw.renderPath) : undefined,
        };
      });
      items.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) onError(wrapped);
      }
    }
  );
}

export async function createAutomationJobRecord(
  uid: string,
  job: Omit<AutomationJob, 'ownerId' | 'createdAt' | 'updatedAt'>
): Promise<void> {
  const safeId = job.id.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120);
  const path = `automationJobs/${safeId}`;
  try {
    await setDoc(doc(db, 'automationJobs', safeId), {
      ownerId: uid,
      channelId: job.channelId.slice(0, 120),
      sourceType: job.sourceType,
      ...(job.sourceUrl ? { sourceUrl: job.sourceUrl.slice(0, 500) } : {}),
      sourceTitle: job.sourceTitle.slice(0, 200),
      ...(job.sourceVideoId ? { sourceVideoId: job.sourceVideoId.slice(0, 64) } : {}),
      clipStartSec: Math.max(0, Number(job.clipStartSec) || 0),
      clipEndSec: Math.max(0, Number(job.clipEndSec) || 30),
      durationSec: Math.max(1, Math.min(60, Number(job.durationSec) || 30)),
      templateId: job.templateId.slice(0, 64),
      copyrightFreeTransforms: job.copyrightFreeTransforms.slice(0, 6),
      ...(job.captionsPayload ? { captionsPayload: job.captionsPayload.slice(0, 16000) } : {}),
      title: job.title.slice(0, 120),
      ...(job.description ? { description: job.description.slice(0, 2000) } : {}),
      scheduledAt: job.scheduledAt.slice(0, 64),
      status: job.status,
      ...(job.youtubeVideoId ? { youtubeVideoId: job.youtubeVideoId.slice(0, 64) } : {}),
      ...(job.renderPath ? { renderPath: job.renderPath.slice(0, 500) } : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function markJobPublished(jobId: string, youtubeVideoId: string): Promise<void> {
  const path = `automationJobs/${jobId}`;
  try {
    await updateDoc(doc(db, 'automationJobs', jobId), {
      status: 'published',
      youtubeVideoId: youtubeVideoId.slice(0, 64),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteAutomationJobRecord(jobId: string): Promise<void> {
  const path = `automationJobs/${jobId}`;
  try {
    await deleteDoc(doc(db, 'automationJobs', jobId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
