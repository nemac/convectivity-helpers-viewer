# Functional isolation: things to improve

A new tool is in testing: draw an area on the map, anywhere in North Carolina,
and see which roads lose access to the places they could reach within a
10 minute drive if that area is closed. It is still in testing on NEMAC's
computer and not yet online. These are the things it could do better, and a
few things worth knowing about the map.

## What the tool does now

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
  hazard. The published hazards have no X. "Your areas" looks and works
  like "Your routes" on the other tab: the closed list says how many are
  saved, an area still running reads "Running...", and the one on the map
  has a check mark.
- An area can be shared. "Share this area" under the map, or the share icon
  beside an area in "Your areas" or the hazard list, copies a link that
  opens the same results for anyone until they expire, without running it
  again. If the browser will not copy, the link is shown ready to copy by
  hand.
- Running one needs an access code. The published site and a copy running on
  a computer each have their own code, and the alternate routes tool has a
  separate pair.
- In the first week there are 50 runs a day, 20 of them in big cities. After
  that there are 10 runs a day, 5 of them in big cities.
- A monthly cost cap of $25 in the first week, then $10, turns the tool off
  until the next month if it is reached. It is shared with the alternate
  routes tool.
- Until the tool is online, the published site does not show it.

## Things to improve

- Big cities are slow. Charlotte and Raleigh take 1 to 2 minutes and small
  towns a few seconds.
- You can draw only one shape, and only use the 10 minute drive time. File
  uploads aren't offered yet.
- A few roads can differ by 1 or 2 buildings from the full analysis. This
  happens when a building sits exactly the same distance from two roads.
- The data is from one Overture release (October 2026). New roads or
  buildings need the prep run again, which takes about 6 hours.

## Good to know

- Some roads, mostly driveways, aren't joined to the road network in
  Overture. They show as no loss.
- A 10 or 15 minute drive measure doesn't capture long trips. The I-40 gorge
  looks quiet on the map even though it matters for long-distance travel.
