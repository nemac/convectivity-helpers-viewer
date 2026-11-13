# run-detour.py: Technical Notes and References

Method documentation for the per-segment origin-to-destination impact score.
Covers what the script computes, which published methods each step corresponds
to, where the implementation deliberately departs from standard formulations,
and what those departures mean when reading the output.

---

## 1. What the script measures

For every road segment in a study area, the script asks: if this segment were
removed from the network, how much worse does travel get from a set of origins
to a set of destinations?

Origins are intersections on arterial-class roads. Destinations are supplied
points such as fire stations, hospitals, schools, or food retail. The output is
a per-segment score describing how much that segment's removal degrades access
to those destinations.

This places the script in the **road network vulnerability** literature, where
the standard approach is exactly this: remove a link, recompute shortest paths,
and measure the consequence. Berdica (2002) frames the general problem;
Jenelius, Petersen and Mattsson (2006) give the canonical link-removal
importance formulation.

Because the consequence here is measured as degraded access to a named
destination set rather than as a change in a purely topological property, the
measure belongs specifically to the accessibility-based branch of that
literature set out by Taylor, Sekhar and D'Este (2006).

---

## 2. Method, step by step

### 2.1 Network construction

The graph is built from Overture Maps transportation segments, using Overture's
explicit `connectors[]` arrays as graph vertices. Two segments are adjacent if
and only if they share a connector ID.

This avoids the standard failure mode of coordinate-matching topology, where
service roads and minor streets whose endpoint coordinates differ by a few
centimetres get split into separate components, while bridges and tunnels that
cross in plan view get incorrectly joined. Overture's connector model encodes
the intended topology directly.

### 2.2 Edge weights: drive time, not distance

Each segment's traversal cost is free-flow drive time in seconds:

```
travel_time_sec = segment_length_m / (assumed_speed_mph * 0.44704)
```

`assumed_speed_mph` comes from Overture's `speed_limits[].max_speed` where
present, otherwise a per-class default (motorway 65, trunk 55, primary 45,
secondary 40, tertiary 35, unclassified 30, residential 25, living_street 15,
service 15).

Every "shortest path" in the implementation is therefore a **fastest path by
free-flow drive time**. No congestion, no turn penalties, no signal delay. See
section 5 for what that excludes.

### 2.3 Shortest path computation

Bounded Dijkstra (Dijkstra 1959) on a SciPy compressed sparse row adjacency
matrix, via `scipy.sparse.csgraph.dijkstra`. The `limit` parameter truncates
the search once accumulated cost exceeds the cutoff, so the frontier never
expands past the horizon of interest.

Parallel edges between the same vertex pair are deduplicated by minimum weight
when the CSR is assembled, so duplicate geometry in the source data does not
sum into an inflated traversal cost.

### 2.4 Destination catchment and the rural fallback

Destinations enter the calculation only if they are reachable from an origin
within `--search-limit-min` (default 15 minutes). This bounds the number of
origin-destination pairs, which otherwise grows as the product of origin and
destination counts.

An origin that finds no destination inside that limit retries at
`--rural-fallback-min` (default 30 minutes) and keeps its single nearest
destination. This guarantees every origin contributes at least one
origin-destination pair, so sparsely served rural areas are not silently
dropped from the analysis. This is a coverage decision specific to this
implementation, not a convention drawn from the literature.

The time limit alone does not bound the pair count in a dense urban county,
where a single origin can reach several hundred destinations inside 15
minutes. Because the per-pair cost is itself K paths multiplied by the number
of segments on each path, the pair count is what determines whether a run is
tractable. `--max-dest-per-origin N` keeps only the N nearest destinations per
origin, dropping the farthest first, and is unset by default.

Capping the catchment this way narrows the question from "can this origin still
reach any of its reachable destinations" to "can it still reach the N closest
ones", which is the closer analogue of a competing-destinations accessibility
measure (Fotheringham 1983) than of an unweighted cumulative-opportunity one
(Handy and Niemeier 1997). Because the per-segment scores are sums over
origin-destination pairs, the magnitude of a score depends on this setting:
runs made with different caps are not comparable on raw totals, and any
cross-area comparison must hold the cap fixed.

### 2.5 K fastest paths per origin-destination pair

For each origin-destination pair the script finds up to K loopless fastest
paths using Yen's algorithm (Yen 1971), implemented over the same CSR by
masking edge weights in place and re-running the bounded Dijkstra for each spur
node.

The purpose of K is to identify which segments are worth testing. A segment
carried by two of the three fastest routes between a given pair participates in
that pair's accessibility in a way a segment on only the third route does not.

### 2.6 Link removal and scoring

For each path, with that path's own drive time as the baseline, every segment
on the path is tested in turn:

1. Set the segment's edge weights to infinity, which removes it from the
   routable network.
2. Re-run the bounded Dijkstra from origin to destination.
3. Compare the new fastest time against that path's baseline time.
4. Restore the segment's weights.

This is the standard link-removal procedure from Jenelius et al. (2006) and
from the Network Robustness Index of Scott, Novak, Aultman-Hall and Guo (2006).
Both compute a link's importance as the increase in generalized travel cost
across a demand set when that link is unavailable.

### 2.7 The threshold-crossing score

Where this implementation differs from the literature is in how the increase is
converted to a score. Rather than reporting the raw travel-time delta alone, the
primary score counts **service-threshold crossings**:

```
for each threshold X in --breaks-min:
    if baseline <= X and post_removal > X:
        score += 1
```

With the default thresholds of 3, 5, 8, 15, 30 and 60 minutes, a trip that was
4 minutes and becomes 12 minutes crosses the 5-minute and 8-minute marks,
scoring 2. A trip already past every threshold before the removal cannot cross
any and scores 0 regardless of how much worse it gets.

The rationale is that emergency service accessibility is conventionally assessed
against discrete response-time standards rather than as a continuous quantity.
NFPA 1710 specifies a 240-second travel-time objective for the first-arriving
engine company in career departments, and NFPA 1720 sets staffing and response
objectives by demand-zone population density for volunteer departments. A
removal that pushes a trip from inside a standard to outside it has a different
operational meaning than one that merely adds time to an already-long trip.

Counting crossings of fixed time thresholds places this score in the
cumulative-opportunity family of accessibility measures reviewed by Handy and
Niemeier (1997) and Geurs and van Wee (2004), applied to service standards
rather than to opportunity counts. The trade-off that review identifies applies
here too: a threshold measure is insensitive to change that does not cross a
boundary, and sensitive to rearrangement that happens to straddle one.

The raw continuous measure is retained alongside it as `total_extra_sec`, which
is the direct analogue of the Jenelius et al. importance measure. Readers who
want the conventional formulation should use that column.

### 2.8 Endpoint exclusion zones

`--skip-origin-sec` and `--skip-dest-sec` (default 30 seconds each) exclude
segments lying entirely within that many seconds of travel from either end of a
path.

Without this, the arterial segment the origin sits on and the driveway or
access road at the destination score highest on every path through them, simply
because every route must traverse them. Those segments are real single points
of failure, but they are trivially identifiable and they crowd out the interior
network structure the analysis exists to surface. The exclusion is a
presentation decision, and it does mean the output understates the criticality
of immediate approach segments.

---

## 3. Output columns and their interpretation

| Column | Meaning |
|---|---|
| `detour_band_score` | Total threshold crossings, summed across every scored (origin, destination, path) combination |
| `detour_band_score_per_od` | The above divided by `affected_od_count`, bounded by the number of thresholds |
| `affected_od_count` | How many (origin, destination, path) combinations included this segment |
| `newly_disconnected_od_count` | How many of those became unreachable entirely when the segment was removed |
| `lost_within_<X>min` | Per-threshold breakdown of the crossing count |
| `total_extra_sec` | Sum of `post_removal - baseline` in seconds. The continuous importance measure. |

Disconnections are counted separately and **excluded from the crossing score**.
A cul-de-sac segment disconnects every trip that uses it, which would otherwise
dominate the ranking while telling you only that dead ends are dead ends. The
design choice is to let segments with finite but severe detours rank highest and
to report total disconnection as its own column.

All of these columns are written as raw continuous or count values. Binning for
cartographic display is a separate step, handled by `run-reclassify.py`. Because
the score distribution is zero-heavy, with most segments never appearing on any
scored path, breaks fitted to the full distribution collapse to two effective
bins; the reclassify step fits them on the non-zero subset instead.

---

## 4. Deliberate deviations from standard formulations

These are design choices, not oversights. Each has a consequence for how the
numbers should be read.

**Per-path accumulation without deduplication.** A segment appearing on two of
the K paths for the same origin-destination pair is scored twice for that pair.
Standard importance measures evaluate each origin-destination pair once. The
effect is to weight segments by how many of the viable routes depend on them,
which is informative for redundancy but means the absolute values are not
comparable to a published importance index.

**Unweighted demand.** Jenelius et al. (2006) weight link importance by
origin-destination flow volume. This implementation treats every
origin-destination pair as equally important, because no flow data is attached.
Segments serving many low-demand pairs therefore rank alongside segments serving
few high-demand ones. Census LEHD origin-destination employment statistics would
be the obvious source for a demand-weighted variant.

**Free-flow travel times.** No congestion, turn delay, or signal timing. Removal
impacts are therefore lower bounds in congested networks, where rerouted traffic
would degrade alternative paths further.

**Single-link removal only.** Each segment is tested in isolation. Correlated
failures, where a flood or earthquake takes out many links at once, are not
captured. The hazard polygon mode (`-z / --hazard`) is the partial answer:
it removes all in-hazard segments before scoring, so the remaining network is
evaluated under that scenario.

**Arterial-only origins.** Origins are drawn from `--origin-classes` (default
`primary,secondary`). The analysis therefore measures arterial-to-destination
access, not door-to-destination access from every residence.

---

## 5. Known limitations

- Free-flow speeds from posted limits and class defaults, not observed travel times.
- No turn restrictions, one-way handling, or intersection delay.
- Destination catchment is a drive-time cutoff, so destinations just outside it
  contribute nothing even when they are the relevant facility for a marginal case.
- Threshold crossings are insensitive to magnitude beyond the last threshold.
  Pair with `total_extra_sec` when ranking severe cases.
- Scores accumulate across paths, so absolute values are not comparable between
  runs with different K.
- Overture segment granularity varies. A long rural segment and a short urban
  block are each one removal test, so per-segment scores are not normalized by
  length.

---

## 6. References

**Algorithms**

Dijkstra, E. W. (1959). A note on two problems in connexion with graphs.
*Numerische Mathematik*, 1(1), 269-271.

Yen, J. Y. (1971). Finding the K Shortest Loopless Paths in a Network.
*Management Science*, 17(11), 712-716.

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

**Accessibility measurement**

Fotheringham, A. S. (1983). A new set of spatial-interaction models: the theory
of competing destinations. *Environment and Planning A*, 15(1), 15-36.

Geurs, K. T., & van Wee, B. (2004). Accessibility evaluation of land-use and
transport strategies: review and research directions. *Journal of Transport
Geography*, 12(2), 127-140.

Handy, S. L., & Niemeier, D. A. (1997). Measuring accessibility: an exploration
of issues and alternatives. *Environment and Planning A*, 29(7), 1175-1194.

**Service standards**

National Fire Protection Association. *NFPA 1710: Standard for the Organization
and Deployment of Fire Suppression Operations, Emergency Medical Operations, and
Special Operations to the Public by Career Fire Departments.*

National Fire Protection Association. *NFPA 1720: Standard for the Organization
and Deployment of Fire Suppression Operations, Emergency Medical Operations, and
Special Operations to the Public by Volunteer Fire Departments.*

**Classification**

Jenks, G. F. (1967). The Data Model Concept in Statistical Mapping.
*International Yearbook of Cartography*, 7, 186-190.

**Data and software**

Overture Maps Foundation. Transportation theme, segment and connector types.
https://overturemaps.org

Virtanen, P., et al. (2020). SciPy 1.0: fundamental algorithms for scientific
computing in Python. *Nature Methods*, 17, 261-272.

Csardi, G., & Nepusz, T. (2006). The igraph software package for complex network
research. *InterJournal, Complex Systems*, 1695.
