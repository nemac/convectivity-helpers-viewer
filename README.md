# convectivity-helpers-viewer

A map viewer for the North Carolina road network connectivity analysis in
[conectivity_helpers](https://github.com/nemac/conectivity_helpers).

See it live at https://road-network-connectivity.nemac.org.

## What it shows

- **Detours**: for Haywood, Mecklenburg and New Hanover counties, what happens
  when one road is cut and traffic has to find another way to reach fire
  stations, medical facilities, schools, and grocery or convenience stores.
- **Pinch points**: for the whole state, how much depends on each road and how
  far traffic must go if it is cut.

Hover over a road to see its numbers. Click it to keep the popup open. The
Methodology link on each tab explains how the numbers are worked out.

## Running it on your computer

You need [Node.js](https://nodejs.org) version 16 or newer.

```
npm install
npm run dev
```

Then open http://localhost:5190.

The map data loads from the live site, so there is nothing else to download or
build. Keep the port at 5190, because the live site only shares its map data
with that address.

## Publishing changes

Pushing to the `master` branch publishes the viewer to the live site
automatically. It takes a couple of minutes.

## License

See [LICENSE](LICENSE).
