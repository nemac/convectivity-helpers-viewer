# Pinch points & alternate routing: things to improve

A new tool is in testing: click a road to see up to three ways around it if it
is closed, with directions, the extra time and distance, and whether a semi
can use each route. It is still in testing on NEMAC's computer and not yet
online. These are the things it could do better, and a few things worth
knowing about the map.

## What the tool does now

- The tab is now called "Pinch points & alternate routing".
- Click a road, then "Get alternate and truck-safe routes" in its popup.
  Hovering a route on the map lights its row in the popup, and hovering a row
  lights the route on the map.
- When only 1 or 2 ways around are found, the popup says so in bold above the
  routes, with the reason under them.
- The routes can be downloaded as a CSV file, one row per step.
- A set of routes can be saved with a name. Saved routes are kept in this
  browser for 7 days and listed in "Your routes" in the panel, above
  Methodology, with the date each expires and the time left. Opening one
  again uses no daily click. The X beside one removes it from this browser
  at once; if it is on the map, its routes are cleared. The set on the map
  has a check mark in the list.
- Routes can be shared. The Share button in the popup, or the share icon
  beside a saved set, copies a link. Anyone who opens it sees the same
  routes, directions and CSV without using a click, and can save them in
  their own "Your routes" with the same end date. The server keeps every
  set of routes for 7 days for this; after that the link says the routes
  have expired. Sets saved before this change cannot be shared.
- When a truck route is almost the same as a car route, the truck route now
  takes that car route's place, so no two routes are near copies.
- It has its own access code, separate from the drawing tool's. The published
  site and a copy running on a computer each have their own.
- In the first week there are 2,000 route clicks a day, then 1,000. The
  monthly cost cap of $25 in the first week, then $10, is shared with the
  drawing tool and turns both off until the next month if it is reached.
- Until the tool is online, the published site does not show it.

## Things to improve

- Long detours, such as around lakes and rivers, take 1 to 2 seconds per
  click. When the service is busy that can rise to about 6 seconds.
- The first click after a quiet spell takes about 3 seconds while the county
  loads. It may take longer on real AWS.
- A few routes labeled truck safe make a tight loop of 130 to 200 ft of road
  to turn around, which may be too tight for a semi.
- Some truck routes rejoin the road 8 to 16 miles past the closure. That
  follows the truck rules but looks odd.
- A car route that starts by turning around can be labeled "Possibly truck
  safe". "Not truck safe" may be clearer.
- About 3% of clicks in Haywood get "Possibly truck safe" because of a gap in
  a median.
- "A semi cannot turn off at the start" sometimes shows even when the car
  route starts in the same place.
- Routes only go 25 miles beyond the county. For very long detours, such as
  the I-40 gorge, it says the route may leave the area.
- Truck-safe routes do not check bridge heights. A route marked truck safe
  can still pass under a bridge too low for a semi.
- Truck safety is only as good as Overture's data. Weight limits and other
  truck rules count only where Overture records them.
- Drive times come from road types and speed limits, with no traffic.

## Good to know

- 37.8% of roads score zero on purpose because they are dead ends. Closing
  one only affects the homes on it.
- A detour of "none found within 3.1 miles" means no way around was found
  nearby. It is not a measured distance.
- Divided highways score low, correctly. Closing one side still leaves the
  other side open.
