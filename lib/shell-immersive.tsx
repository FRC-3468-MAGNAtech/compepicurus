"use client";

import { createContext, useContext, useMemo } from "react";

// P24: the app shell's "immersive" flag. The practice ScoutingWorkspace's Focus mode sets it to hide the sidebar and the mobile top bar, so the video can take the whole
// window; the shell (app/(app)/layout.tsx) owns the state and the workspace restores it when it leaves Focus mode or unmounts. Outside the shell it does nothing.

export type Immersive = { immersive: boolean; setImmersive: (value: boolean) => void };

const NOOP: Immersive = { immersive: false, setImmersive: () => {} };

export const ImmersiveContext = createContext<Immersive>(NOOP);

export const useImmersive = (): Immersive => useContext(ImmersiveContext);

export function useImmersiveValue(immersive: boolean, setImmersive: (value: boolean) => void): Immersive {
  return useMemo(() => ({ immersive, setImmersive }), [immersive, setImmersive]);
}
