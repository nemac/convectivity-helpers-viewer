# run-functional-isolation.py: Technical Notes and References

Method documentation for the multi-cutoff building-reach measure. Covers what
the script computes, which published accessibility methods it corresponds to,
why nearest-facility measures fail to detect functional isolation, and the
limitations of the approach.

---

## 1. What the script measures

For every road segment, the script counts how many building footprints are
reachable within each of several drive-time cutoffs, before and after a hazard.
The headline output is the fractional loss at each cutoff:

```
loss_<C>m = 1 - (buildings reachable within C minutes after the hazard)
                / (buildings reachable within C minutes before)
```

This is a **cumulative opportunity accessibility measure**, the oldest and most
widely used family of accessibility metrics. Hansen (1959) introduced
accessibility as a formal planning concept; the cumulative opportunity form
counts how many opportunities fall within a travel-cost threshold. Handy and
Niemeier (1997) and Geurs and van Wee (2004) review the family and its
trade-offs against gravity and utility-based alternatives.

The script applies that measure twice, once per network state, and reports the
difference.

---

## 2. The problem this measure exists to solve

Most road-network impact metrics ask "how far is the nearest facility?" That
question has a structural blind spot.

Consider a river with one bridge. North of the bridge is a town with its own
clinic, grocery store, and fire station. South is another town with the same.
The bridge floods.

A nearest-facility metric reports almost no change. Every address on the north
side still has its nearest clinic a few minutes away. Every address on the south
side likewise. Measured against nearest facilities, nothing happened.

What actually happened is that two communities lost access to each other, and
to everything on the far side, except by a multi-hour detour. The nearest-facility
framing cannot see it, because each location independently selects its own
nearest opportunity and that selection did not change.

Counting **all** reachable opportunities rather than the distance to the closest
one is what makes the loss visible. A location north of the bridge might go from
45,000 reachable buildings to 3,000. That is a 93% loss even though its nearest
clinic never moved.

This distinction has a name in the literature. Taylor, Sekhar and D'Este (2006)
set out accessibility-based vulnerability analysis specifically because
topological and nearest-facility measures miss degradation of this kind. Berdica
(2002) makes the related point that vulnerability is about serviceability, not
merely connectivity: a network can remain fully connected in the graph sense
while ceasing to function.

The underlying operation, removing links and measuring the consequence across a
demand set, is the importance-and-exposure formulation of Jenelius, Petersen and
Mattsson (2006). Two things differ here. The demand set is every building rather
than a set of named origin-destination pairs, and the removal is a hazard
footprint covering many links at once rather than a single link in isolation.

---

## 3. Method, step by step

### 3.1 Network construction and edge weights

Identical to `run-detour.py`. The graph is built from Overture connector IDs, so
two segments are adjacent only if they share a connector. Edge weights are
free-flow drive time derived from `speed_limits[].max_speed` where present and
per-class defaults otherwise. See the detour technical notes for details.

One difference: a posted speed that no road of its class could carry in North
Carolina is treated as a data error and replaced with the class default, just as
a missing one is. Overture has a few such values, such as a service road at
80 mph, an unnamed road at 100 mph, an interstate at 10 mph and residential
streets at 5 mph, and each one turns a road into a shortcut or a wall for every
route near it. The ranges are `PLAUSIBLE_SPEED_MPH_BY_CLASS` in the script (for
example 25 to 70 mph for an interstate, 10 to 55 for a residential street, 5 to
35 for a service road). Across the Haywood and Mecklenburg study areas they
replaced 36 of about 19,900 posted speeds. `max_speed_mph` in the output keeps
the posted value; `assumed_speed_mph` is what the routing used.

### 3.2 Opportunities: building footprints

Overture building footprints are the opportunity set. Each building is reduced to
its centroid and snapped to the network. In the terms of the
cumulative-opportunity literature, footprints are the opportunities whose count
within a travel-cost threshold constitutes the measure (Hansen 1959).

Buildings are a deliberately generic proxy for "places where people are or go."
A house, a factory, a church, a clinic and a shop are all buildings. Using them
avoids pre-deciding which destination types count, which a named-facility list
would require. The cost is that a single-family home and a thirty-story tower
count the same, so the measure is a count of destinations rather than of people
or of activity. Section 5 covers what this excludes.

### 3.3 Two-step snapping

Each building centroid is matched to the network in two steps:

1. Find the nearest road **segment** (a LineString) using an STRtree spatial index.
2. Of that segment's endpoint connectors, pick whichever is closer to the centroid.

Snapping directly to the nearest connector in one step is wrong, and the error is
not rare. A building beside the middle of a long segment can be closer to a
connector belonging to a different road than to either endpoint of the road it
actually fronts. Selecting the correct segment first and only then choosing
between that segment's own endpoints avoids attaching buildings to roads they
have no access to.

The snap is computed **once**, before any route search, and the same
building-to-connector assignment is used for both the baseline and the hazard
pass. Buildings do not move during a flood; only the network changes. Re-snapping
between passes would break the comparison.

### 3.4 Route search and cumulative banding

One bounded Dijkstra per unique segment-endpoint connector, run out to the
largest cutoff. Each segment inherits the result of one of its endpoints, which
halves the number of searches relative to evaluating both ends. This is the same
dedup convention `run-reach.py` uses.

Every connector reached within the horizon carries a precomputed building count.
Reached connectors are bucketed by their drive time into the cutoff bands, and
the building counts are summed. Bands are **cumulative**: a connector reached in
4 minutes contributes to the 5, 15, 30, 60 and 240 minute totals alike.

### 3.5 Hazard pass and the loss fraction

Segments intersecting the hazard polygon are topologically split at the boundary,
so a long road grazing a flood loses only its inundated stretch rather than its
whole length. In-hazard sub-pieces have their edge weights set to infinity.

A side street that joins a split road partway is counted with the piece of road
it meets. If that piece is flooded and the side street has no other way out,
the side street is cut off too; if it meets a dry piece, it is measured like
any other road. An earlier version lost these side streets when it split the
road, so they looked separated from every road even before the hazard. The
analysis then never counted them as cut off by it, and the map drew them as
unaffected: 372 roads within 1.5 km of the nine hazards. Where a side street
meets the road is read from Overture's `connector_ats`.

The same per-connector search runs again on that network. The loss fraction per
cutoff follows directly.

### 3.6 A monotonicity guarantee

Hazard edge weights are pointwise greater than or equal to baseline weights,
since blocked edges go to infinity and everything else is unchanged. Dijkstra is
monotone in edge weights, so for every connector pair:

```
baseline_time <= hazard_time
```

The set of connectors reachable within any cutoff after the hazard is therefore a
subset of the set reachable before, and `hazard_count <= baseline_count` holds as
an exact integer inequality at every cutoff. Loss is never negative by
construction. The implementation asserts this rather than clipping, so a
violation surfaces as a bug instead of being silently masked.

---

## 4. Why multiple cutoffs rather than one

A single threshold cannot distinguish the cases that matter most. Sensitivity to
the choice of cutoff is the standing criticism of cumulative-opportunity
measures, raised by Handy and Niemeier (1997) and by Geurs and van Wee (2004) as
the principal cost of the family's simplicity. Reporting several cutoffs is the
response adopted here.

Consider a location whose 5-minute reach is unchanged, whose 30-minute reach
collapses by 95%, and whose 240-minute reach recovers to within 40% of baseline.
That is a community whose immediate neighborhood still functions, whose regional
access is gone, and which can still reach the wider region given hours rather
than minutes. That is the signature of functional isolation, and it is only
visible as a **shape across cutoffs**.

Contrast a location where every cutoff including 240 minutes collapses. That is
genuine severance, a different operational problem with a different response.

And contrast one where all cutoffs move by a few percent. That is minor
inconvenience.

The defaults of 5, 15, 30, 60 and 240 minutes span emergency-response windows at
the short end through regional access at the long end. Short cutoffs are
deliberately included because they are where local connectivity shows up as
preserved, which is half of the functional-isolation signature.

Deciding what counts as functionally isolated requires choosing a threshold on
these fractions, and the script does not choose one. No categorical label is
emitted. Collapsing a multi-dimensional profile into a single class is exactly
the reduction that makes the condition invisible, so the raw fractions are
written and the interpretation is left to the reader.

---

## 5. Limitations

**Buildings are a count, not a population or an activity weight.** All footprints
count equally. Census block population or LEHD employment counts would give a
demand-weighted variant, at the cost of coarser spatial resolution and a
restriction to commute or residence rather than all trip purposes.

**Generic destinations.** The measure answers "how much of the built environment
can this road still reach," not "can this road still reach the specific places
its residents need." A segment that loses half its reachable buildings may have
lost warehouses it never used, or the only hospital it relied on. Pair with
`run-detour.py` against named facility points when the question concerns a
specific service.

**Free-flow travel times.** No congestion, turn delay, or signal timing. Losses
are lower bounds in congested networks.

**Cutoff-boundary sensitivity.** A building that moves from 28 minutes to 32
minutes exits the 30-minute band entirely. The multi-cutoff design mitigates this
by reporting several bands, but any single band's fraction is sensitive to
rearrangement near its boundary. This is the threshold sensitivity Handy and
Niemeier (1997) identify as inherent to the cumulative-opportunity form; a
gravity or utility-based measure trades it for a different set of assumptions
(Geurs and van Wee 2004).

**Single-endpoint inheritance.** Each segment takes the result of one endpoint.
For short segments the error is negligible, since half the segment's traversal
time is small relative to the smallest cutoff. For long rural segments it is not,
and the midpoint of such a segment may have materially different reach than
either end.

**No elevation, grade, or vehicle class.** Speeds are posted limits or class
defaults.

**Snap radius.** Buildings farther than the snap limit from any road are dropped.
Rural footprints set well back from a road can fall out.

---

## 6. Reading the output

| Column | Meaning |
|---|---|
| `bld_<C>m_baseline` | Buildings reachable within C minutes on the intact network |
| `bld_<C>m_hazard` | Same on the post-hazard network |
| `loss_<C>m` | `1 - hazard/baseline`. Zero means unchanged, one means total loss at that cutoff. |
| `lost_<C>m` | `baseline - hazard`, the number of buildings that drop out of reach |
| `loss_<C>m_<method>_class` | 1 to 10 classes on `loss_<C>m`, for `geometric`, `log10` and `quantile` |
| `dist_to_hazard_m` | Straight-line distance from the segment to the hazard polygon |
| `is_blocked` | Segment sub-piece lies inside the hazard polygon |

The distribution of `loss_<C>m` is heavily concentrated at zero, since most
segments in a county are unaffected by any given hazard, with a long tail toward
one. Quantile classification on the raw values collapses to roughly two bins as a
result. The class columns are therefore fitted on the non-zero subset only, with
every zero in class 1, by the same code `run-reclassify.py` and
`run-detour-combine.py` use. `log10` means natural breaks on `log10(1 + x)`.

---

## 7. Hazard buffer mode

### 7.1 What changes

With `--hazard-buffer-miles R` the study area is the hazard polygon buffered by
R miles instead of a county. Roads and buildings are downloaded for that area
alone, from the latest Overture release, on every run. Nothing downloaded is
kept or reused, so two runs a month apart can differ if Overture has changed in
between; the release used is recorded in the output's `study_area` layer.

Everything else is unchanged: the same snap, the same two passes and the same
loss fraction. `run-functional-isolation-hazards.sh` runs every hazard polygon
this way and then writes the style files.

### 7.2 How far the buffer has to reach

The buffer is set by the longest drive-time cutoff, not by the size of the
hazard. A road can lose reach at a cutoff of C minutes only if some blocked
road lies within C minutes' drive of it. If none does, every route of C
minutes or less from that road avoids the hazard, so the routes are the same
before and after, and the count cannot change (section 3.6 gives the same
argument for why loss is never negative). The area where `loss_<C>m` can be
anything but zero is therefore exactly the area within a C-minute drive of the
hazard, and the buffer has to cover it.

That reach was measured for each of the nine hazards with one route search
outward from the blocked roads, on roads downloaded for 45 miles around each.
Straight-line miles from the hazard to the farthest road a drive of that length
gets to:

| Hazard | Roads blocked | 5 min | 10 min | 15 min | 30 min |
|---|---|---|---|---|---|
| Haywood: debris flow onto US 276, Cruso | 4 | 3.2 | 6.4 | 10.1 | 18.5 |
| Haywood: landslide on I-40, Pigeon River gorge | 2 | 2.6 | 7.3 | 10.3 | 26.6 |
| Haywood: flooding in Canton | 20 | 3.5 | 7.6 | 12.1 | 26.2 |
| Mecklenburg: Little Sugar Creek | 1 | 2.6 | 5.9 | 10.4 | 26.5 |
| Mecklenburg: Mallard and Doby Creek | 134 | 4.2 | 9.0 | 13.6 | 30.0 |
| Mecklenburg: McMullen Creek | 15 | 2.6 | 6.5 | 11.6 | 28.0 |
| New Hanover: Burnt Mill Creek | 252 | 3.6 | 7.9 | 12.8 | 25.8 |
| New Hanover: Northchase | 33 | 3.9 | 10.0 | 14.5 | 32.9 |
| New Hanover: Pages Creek | 275 | 3.4 | 7.8 | 12.4 | 29.1 |

"Roads blocked" counts road pieces inside the polygon after splitting.

The default is **cutoffs of 5, 10, 15 and 30 minutes with a 30 mile buffer**.
The runs first used 5, 10 and 15 minutes on 20 miles: the widest 15-minute
reach is 14.5 miles, and section 7.4 shows 20 and 30 miles giving the same
15-minute answers to within 0.01. The buffer was widened to 30 miles so the
edge of the run area, where roads are cut off by the boundary rather than by
the hazard, sits farther from every hazard, and a 30-minute cutoff was added
at the user's request. The widest 30-minute reach in the table above is 32.9
miles (Northchase), so for a few hazards a 30-minute drive from a road near
the hazard can run past the 30-mile edge, and those 30-minute figures read
slightly low.

The 60 and 240 minute cutoffs from county runs are dropped here. Inside a
buffer of this size a one-hour drive reaches every road in the area, so those
bands stop measuring drive time at all. In a trial at 10 miles around the
Canton flood, 96% of roads lost exactly the same 17 buildings at both 60 and
240 minutes: the buildings the flood cut off entirely.

### 7.3 Roads cut off completely

The loss fraction says how much reach shrinks, but not whether a road can still
get out at all. A separate flag answers that. With the blocked roads removed,
the network is split into connected pieces. A road is **cut off completely**
(`is_isolated`) when it was on the main network before the hazard and is on a
smaller, separate piece after it, so no road route leads back at any drive
time. `isolated_buildings` counts the buildings stranded on the same piece.

Two cases are left out on purpose. Road pieces inside the hazard polygon are
already marked `is_blocked`, so they are not counted again. A piece with any
road within 800 m of the edge of the study area is not counted either, because
it may connect to the rest of the network beyond that edge, which the run
cannot see.

Cut-off roads get class 11 in every class column, so the styles draw them in
a deep red, heavier than any rank, on every map, whatever the cutoff. They are
left out when the breaks for classes 1 to 10 are fitted.

The buildings themselves are written to a `hazard_buildings` layer, with their
Overture id, footprint and a `status`: `cut_off` for the buildings on roads cut
off completely (the same buildings `isolated_buildings` counts), and
`in_hazard` for buildings whose footprint touches the hazard polygon or whose
road is inside it and closed. A building that is both counts as cut off. The
`study_area` layer carries the `in_hazard` count as `hazard_buildings`.

### 7.4 Limitations specific to buffer mode

**The study area is the edge of the world.** A detour that would leave it is not
found, and reach near the edge is cut short. At the default settings this was
checked by running two hazards at both 20 and 30 miles and comparing every road
the two runs share:

| Hazard | Roads compared | Largest change in a loss fraction, 5 / 10 / 15 min | Cut off completely, 20 mi / 30 mi |
|---|---|---|---|
| Northchase (widest 15-minute reach of the nine) | 47,674 | 0.0001 / 0.0000 / 0.0067 | 5 / 5 |
| Canton flood | 61,042 | 0.0000 / 0.0000 / 0.0001 | 1 / 1 |

No road losing 1% or more changed by more than 0.01, and the same roads were cut
off in both. At 15 minutes 0.8% of Canton's roads moved class, which comes from
fitting the breaks over a larger area rather than from any road's numbers
changing. Longer cutoffs are not offered for this reason.

**The whole polygon is treated as impassable.** Every road piece inside it is
closed, bridges included. A bridge that stays above a flood is still counted
as closed.

---

## 8. Drawn areas on demand (in testing)

The same measure can be run on an area a person draws on the map, anywhere in
North Carolina, at the 10 minute drive time. Everything that does not depend
on the area is prepared ahead of time for every county, plus 25 miles around
it: the roads, the buildings matched to them, the road network ready to
search, and each road's count of places in reach on a normal day. A run then
only closes the roads inside the drawn area and works out what that changes.
On the nine published hazards it gives the same roads losing access, the same
roads and buildings cut off, and the same buildings in the hazard as the full
runs. It is still in testing on NEMAC's computer and not yet online.

**What the tool does now**

- A green "Draw a hazard" button sits in the panel, above Methodology. Click
  the corners of an area, double-click to finish, then give it a name.
- An area can be up to 5 square miles and 4.5 miles across.
- The results show on the map the same way as the published hazards, with
  the same legend, popups and numbers under the map. A bar on the map says
  it is still working while it runs.
- Each area's results are kept for 7 days, then removed. "Your areas" in the
  panel lists the ones drawn in this browser, with the date each expires
  and the time left. The X beside one takes it off this browser's list at
  once; one on the map is cleared and the map goes back to the published
  hazard. The published hazards have no X.
- Running one needs an access code. The published site and a copy running on
  a computer each have their own code, and the alternate routes tool has a
  separate pair.
- In the first week there are 50 runs a day, 20 of them in big cities. After
  that there are 10 runs a day, 5 of them in big cities.
- A monthly cost cap of $25 in the first week, then $10, turns the tool off
  until the next month if it is reached. It is shared with the alternate
  routes tool.
- Until the tool is online, the published site does not show it.

**Things to improve**

- Big cities are slow. Charlotte and Raleigh take 1 to 2 minutes and small
  towns a few seconds.
- You can draw only one shape, and only use the 10 minute drive time. File
  uploads aren't offered yet.
- A few roads can differ by 1 or 2 buildings from the full analysis. This
  happens when a building sits exactly the same distance from two roads.
- The data is from one Overture release (October 2026). New roads or
  buildings need the prep run again, which takes about 6 hours.

**Good to know**

- Some roads, mostly driveways, aren't joined to the road network in
  Overture. They show as no loss.
- A 10 or 15 minute drive measure doesn't capture long trips. The I-40 gorge
  looks quiet on the map even though it matters for long-distance travel.

---

## 9. References

**Accessibility measurement**

Hansen, W. G. (1959). How Accessibility Shapes Land Use. *Journal of the American
Institute of Planners*, 25(2), 73-76.

Handy, S. L., & Niemeier, D. A. (1997). Measuring accessibility: an exploration of
issues and alternatives. *Environment and Planning A*, 29(7), 1175-1194.

Geurs, K. T., & van Wee, B. (2004). Accessibility evaluation of land-use and
transport strategies: review and research directions. *Journal of Transport
Geography*, 12(2), 127-140.

**Accessibility-based vulnerability**

Berdica, K. (2002). An introduction to road vulnerability: what has been done, is
done and should be done. *Transport Policy*, 9(2), 117-127.

Taylor, M. A. P., Sekhar, S. V. C., & D'Este, G. M. (2006). Application of
accessibility based methods for vulnerability analysis of strategic road
networks. *Networks and Spatial Economics*, 6(3-4), 267-291.

Jenelius, E., Petersen, T., & Mattsson, L. G. (2006). Importance and exposure in
road network vulnerability analysis. *Transportation Research Part A: Policy and
Practice*, 40(7), 537-560.

**Algorithms**

Dijkstra, E. W. (1959). A note on two problems in connexion with graphs.
*Numerische Mathematik*, 1(1), 269-271.

**Classification**

Jenks, G. F. (1967). The Data Model Concept in Statistical Mapping.
*International Yearbook of Cartography*, 7, 186-190.

**Data and software**

Overture Maps Foundation. Transportation theme (segment, connector) and Buildings
theme. https://overturemaps.org

Virtanen, P., et al. (2020). SciPy 1.0: fundamental algorithms for scientific
computing in Python. *Nature Methods*, 17, 261-272.

GEOS contributors. GEOS computational geometry library, accessed through Shapely.
https://libgeos.org
