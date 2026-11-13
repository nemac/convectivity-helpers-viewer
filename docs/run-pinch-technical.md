# run-pinch.py: Technical Notes and References

Method documentation for the statewide pinch point score. Covers what the
script computes, which published methods each step corresponds to, why the
score is a product of two terms rather than either one alone, and what the
result does and does not support.

---

## 1. What the script measures

For every road segment in the state, the script asks two questions and
multiplies the answers:

1. **If this segment closed, how far out of their way would its users have to
   go?** The segment is removed from the routable network and the shortest
   remaining path between its own two endpoints is found. The extra distance
   over the segment's own length is the detour cost.
2. **How much traffic does the segment carry in the first place?** This comes
   from a demand-weighted betweenness score computed by
   `run-connectivity-buildings.py`.

```
pinch_score = detour_len_m x centrality_norm
```

A segment scores highly only when both terms are high. That is the whole point
of the measure, and section 2 explains why.

This places the script in the **road network vulnerability** literature, where
the standard move is to remove a link and measure the consequence. Berdica
(2002) frames the general problem; Jenelius, Petersen and Mattsson (2006) give
the canonical link-removal importance formulation, in which a link's importance
is the system-wide cost increase its removal causes, weighted by how much demand
actually uses it. The product above is that formulation reduced to its two
factors.

Measuring the consequence as an increase in travel cost rather than as a change
in a topological property follows Scott et al. (2006), whose Network Robustness
Index removes each link in turn and scores it by the resulting system-wide
travel cost.

---

## 2. Why a product, and not either term alone

Each factor on its own produces a well-known failure, and they fail in opposite
directions.

**Detour cost alone finds empty bridges.** A single-lane bridge over a creek on
a forest road has no alternative within miles, so its detour cost is enormous.
Almost nobody uses it. Ranked by detour cost alone it outranks an urban
interchange, which is not a useful answer for anyone deciding where to spend
money.

**Centrality alone finds substitutable arterials.** A downtown grid street can
carry a great deal of through traffic and still be trivially replaceable,
because the next parallel street is one block away and goes to the same places.
Ranked by centrality alone it looks critical. Close it and traffic shifts a
block over.

The condition worth finding is the conjunction: **heavily used and poorly
substituted**. Multiplying is the simplest operator with the property that a
near-zero on either factor drives the result to near zero, which is the
behaviour the question demands. Berdica (2002) makes the underlying point that
vulnerability is about serviceability rather than connectivity, and a network
can remain fully connected in the graph sense while functioning badly.

The cost of multiplying is that the score is on an uninterpretable scale: it is
metres times a unitless 0-1 weight. It ranks segments, and it is not a quantity
anyone can act on directly. Section 5 returns to this.

---

## 3. Method, step by step

### 3.1 Network construction

The graph is built from Overture Maps transportation segments, using Overture's
explicit `connectors[]` arrays as graph vertices. Two segments are adjacent if
and only if they share a connector ID. Edge weights are segment length in
metres, so the detour test is in distance rather than time.

The connector lists are read from the `connector_ids_json` column written by
`run-connectivity-buildings.py`, so the graph is rebuilt without re-querying
Overture.

### 3.2 The centrality term

`run-connectivity-buildings.py` computes a demand-weighted edge betweenness.
Ordinary betweenness treats every intersection as an equally likely trip end,
which is a poor model of where people actually start and finish. Instead, each
Overture building footprint is assigned to its nearest connector, and each
shortest path is weighted by the product of the building counts at its two
ends.

Weighting an interaction by the product of the activity at each end is the
gravity formulation that Hansen (1959) introduced to accessibility work. Here it
supplies trip weights rather than an accessibility surface, but the shape of the
assumption is the same: a path between two dense places represents more travel
than one between two empty places.

The accumulation is the edge variant of the Brandes (2001) betweenness
algorithm, with the per-vertex dependency seeded by building count rather than
by one. This is what makes a statewide run tractable, since it never
materialises the paths themselves.

Sources are a sample rather than every vertex. Section 5 covers what that costs.

### 3.3 The detour term

For each segment in turn:

1. Its edges' weights are set to infinity, which removes it from the network
   without rebuilding the graph.
2. A bounded Dijkstra runs from one endpoint, stopping once it passes
   `MAX_DETOUR_CHECK` (5 km by default).
3. The distance to the other endpoint, minus the segment's own length, is the
   detour cost.
4. The weights are restored.

The cutoff is what makes this affordable. Without it, every one of roughly 2.2
million queries would explore the whole reachable network. With it, each query
stops at a radius where the answer has already stopped being interesting.

When no alternative is found inside the cutoff, the segment receives a sentinel
value of twice the cutoff. This is an important property to understand when
reading the output: it is a floor, not a measurement. Every segment with no
alternative within 5 km receives the same number whether the real detour is 6 km
or 60 km, so the top of the detour range is deliberately flattened.

### 3.4 Parallel edges

Where two segments share the same pair of connectors, such as the two
carriageways of a divided highway, the sparse matrix keeps only the cheaper
one. Blocking the other is then a no-op, and it scores zero detour cost.

This is the correct answer to the question being asked. Closing one carriageway
of a divided highway does not force a detour, because the other carriageway is
still there. It is not a defect, but it does mean divided highways show up with
low pinch scores, and a reader expecting interstates to dominate the map should
know why they do not.

### 3.5 Dead ends are zeroed

Any segment with a degree-1 endpoint has its score set to zero after the fact.

Without this the map would be nothing but cul-de-sacs. A dead end has no
alternative path by definition, so it earns the maximum detour score every time.
But closing a cul-de-sac affects only the houses on it and has no network
consequence at all, which is the opposite of what the measure is for. Roughly
every residential dead end in the state would otherwise outrank every real
bottleneck.

The zeroing is a statement about scope: this measure is about the through
network, and a segment that carries no through traffic is out of scope rather
than unimportant.

---

## 4. Reading the output

| Column | Meaning |
|---|---|
| `detour_len_m` | Extra metres if the segment closes. `MAX_DETOUR_CHECK x 2` means no alternative was found within the cutoff. |
| `centrality_raw` | Demand-weighted betweenness, unscaled |
| `centrality_norm` | The same, scaled to 0-1. This is the term used in the product. |
| `centrality_log` | `log1p` of the raw score, for display when the raw values span orders of magnitude |
| `pinch_score` | `detour_len_m x centrality_norm` |
| `pinch_norm` | `pinch_score` over its maximum, 0-1 |
| `pinch_class` | Natural-breaks bin fitted on the non-zero scores |

The distribution is heavily concentrated at zero, since dead ends are zeroed and
most residential streets carry almost no weighted through traffic, with a long
tail. Classification on the raw values collapses to roughly two bins as a
result, which is why `run-reclassify.py` fits its breaks on the non-zero subset
only and offers log and geometric alternatives.

Treat the score as a **ranking**, not a measurement. "This segment is in the top
class" is supportable. "This segment is twice as critical as that one" is not,
because the units are arbitrary and the detour term saturates at the cutoff.

---

## 5. Limitations

**The detour cutoff truncates the top of the range.** Any segment without an
alternative inside 5 km is indistinguishable from any other such segment. In
rural western counties, where a real detour can run far longer, this compresses
exactly the segments most worth separating. Raising `MAX_DETOUR_CHECK` costs
roughly linearly in run time.

**The detour is measured endpoint to endpoint, not for the trips that used it.**
The test asks how far it is around the closed segment, not how much worse every
affected journey becomes. These diverge where a closure forces traffic onto a
route that is short in distance but already congested, or where the real cost
falls on trips that merely passed nearby. `run-detour.py` measures the
origin-to-destination version against named facilities.

**Distance, not time.** Edge weights are metres. A 3 km detour on an interstate
and a 3 km detour on a gravel road score identically.

**Centrality is computed from a sample of sources.** The betweenness scores are
estimates. Rankings near the top are stable; fine distinctions in the middle of
the distribution are not, and should not be read as meaningful.

**Buildings are a count, not a population.** A single-family home and an
apartment tower each count as one. The weighting reflects where structures are,
not how many people are in them.

**Divided highways score low**, for the structural reason in section 3.4.

**No turn restrictions, grades, or vehicle classes.** The network is undirected
and unrestricted, so some modelled detours are not legally drivable.

---

## 6. References

**Algorithms**

Brandes, U. (2001). A faster algorithm for betweenness centrality. *Journal of
Mathematical Sociology*, 25(2), 163-177.

Dijkstra, E. W. (1959). A note on two problems in connexion with graphs.
*Numerische Mathematik*, 1(1), 269-271.

Freeman, L. C. (1977). A set of measures of centrality based on betweenness.
*Sociometry*, 40(1), 35-41.

**Road network vulnerability and link criticality**

Berdica, K. (2002). An introduction to road vulnerability: what has been done,
is done and should be done. *Transport Policy*, 9(2), 117-127.

Jenelius, E., Petersen, T., & Mattsson, L. G. (2006). Importance and exposure
in road network vulnerability analysis. *Transportation Research Part A: Policy
and Practice*, 40(7), 537-560.

Scott, D. M., Novak, D. C., Aultman-Hall, L., & Guo, F. (2006). Network
Robustness Index: A new method for identifying critical links and evaluating the
performance of transportation networks. *Journal of Transport Geography*, 14(3),
215-227.

Taylor, M. A. P., Sekhar, S. V. C., & D'Este, G. M. (2006). Application of
accessibility based methods for vulnerability analysis of strategic road
networks. *Networks and Spatial Economics*, 6(3-4), 267-291.

**Demand weighting**

Hansen, W. G. (1959). How Accessibility Shapes Land Use. *Journal of the
American Institute of Planners*, 25(2), 73-76.

**Classification**

Jenks, G. F. (1967). The Data Model Concept in Statistical Mapping.
*International Yearbook of Cartography*, 7, 186-190.

**Data and software**

Overture Maps Foundation. Transportation theme (segment, connector) and
Buildings theme. https://overturemaps.org

Virtanen, P., et al. (2020). SciPy 1.0: fundamental algorithms for scientific
computing in Python. *Nature Methods*, 17, 261-272.

Csardi, G., & Nepusz, T. (2006). The igraph software package for complex network
research. *InterJournal, Complex Systems*, 1695.
