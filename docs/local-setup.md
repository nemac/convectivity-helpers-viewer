# Running the tools on this computer

The two tools on this map, **Draw a hazard** on Functional isolation and
**Get alternate and truck-safe routes** on Pinch points, normally send their
work to NEMAC's servers on AWS. While you work on the map on your own
computer, they can send it to a copy of the same tools running on your
computer instead. This note says how to set that up.

## What the switch does

When the map runs on your own computer, the Draw a hazard card and a road's
popup show a switch with two choices:

- **This computer** sends the work to the copy running on your computer. It
  costs nothing and has no daily limits.
- **AWS (live)** sends the work to the real tools online. AWS uses the real
  daily limits, the same ones everyone shares, so each drawn area and each
  route click there counts against today's total.

The choice is one setting for both tools, and this browser remembers it.
When the copy on your computer is not running, "This computer" is grayed out
and the work goes to AWS.

Areas and routes you saved stay in your lists when you switch. An area drawn
on one choice cannot be opened on the other: switch back to open it.

The switch shows only on your own computer. The published map always uses
AWS and never shows it.

## What you need

- **Docker Desktop**, free from docker.com. It runs the copy of the tools.
  Install it, open it once, and leave it running.
- **Node.js** (version 20 or newer), free from nodejs.org.
- **Git**, to download the two projects.
- **The two projects, side by side in one folder**: the map
  (`convectivity-helpers-viewer`) and the analysis (`conectivity_helpers`).
  The tools themselves live in the analysis project.
- **The prepared data and the access codes**, from the NEMAC team. The data
  goes in the analysis project's `output` folder. The codes go in a file
  called `.env.development.local` in the map project, which the team will
  send you. Never share that file or put it in Git.

## Setting it up

1. Put both projects in the same folder, for example:

   ```
   GitHub/
     conectivity_helpers/
     convectivity-helpers-viewer/
   ```

2. Open a terminal in `convectivity-helpers-viewer` and run, once:

   ```
   npm install
   ```

3. Start Docker Desktop, then run:

   ```
   npm run dev:local
   ```

   The first time takes a few minutes while Docker builds the tools. After
   that it starts much faster.

4. Open **http://localhost:5190** in your browser.

To stop everything, press Ctrl+C in that terminal.

If Docker is not running, the map still opens, but "This computer" is grayed
out and the tools send their work to AWS.

## Coming soon

A one-click package for Windows and Mac is on the way, so the tools can run
on a computer without installing Node.js or downloading the projects.
