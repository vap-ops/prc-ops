# Research note — gamification for field/construction workforce apps (2026-06-14)

Deep-research pass (23 sources, 25 claims adversarially verified → 20 confirmed,
5 killed) to inform a non-toxic "ผลงานของฉัน / My performance" feature in PRC Ops
Settings. **These are well-grounded heuristics, not construction-proven rules** —
most experimental evidence is from education / lab-savings / crowdsourcing /
retail-telemarketing; only the incentive-wear-off study is from real construction.

## What the evidence says

1. **Simple mechanics (points/levels/leaderboards) lift QUANTITY, not quality or
   intrinsic motivation.** Rewarding raw counts buys volume and invites gaming —
   no effect on quality. (Mekler et al. 2017; Zhang et al. 2021)
2. **Individual competitive leaderboards are the most-blamed harm.** They
   demotivate the majority who can't reach the top, crowd out intrinsic
   motivation at every rank, and one competitive design can't fit a whole crew
   (energizes some, demotivates others). (Almeida et al. 2023 systematic mapping;
   SHRM; Mendoza et al. 2023; IxDF)
3. **Leaderboards make TOP performers game the metric** — they keep the easy
   high-count action and drop the harder quality work to defend their rank.
   (Mendoza et al. 2023)
4. **Workplace gamification has a measured "dark side"** — can lower engagement +
   well-being; not safe-by-default. (Hammedi et al., J. Business Research 2021)
5. **It must be OPT-IN.** Imposed gamification → reactance, cheating, sabotage;
   willingness moderates the whole effect. (Hammedi et al. 2021)
6. **Real safety harm precedent:** Disneyland laundry "electronic whip" speed
   leaderboard → workers skipped bathroom breaks, injuries rose. Speed/volume
   metrics in physical work trade against safety. (SHRM / LA Times)
7. **Culture-dependent; Thai/SEA collectivist + kreng-jai (face) →** favor
   cooperative/team mechanics over individual competition; avoid shaming.
   (COGAM/Hofstede; cross-cultural corroboration)
8. **Disposition-dependent:** leaderboards only help the already-competitive /
   already-high-performers; can demotivate low-baseline workers → personalize/
   optional, not one uniform competitive default. (Zhang 2021; Bai et al. 2024)
9. **Gaming-the-system + cheating are top reported failure modes,** especially
   with competitive rewards or self-reportable status. (Almeida et al. 2023)
10. **Incentives wear off** (construction study, 342 vs 402 workers, 12mo): big
    one-time rewards fade in ~6 months → prefer frequent, small, evolving
    feedback, shorter intervals. (Ghasemi et al. 2015)

(Killed by verification: "leaderboards are fine in individualist orgs", "balanced
incentive+punishment is optimal", "points/levels don't harm intrinsic motivation"
— all failed the 2/3-refute vote.)

## Recommended non-toxic v1 for PRC Ops

**ผลงานของฉัน (My performance)** — under Settings → บัญชี:

- **OPT-IN + PRIVATE by default** (per #5). Not surfaced/forced.
- **RATE-based metrics the app already computes** (per #1, fairness across uneven
  workloads): on-time completion rate (vs planned_start/planned_end), photo-
  evidence completeness per WP, responsiveness/turnaround. **Never raw counts.**
- **Personal progress + self-relative trends + gentle streaks** (per #8), NOT
  individual ranking.
- **Optional team-aggregate goal** (per #7) — e.g. "ทีมเราตรงเวลา 82%", no
  individual is identifiable.
- **Frequent small evolving feedback**, not big static rewards (per #10).

**Explicitly AVOID:**

- Public individual leaderboards / top-N boards (#2, #3, #8).
- Rewarding a self-reportable "completed" status the worker controls → gate on
  PM approval, which PRC Ops already has (#9).
- Any speed/volume metric that could trade against safety or evidence quality
  (#6) — the electronic-whip failure.
- Large static one-time rewards (#10).

## Open questions before/while building

- **Domain transfer** unproven for Thai construction crews → validate with a
  small in-app pilot of the opt-in rate view.
- **Face/shaming UI specifics** — even a private self-relative view must not let
  a PM or peers single out an underperformer.
- **Fair rate normalization** across WP size/difficulty (critical vs not,
  priority-flagged vs not) so the metric isn't gameable by cherry-picking easy
  WPs. No construction-specific scheme in the literature.

Full machine output (findings + sources + verification votes) archived from the
deep-research run on 2026-06-14.
