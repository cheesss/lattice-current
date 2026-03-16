---
title: "2026-03: 制約付き自律性、現実反映リプレイ、shadow rollback"
summary: 投資アイデアが calibrated confidence、abstain/shadow 状態、現実コスト penalty、rollback-aware shadow control を持つようになりました。
status: stable
updated: 2026-03-16
owner: core
---

# 2026-03: 制約付き自律性、現実反映リプレイ、shadow rollback

投資スタックは、テーマや候補を増やすだけではなく、自分で制約も掛けるようになりました。

## 変更点

- ソース間の矛盾や rumor-heavy な表現が confidence を下げます
- 古い mapping prior は減衰し、現在のアイデアを支配しにくくなります
- recent-evidence floor が弱いと live deployment を止めます
- spread, slippage, liquidity, session-state penalty が replay summary に入ります
- idea card は `deploy`, `shadow`, `watch`, `abstain` のいずれかになります
- 最近の tracked performance が弱いと shadow rollback が自動で掛かります

## 反映箇所

- `Investment Workflow`
- `Backtest Lab`
- `docs/investment-usage-playbook.md`
- `docs/automation-runbook.md`

## 意味

このシステムは依然として無制限の auto-trader ではありません。

その代わり、以前よりも制約付き自律 research / decision stack に近づきました。
