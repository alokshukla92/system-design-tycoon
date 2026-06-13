import type { InterviewDef } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Architecture Interview mode: a FAANG-style prompt, a blank canvas, and a
// stress-test rubric. The engine simulates the design at increasing traffic
// tiers and grades it like an interviewer would.
// ─────────────────────────────────────────────────────────────────────────────

export const INTERVIEWS: InterviewDef[] = [
  {
    id: "iv-twitter",
    title: "Design Twitter",
    prompt: [
      "Design a Twitter-like social feed service.",
      "Users post tweets (writes), and read home timelines composed of accounts they follow (reads dominate, ~50:1).",
      "A small set of celebrity accounts have tens of millions of followers — their tweets fan out everywhere and their profiles are read constantly.",
    ],
    requirements: [
      "Timeline reads must feel instant (p95 under 250ms)",
      "Survive a celebrity tweet going viral (hot key)",
      "No single point of failure",
      "Search across tweets",
    ],
    workload: {
      rpsPerKUsers: 18, readRatio: 0.95, staticRatio: 0.25, searchRatio: 0.06,
      storageGbPerDayPer10k: 10, peakMult: 2.2, skew: 0.8, needsStrongConsistency: false,
    },
    tiers: [
      { users: 100_000, label: "Seed: 100k users" },
      { users: 2_000_000, label: "Growth: 2M users" },
      { users: 20_000_000, label: "Scale: 20M users" },
    ],
    slo: { maxP95Ms: 250, minAvailabilityPct: 99.9, maxErrorRate: 0.01, maxMonthlyBudget: 90_000 },
  },
  {
    id: "iv-whatsapp",
    title: "Design WhatsApp",
    prompt: [
      "Design a messaging service.",
      "Users send messages (write-heavy!), read conversations, and create groups. Messages must not be lost — ever.",
      "Traffic is extremely bursty: New Year's midnight produces 10× normal volume in minutes.",
    ],
    requirements: [
      "Message delivery must survive traffic bursts without loss",
      "Send acknowledgment under 350ms even at peak",
      "A crashed server must not lose accepted messages",
      "No duplicate message delivery to recipients",
    ],
    workload: {
      rpsPerKUsers: 30, readRatio: 0.55, staticRatio: 0.05, searchRatio: 0.01,
      storageGbPerDayPer10k: 15, peakMult: 3, skew: 0.45, needsStrongConsistency: false,
    },
    tiers: [
      { users: 500_000, label: "Seed: 500k users" },
      { users: 5_000_000, label: "Growth: 5M users" },
      { users: 50_000_000, label: "Scale: 50M users" },
    ],
    slo: { maxP95Ms: 350, minAvailabilityPct: 99.9, maxErrorRate: 0.008, maxMonthlyBudget: 150_000 },
  },
  {
    id: "iv-youtube",
    title: "Design YouTube",
    prompt: [
      "Design a video platform.",
      "Uploads are heavy but rare; views are everything — 98% reads, mostly of a small set of trending videos, from every country on Earth.",
      "Video bytes are static; metadata (views, likes, comments) is hot and dynamic.",
    ],
    requirements: [
      "Video start latency under 200ms globally",
      "Trending-video traffic must not melt the origin",
      "View counts can lag slightly; uploads must not be lost",
      "Search across videos",
    ],
    workload: {
      rpsPerKUsers: 22, readRatio: 0.98, staticRatio: 0.88, searchRatio: 0.04,
      storageGbPerDayPer10k: 40, peakMult: 2.5, skew: 0.75, needsStrongConsistency: false,
    },
    tiers: [
      { users: 1_000_000, label: "Seed: 1M users" },
      { users: 10_000_000, label: "Growth: 10M users" },
      { users: 80_000_000, label: "Scale: 80M users" },
    ],
    slo: { maxP95Ms: 200, minAvailabilityPct: 99.9, maxErrorRate: 0.008, maxMonthlyBudget: 200_000 },
  },
];

export function interviewById(id: string): InterviewDef | undefined {
  return INTERVIEWS.find((i) => i.id === id);
}
