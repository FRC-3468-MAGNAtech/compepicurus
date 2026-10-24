import { describe, expect, it } from "vitest";
import { computeRealEventEstimates, computeTeamAveragePrior, REAL_EVENT_ACCURACY_CONFIG } from "./real-event-accuracy";

describe("computeTeamAveragePrior", () => {
  it("falls back when there are no observations at all", () => {
    expect(computeTeamAveragePrior([])).toBe(REAL_EVENT_ACCURACY_CONFIG.FALLBACK_PRIOR);
  });

  it("is the plain mean of every observation's accuracy", () => {
    const prior = computeTeamAveragePrior([
      { scoutUid: "a", partnerUid: null, accuracy: 1.0 },
      { scoutUid: "b", partnerUid: null, accuracy: 0.5 },
    ]);
    expect(prior).toBeCloseTo(0.75, 10);
  });
});

describe("computeRealEventEstimates", () => {
  const teamAveragePrior = 0.8;

  it("weights an observation by its partner's own (pass-1, unweighted) estimate", () => {
    const observations = [
      { scoutUid: "a", partnerUid: "b", accuracy: 1.0 },
      { scoutUid: "b", partnerUid: "a", accuracy: 0.6 },
    ];
    const estimates = computeRealEventEstimates(observations, "plain", teamAveragePrior, new Map());
    expect(estimates.get("a")).toBeCloseTo(0.860465, 5);
    expect(estimates.get("b")).toBeCloseTo(0.736364, 5);
  });

  it("falls back to the team average prior for weighting when no partner is resolved", () => {
    const observations = [{ scoutUid: "c", partnerUid: null, accuracy: 0.9 }];
    const estimates = computeRealEventEstimates(observations, "plain", teamAveragePrior, new Map());
    // weight = 0.5 + 0.5*0.8 = 0.9; (2*0.8 + 0.9*0.9) / (2 + 0.9)
    expect(estimates.get("c")).toBeCloseTo(0.831034, 5);
  });

  it("uses a scout's own practice-mode prior (and a stronger K) for the trial/competitive variants", () => {
    const observations = [{ scoutUid: "d", partnerUid: null, accuracy: 0.5 }];
    const modePriors = new Map([["d", 0.95]]);
    const estimates = computeRealEventEstimates(observations, "trial", teamAveragePrior, modePriors);
    // weight = 0.9 (partner null -> team prior); (4*0.95 + 0.9*0.5) / (4 + 0.9)
    expect(estimates.get("d")).toBeCloseTo(0.867347, 5);
  });

  it("falls back to the plain prior for a mode variant when the scout has no practice-mode data", () => {
    const observations = [{ scoutUid: "e", partnerUid: null, accuracy: 0.6 }];
    const estimates = computeRealEventEstimates(observations, "competitive", teamAveragePrior, new Map());
    // weight = 0.9; (4*0.8 + 0.9*0.6) / (4 + 0.9)
    expect(estimates.get("e")).toBeCloseTo(0.763265, 5);
  });

  it("is per-scout — a scout's estimate only ever averages their own observations", () => {
    const observations = [
      { scoutUid: "f", partnerUid: null, accuracy: 1.0 },
      { scoutUid: "f", partnerUid: null, accuracy: 1.0 },
      { scoutUid: "g", partnerUid: null, accuracy: 0.0 },
    ];
    const estimates = computeRealEventEstimates(observations, "plain", teamAveragePrior, new Map());
    expect(estimates.get("f")!).toBeGreaterThan(estimates.get("g")!);
  });
});
