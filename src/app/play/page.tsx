"use client";

import dynamic from "next/dynamic";

// React Flow needs the DOM; skip SSR for the whole game screen.
const GameScreen = dynamic(() => import("@/components/GameScreen").then((m) => m.GameScreen), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center bg-ink-950 text-sm text-ink-400">
      Spinning up the war room…
    </div>
  ),
});

export default function PlayPage() {
  return <GameScreen />;
}
