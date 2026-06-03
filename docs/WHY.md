# Why Lattice exists

Generating an AI research report is easy. Every model can produce a confident-looking memo with a thesis, a target, and a clean "buy / avoid" lean. The report reads the same whether the evidence under it is solid or nearly absent — the confidence is in the formatting, not in the data. A tool that writes *well* is more dangerous, not less, because a weak idea in good prose is the easiest kind to believe.

I built Lattice to invert that. I wanted a research system that is most useful exactly when the evidence is thin — one whose default answer is **"not ready,"** loud and specific, and that refuses to promote a thesis until the evidence actually closes.

## The discipline it encodes

Lattice is an attempt to externalize one specific way of looking at structural-growth themes into a repeatable system.

The shortcut it is deliberately *not* interested in:

> AI demand is up → buy the obvious AI name.
> Grid capex is rising → buy the obvious utility / equipment name.
> Advanced packaging is constrained → buy the obvious foundry.

Those are correct sentences. They are also already priced in by the time they are obvious. The interesting question is one layer down — the **hidden bottleneck** beneath the theme, and who actually owns it:

> AI data-center growth → grid **interconnection queue** → interconnection-study capacity → substation automation / protection relays / EPC bottleneck → *who actually gets the backlog and the pricing power?*
>
> Advanced packaging → not CoWoS / HBM headlines, but **ABF substrate, probe cards, test sockets, underfill, warpage control**.
>
> Rising defense budgets → not the prime contractor, but **solid-rocket-motor capacity, energetic materials, test facilities**.

A good idea, in this view, is not a good *industry*. It is a narrow node where supply is scarce, substitution is hard, demand converts into backlog and margin, the issuer is identifiable, and the market has not fully repriced it yet.

## Aggressive exploration, conservative promotion

Finding those nodes requires **exploration** — connecting distant themes, chasing unfamiliar suppliers, following provider gaps into corners nobody is writing about. But exploration sits right next to nonsense. So Lattice pairs wide exploration with a deliberately **conservative promotion gate**: a thesis stays `BLOCKED` until issuer exposure, a negative control, holdout confirmation, controlled market validation, independent source breadth, and a valuation bridge all close — and even then a human, not the system, promotes it.

That tension — **explore widely, promote strictly** — is the whole design.

## What I was actually trying to avoid

- Buying a theme the market already understood, late.
- Being convinced by a well-written report whose evidence was thin.
- Letting research seeds pile up wherever the news volume was loudest.
- Mistaking a data-coverage gap for a real signal.
- Treating "the t-stat is high" as truth when it might be an overfit or a repeated event.

So the system keeps adding ways to **stop itself**, not ways to sound smarter. The goal was never to build an AI that writes a convincing story. It was to build one that knows when to **stop an unconvincing one** — and that runs that judgment tirelessly, and more strictly than I would by hand.

That is why "not ready" is a first-class output here. It is the part most tools skip, and it is the part I actually care about.

---

*Lattice is research automation, not investment advice. See the [evidence-gate architecture](ARCHITECTURE.md) for how the gates are wired, and the "What this is NOT" section of the [README](../README.md) for the boundaries.*
