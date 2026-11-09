"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { arrayUnion, doc, updateDoc } from "firebase/firestore";
import { useAuth } from "@/lib/auth";
import { auth, db } from "@/lib/firebase/client";
import { buildBlobPath, isAllowedImageType, MAX_IMAGE_BYTES } from "@/lib/blob/paths";
import { CompressError, compressImage } from "@/lib/blob/compress";
import { deleteImageBlob, uploadImageBlob, type UploadResult } from "@/lib/blob/client";
import { openUploadQueue, startQueueProcessing, type QueueItem, type UploadQueue, type Uploader } from "@/lib/blob/upload-queue";

// P27: photo uploads for the `image` field. One provider per page: it opens the IndexedDB queue (photos survive a reload and bad Wi-Fi), uploads in the
// background (retrying when the network is back), and lets the field show pending / uploading / failed states. A photo whose entry was submitted before it
// finished is attached to the entry afterwards (`attachWhenDone`), so a scout never has to wait on the upload.

/** Where a photo is going: what the server checks (the form's page access) and what the path is built from. */
export type PhotoTarget = { kind: string; formId: string; eventCode: string; teamNumber: string | number };

type Attach = { path: string; fieldKey: string };
const ATTACH_KEY = "compepicurus.photo-attach";

function readAttach(): Record<string, Attach> {
  try {
    return JSON.parse(localStorage.getItem(ATTACH_KEY) ?? "{}") as Record<string, Attach>;
  } catch {
    return {};
  }
}
function writeAttach(map: Record<string, Attach>) {
  try {
    localStorage.setItem(ATTACH_KEY, JSON.stringify(map));
  } catch {
    // storage blocked: the photo then has to finish before the form is submitted (the field says so)
  }
}

export type PhotoUploadValue = {
  /** False until the queue has opened (the field disables adding until then). */
  ready: boolean;
  online: boolean;
  items: QueueItem[];
  /** Compress and queue a photo. Resolves with the queue id. Throws a plain Error with a readable message for a file that can't be used. */
  addPhoto(file: File, target: PhotoTarget, fieldRef: string): Promise<string>;
  /** Forget a queue item (after the form took its result). */
  discard(id: string): Promise<void>;
  /** Retry failed uploads now. */
  retryNow(): void;
  /** Delete an uploaded photo (uploader or admin only; the server decides). */
  deleteUploaded(url: string): Promise<void>;
  /** The entry was saved while these photos were still uploading: attach each to `entryPath`'s `values.<fieldKey>` when it finishes. */
  attachWhenDone(queueIds: string[], entryPath: string, fieldKey: string): void;
};

const PhotoUploadContext = createContext<PhotoUploadValue | null>(null);

export const usePhotoUploads = (): PhotoUploadValue | null => useContext(PhotoUploadContext);

/** Test seam: the pieces the provider calls, so a browser test can run it without Blob or Firebase. */
export type PhotoUploadDeps = {
  getToken?: () => Promise<string>;
  uploader?: Uploader;
  attach?: (entryPath: string, fieldKey: string, result: UploadResult) => Promise<void>;
  queueOptions?: Parameters<typeof openUploadQueue>[0];
};

export function PhotoUploadProvider({ children, deps }: { children: ReactNode; deps?: PhotoUploadDeps }) {
  const { user, profile } = useAuth();
  const uid = user?.uid ?? "anonymous";
  const teamId = profile?.teamId ?? "team";
  const [queue, setQueue] = useState<UploadQueue | null>(null);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [online, setOnline] = useState(true);
  const depsRef = useRef(deps);
  useEffect(() => {
    depsRef.current = deps;
  });

  const getToken = useCallback(async () => {
    if (depsRef.current?.getToken) return depsRef.current.getToken();
    const u = auth.currentUser;
    if (!u) throw new Error("Not signed in.");
    return u.getIdToken();
  }, []);

  // the one function that uploads a queued photo (the test seam, else Vercel Blob)
  const uploadFn = useCallback<Uploader>((item) => (depsRef.current?.uploader ?? ((i: Parameters<Uploader>[0]) => uploadImageBlob({ blob: i.blob, path: i.path, clientPayload: i.clientPayload, getToken })))(item), [getToken]);

  // open the queue once
  useEffect(() => {
    let cancelled = false;
    openUploadQueue(depsRef.current?.queueOptions).then(({ queue: q }) => {
      if (!cancelled) setQueue(q);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!queue) return;
    const unsubscribe = queue.subscribe(setItems);
    const stop = startQueueProcessing(queue, uploadFn);
    return () => {
      unsubscribe();
      stop();
    };
  }, [queue, uploadFn]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // photos whose entry was saved before they finished: attach each to its entry when it is done
  useEffect(() => {
    if (!queue) return;
    const map = readAttach();
    const done = items.filter((i) => i.status === "done" && i.result && map[i.id]);
    if (done.length === 0) return;
    for (const item of done) {
      const target = map[item.id];
      const attach = depsRef.current?.attach ?? (async (path: string, key: string, result: UploadResult) => void (await updateDoc(doc(db, path), { [`values.${key}`]: arrayUnion(result), updatedAt: Date.now() })));
      attach(target.path, target.fieldKey, item.result!)
        .then(async () => {
          const latest = readAttach();
          delete latest[item.id];
          writeAttach(latest);
          await queue.remove(item.id);
        })
        .catch((err) => console.error("couldn't attach a finished photo to its entry:", err));
    }
  }, [items, queue]);

  const addPhoto = useCallback<PhotoUploadValue["addPhoto"]>(
    async (file, target, fieldRef) => {
      if (!queue) throw new Error("Photo uploads are still starting. Try again in a moment.");
      let blob: Blob = file;
      try {
        blob = await compressImage(file);
      } catch (err) {
        // A browser that can't decode it (HEIC, say): send the original if the server would take it.
        const original = err instanceof CompressError ? err.original : file;
        if (!isAllowedImageType(original.type) || original.size > MAX_IMAGE_BYTES) throw new Error("That photo couldn't be prepared. Try a JPEG or PNG under 6 MB.");
        blob = original;
      }
      if (blob.size > MAX_IMAGE_BYTES) throw new Error("That photo is too big even after shrinking it (6 MB limit).");
      const path = await buildBlobPath({ kind: target.kind, teamId, eventCode: target.eventCode, teamNumber: String(target.teamNumber), uid });
      const id = crypto.randomUUID();
      await queue.enqueue({ id, blob, path, fieldRef, clientPayload: JSON.stringify({ formId: target.formId, kind: target.kind, teamId, eventCode: target.eventCode, teamNumber: String(target.teamNumber) }) });
      // start uploading now (the queue also retries on its own when the network returns and on a timer)
      void queue.processAll(uploadFn);
      return id;
    },
    [queue, teamId, uid, uploadFn]
  );

  const value = useMemo<PhotoUploadValue>(
    () => ({
      ready: queue !== null,
      online,
      items,
      addPhoto,
      discard: async (id) => void (await queue?.remove(id)),
      retryNow: () => void queue?.processAll(uploadFn, { force: true }),
      deleteUploaded: (url) => (depsRef.current ? Promise.resolve() : deleteImageBlob(url, getToken)),
      attachWhenDone: (queueIds, entryPath, fieldKey) => {
        const map = readAttach();
        for (const id of queueIds) map[id] = { path: entryPath, fieldKey };
        writeAttach(map);
        // nudge the effect: items may already be done
        setItems((cur) => [...cur]);
      },
    }),
    [queue, online, items, addPhoto, getToken, uploadFn]
  );

  return <PhotoUploadContext.Provider value={value}>{children}</PhotoUploadContext.Provider>;
}
